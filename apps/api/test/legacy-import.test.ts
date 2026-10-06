// Reprise de l'ancien site (Vanta) : connexion avec l'ancien mot de passe,
// mot de passe oublié par code e-mail, copie relançable des clients, pièces
// d'identité, offres et mensualités (dates d'origine, silence jusqu'à la bascule).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import pg from "pg";
import { prisma } from "@misterdou/db";
import { buildMiniApp, cleanup, createUser, expectApiError, tracker, authFor } from "./helpers.js";

// Les e-mails partent dans une boîte de test : on y lit le code reçu.
const outbox: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/lib/email.js", () => ({
  sendEmail: async (input: { to: string; subject: string; text: string }) => {
    outbox.push(input);
    return { queued: true };
  },
}));

const { login } = await import("../src/modules/auth/service.js");
const { requestPasswordReset, resetPasswordWithCode } = await import("../src/modules/auth/password-reset.js");
const { registerAuthRoutes } = await import("../src/modules/auth/routes.js");
const { verifyPassword } = await import("../src/lib/password.js");
const { getFile, decryptString } = await import("../src/lib/storage.js");
const { deleteMedia, readLocalMedia } = await import("../src/lib/media.js");
const { targetHost } = await import("../src/legacy/config.js");
const { keyFromUrl } = await import("../src/legacy/files.js");
const { readVanta } = await import("../src/legacy/vanta-read.js");
const { copyVanta, toLegacyUser } = await import("../src/legacy/vanta-copy.js");
const { FOLLOW_OLD_SITE_KEY } = await import("../src/legacy/follow.js");
const map = await import("../src/legacy/vanta-map.js");
const installments = await import("../src/modules/installments/service.js");

const t = tracker();
const SOURCE = "test-vanta";
const FAKE_DB = "misterdou_ancien_site_test";
const adminUrl = (db: string) => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${db}`;
  url.search = "";
  return url.toString();
};
const lastCode = (email: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  return mail?.text.match(/Votre code : (\d{6})/)?.[1];
};

let previousFollow: unknown = undefined;
const publicKeys: string[] = [];

afterAll(async () => {
  await prisma.legacyRef.deleteMany({ where: { source: SOURCE } });
  for (const key of publicKeys) await deleteMedia(key).catch(() => undefined);
  await cleanup(t);
  if (previousFollow === undefined) await prisma.settings.deleteMany({ where: { key: FOLLOW_OLD_SITE_KEY } });
  else await prisma.settings.update({ where: { key: FOLLOW_OLD_SITE_KEY }, data: { value: previousFollow as boolean } });
});

describe("Connexion avec un mot de passe de l'ancien site", () => {
  it("accepte l'empreinte bcrypt puis la convertit en scrypt", async () => {
    const user = await createUser(t);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash("AncienMotDePasse1", 10) } });

    await expect(login({ email: user.email, password: "Mauvais" }, {})).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const ok = await login({ email: user.email, password: "AncienMotDePasse1" }, {});
    expect(ok.user.id).toBe(user.id);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(row.passwordHash).toMatch(/^\$scrypt\$/);
    expect(await verifyPassword("AncienMotDePasse1", row.passwordHash!)).toBe(true);
  });
});

describe("Mot de passe oublié par code e-mail", () => {
  it("le code change le mot de passe, confirme l'e-mail, ferme les sessions, une seule fois", async () => {
    const user = await createUser(t);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    await authFor(user.id);

    await expect(requestPasswordReset(user.email.toUpperCase(), {})).resolves.toEqual({ sent: true });
    const code = lastCode(user.email);
    expect(code).toMatch(/^\d{6}$/);
    const stored = await prisma.passwordResetCode.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.codeHash).not.toContain(code!); // seule l'empreinte est gardée

    const wrong = code === "000000" ? "111111" : "000000";
    const err = await expectApiError(() => resetPasswordWithCode({ email: user.email, code: wrong, password: "NouveauMotDePasse1" }, {}));
    expect(err.message).toContain("Code incorrect ou expiré");

    await expect(resetPasswordWithCode({ email: user.email, code: code!, password: "NouveauMotDePasse1" }, {})).resolves.toEqual({ reset: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, emailVerifiedAt: true } });
    expect(await verifyPassword("NouveauMotDePasse1", row.passwordHash!)).toBe(true);
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await expect(resetPasswordWithCode({ email: user.email, code: code!, password: "EncoreUnAutre22" }, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("5 erreurs grillent le code ; un code par minute ; rien pour un inconnu ou un administrateur", async () => {
    const user = await createUser(t);
    await requestPasswordReset(user.email, {});
    const code = lastCode(user.email)!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(resetPasswordWithCode({ email: user.email, code: wrong, password: "NouveauMotDePasse1" }, {})).rejects.toBeTruthy();
    }
    await expect(resetPasswordWithCode({ email: user.email, code, password: "NouveauMotDePasse1" }, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const before = outbox.length;
    await expect(requestPasswordReset(user.email, {})).resolves.toEqual({ sent: true });
    expect(outbox.length).toBe(before);

    await prisma.passwordResetCode.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await requestPasswordReset(user.email, {});
    const fresh = lastCode(user.email)!;
    expect(outbox.length).toBe(before + 1);
    await expect(resetPasswordWithCode({ email: user.email, code: fresh, password: "NouveauMotDePasse1" }, {})).resolves.toEqual({ reset: true });

    const sent = outbox.length;
    await expect(requestPasswordReset("personne-ancien-site@example.com", {})).rejects.toMatchObject({ code: "EMAIL_NOT_REGISTERED" });
    const admin = await createUser(t, { role: "ADMIN" });
    await expect(requestPasswordReset(admin.email, {})).rejects.toMatchObject({ code: "EMAIL_NOT_REGISTERED" });
    expect(outbox.length).toBe(sent);
  });

  it("route publique : code mal formé refusé avant tout calcul", async () => {
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerAuthRoutes, { prefix: "/api/v1" });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset-code",
      payload: { email: "x@example.com", code: "12ab", password: "NouveauMotDePasse1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("6 chiffres");
    await app.close();
  });
});

describe("Formes de l'ancien site", () => {
  it("téléphones, pays, caractéristiques, identifiants, montants, pièces, numéros", () => {
    expect(map.normalizePhone("77 123 45 67")).toEqual({ phoneNumber: "+221771234567", countryCode: "+221" });
    expect(map.normalizePhone("221781234567")).toEqual({ phoneNumber: "+221781234567", countryCode: "+221" });
    expect(map.normalizePhone("+33 6 12 34 56 78")).toEqual({ phoneNumber: "+33612345678", countryCode: null });
    expect(map.normalizePhone("12")).toBeNull();
    expect(map.normalizeCountry("Senegal ")).toBe("Sénégal");
    expect(map.normalizeCountry("usa")).toBe("Usa");

    expect(map.parseFeatures({ ovr: 4300, coins: "1 200 000", division: 2, platform: "PS5" })).toEqual({
      division: "Division 2",
      teamPower: 4300,
      coins: 1_200_000,
      platform: "PS5",
    });
    expect(map.parseFeatures(null)).toMatchObject({ division: "Division 1", teamPower: 0, coins: 0 });

    expect(map.parseCredentials("E-mail : compte@jeu.com\nMot de passe : Secret 12")).toEqual({ email: "compte@jeu.com", password: "Secret 12" });
    expect(map.parseCredentials("rien")).toBeNull();

    const amounts = map.splitAmounts(Array(7).fill(95000 / 7), 95000);
    expect(amounts.reduce((s, a) => s + a, 0)).toBe(95000);
    expect(amounts.slice(0, 6).every((a) => a === 13571)).toBe(true);

    const d = (documentType: string, side: string, day: number) => ({ documentType, side, fileUrl: `identity/x/${documentType}-${side}-${day}.jpg`, uploadedAt: new Date(2026, 0, day) });
    const chosen = map.chooseKycDocs([d("NATIONAL_ID", "FRONT", 1), d("NATIONAL_ID", "FRONT", 5), d("NATIONAL_ID", "BACK", 1), d("FACE_PHOTO", "SINGLE", 1)]);
    expect(chosen).toMatchObject({ ok: true, type: "NATIONAL_ID" });
    expect(chosen.ok && chosen.front.fileUrl).toContain("FRONT-5"); // la plus récente
    expect(map.chooseKycDocs([d("NATIONAL_ID", "SINGLE", 1)])).toMatchObject({ ok: false, reason: expect.stringContaining("visage") });
    expect(map.chooseKycDocs([d("PASSPORT", "FRONT", 1), d("FACE_PHOTO", "SINGLE", 1)])).toMatchObject({ ok: true, type: "PASSPORT" });

    expect(map.mimeFromKey("products/a.JPEG")).toBe("image/jpeg");
    expect(map.orderNumberFor("2e433eed-aaaa", new Date("2026-09-11"))).toMatch(/^MD-2026-\d{7}$/);
    expect(keyFromUrl("https://b.s3.eu-north-1.amazonaws.com/products/x%20y.png")).toBe("products/x y.png");
  });

  it("garde-fou : seule une base locale est acceptée sans --production", () => {
    expect(targetHost("postgresql://u:p@localhost:5433/misterdou_test").local).toBe(true);
    const neon = targetHost("postgresql://u:secret@ep-x-pooler.neon.tech/neondb");
    expect(neon.local).toBe(false);
    expect(neon.host).not.toContain("secret");
  });
});

describe("Copie de l'ancien site (faux Vanta sur la base locale)", () => {
  let source: pg.Client;
  const stamp = Date.now();
  const id = (n: string) => `${n}-${stamp}`;
  const email = (n: string) => `vanta-${n}-${stamp}@example.com`;
  const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const BASE = "https://vanta-public.s3.eu-north-1.amazonaws.com";
  const files = new Map<string, { buffer: Buffer; mime: string | null }>([
    ["products/p1-cover.png", { buffer: PNG, mime: "image/png" }],
    ["products/p1-clip.mp4", { buffer: MP4, mime: "video/mp4" }],
    ["products/p2-cover.jpeg", { buffer: JPG, mime: null }],
    ["products/p2-clip.mov", { buffer: MP4, mime: "video/quicktime" }],
    ["avatars/a.png", { buffer: PNG, mime: "image/png" }],
    ["identity/a/front.jpg", { buffer: JPG, mime: "image/jpeg" }],
    ["identity/a/back.jpg", { buffer: JPG, mime: "image/jpeg" }],
    ["identity/a/face.jpg", { buffer: JPG, mime: "image/jpeg" }],
  ]);
  const fakeFiles = {
    readPublic: async (url: string) => files.get(keyFromUrl(url)) ?? Promise.reject(new Error("absent")),
    readPrivate: async (key: string) => files.get(keyFromUrl(key)) ?? Promise.reject(new Error("absent")),
  };
  const existing = { id: "", email: "" };
  const run = async (opts: { apply: boolean; bascule?: boolean }) => {
    // Conversion vidéo → MP4 H.264 simulée (ffmpeg n'est pas requis pour les essais).
    const report = await copyVanta(await readVanta(source), { ...opts, files: fakeFiles, source: SOURCE, convertVideo: async () => ({ buffer: MP4, changed: true }) });
    for (const l of report.users) if (l.newId && !t.userIds.includes(l.newId)) t.userIds.push(l.newId);
    for (const l of report.lines) {
      if (l.step === "offre" && l.newId && !t.productIds.includes(l.newId)) t.productIds.push(l.newId);
      if ((l.step === "média" || l.step === "photo de profil") && l.newId) publicKeys.push(l.newId);
    }
    return report;
  };
  const userFor = async (legacyId: string) => {
    const ref = await prisma.legacyRef.findUniqueOrThrow({ where: { source_entity_legacyId: { source: SOURCE, entity: "user", legacyId } } });
    return prisma.user.findUniqueOrThrow({ where: { id: ref.newId } });
  };
  const planFor = async (legacyId: string) => {
    const ref = await prisma.legacyRef.findUniqueOrThrow({ where: { source_entity_legacyId: { source: SOURCE, entity: "plan", legacyId } } });
    return prisma.installmentPlan.findUniqueOrThrow({ where: { id: ref.newId }, include: { installments: { orderBy: { index: "asc" } }, order: { include: { payments: true, items: true } } } });
  };

  beforeAll(async () => {
    const setting = await prisma.settings.findUnique({ where: { key: FOLLOW_OLD_SITE_KEY } });
    previousFollow = setting ? setting.value : undefined;

    const admin = new pg.Client({ connectionString: adminUrl("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${FAKE_DB}`);
    await admin.query(`CREATE DATABASE ${FAKE_DB}`);
    await admin.end();

    const merged = await createUser(t, { password: "SonMotDePasseNeuf1" });
    Object.assign(existing, merged);

    source = new pg.Client({ connectionString: adminUrl(FAKE_DB) });
    await source.connect();
    await source.query(`
      CREATE TABLE "Role" (id text PRIMARY KEY, name text);
      CREATE TABLE "User" (id text PRIMARY KEY, "firstName" text, "lastName" text, email text, phone text, "passwordHash" text, country text,
        address text, "roleId" text, "verificationStatus" text, "accountStatus" text, "authProvider" text, "providerAccountId" text,
        "avatarUrl" text, "createdAt" timestamptz);
      CREATE TABLE "IdentityDocument" (id text, "userId" text, "documentType" text, side text, "fileUrl" text, "uploadedAt" timestamptz);
      CREATE TABLE "VerificationRequest" (id text, "userId" text, status text, "submittedAt" timestamptz, "reviewedAt" timestamptz);
      CREATE TABLE "Product" (id text, title text, slug text, description text, "importantInfo" text, features jsonb, "priceTotal" numeric(12,2),
        "initialDepositAmount" numeric(12,2), "installmentsCount" int, status text, "createdAt" timestamptz);
      CREATE TABLE "ProductMedia" (id text, "productId" text, "mediaType" text, url text, position int, "isMain" boolean, "createdAt" timestamptz DEFAULT now());
      CREATE TABLE "Purchase" (id text, "userId" text, "productId" text, status text, "totalPrice" numeric(12,2), "createdAt" timestamptz);
      CREATE TABLE "PaymentPlan" (id text, "purchaseId" text, "initialDepositAmount" numeric(12,2), "initialDepositStatus" text,
        "remainingAmount" numeric(12,2), "installmentsCount" int, "startDate" timestamptz, status text, "createdAt" timestamptz DEFAULT now());
      CREATE TABLE "PaymentSchedule" (id text, "paymentPlanId" text, "installmentNumber" int, "dueDate" timestamptz, amount numeric(12,2), status text, "paidAt" timestamptz);
      CREATE TABLE "PaymentSubmission" (id text, "paymentPlanId" text);
      CREATE TABLE "PaymentConfirmation" (id text, "paymentSubmissionId" text, decision text, "reviewedAt" timestamptz);
      CREATE TABLE "AccessInformation" (id text, "purchaseId" text, content text, "createdAt" timestamptz DEFAULT now());
      INSERT INTO "Role" VALUES ('r-client','CLIENT'), ('r-admin','SUPER_ADMIN'), ('r-manager','MANAGER'), ('r-seller','SELLER');
    `);
    const user = `INSERT INTO "User" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'2026-08-01T10:00:00Z')`;
    const hash = await bcrypt.hash("AncienMotDePasse1", 10);
    // a : client vérifié, mensualités en cours ; b : Google, même numéro que a ;
    // c : administrateur ; d : suspendu, vérifié sans photo ; e : ancien vendeur ; f : déjà inscrit chez nous.
    await source.query(user, [id("a"), "Awa", "Ndiaye", email("a"), "77 123 45 67", hash, "Senegal ", "Dakar", "r-client", "VERIFIED", "ACTIVE", "CREDENTIALS", null, `${BASE}/avatars/a.png`]);
    await source.query(user, [id("b"), "Bara", "Sow", email("b"), "221771234567", null, null, null, "r-client", "PROFILE_INCOMPLETE", "ACTIVE", "GOOGLE", `google-${stamp}`, null]);
    await source.query(user, [id("c"), "Chef", "Admin", email("c"), null, hash, null, null, "r-admin", "VERIFIED", "ACTIVE", "CREDENTIALS", null, null]);
    await source.query(user, [id("d"), "Dia", "Fall", email("d"), null, hash, null, null, "r-client", "VERIFIED", "SUSPENDED", "CREDENTIALS", null, null]);
    await source.query(user, [id("e"), "Eva", "Gaye", email("e"), null, hash, null, null, "r-seller", "NOT_SUBMITTED", "ACTIVE", "CREDENTIALS", null, null]);
    await source.query(user, [id("f"), "Fatou", "Ba", existing.email.toUpperCase(), null, await bcrypt.hash("AutreAncien1", 10), null, null, "r-client", "NOT_SUBMITTED", "ACTIVE", "CREDENTIALS", null, null]);
    const doc = `INSERT INTO "IdentityDocument" VALUES ($1,$2,$3,$4,$5,$6)`;
    await source.query(doc, ["d1", id("a"), "NATIONAL_ID", "FRONT", "identity/a/front.jpg", "2026-08-02"]);
    await source.query(doc, ["d2", id("a"), "NATIONAL_ID", "BACK", "identity/a/back.jpg", "2026-08-02"]);
    await source.query(doc, ["d3", id("a"), "FACE_PHOTO", "SINGLE", "identity/a/face.jpg", "2026-08-02"]);
    await source.query(doc, ["d4", id("d"), "NATIONAL_ID", "SINGLE", "identity/d/single.jpg", "2026-08-02"]);
    await source.query(`INSERT INTO "VerificationRequest" VALUES ('v1',$1,'CONFIRMED','2026-08-02T09:00:00Z','2026-08-03T09:00:00Z')`, [id("a")]);

    const product = `INSERT INTO "Product" VALUES ($1,$2,$3,'Compte eFootball',$4,$5,$6,$7,$8,$9,'2026-08-05T00:00:00Z')`;
    await source.query(product, [id("p1"), "ASER-271-834-863", `aser-${stamp}`, "Ne pas changer l'e-mail", { ovr: 4300, coins: 1200000, division: "Division 1", platform: "PS5" }, 140000, 45000, 7, "HIDDEN"]);
    await source.query(product, [id("p2"), "ASQE-868-543-718", `asqe-${stamp}`, null, { ovr: 3200, coins: 50000, division: "Division 3" }, 21000, 5000, 2, "AVAILABLE"]);
    await source.query(product, [id("p3"), "CACHE-000", `cache-${stamp}`, null, {}, 10000, 1000, 2, "HIDDEN"]);
    const media = `INSERT INTO "ProductMedia" (id, "productId", "mediaType", url, position, "isMain") VALUES ($1,$2,$3,$4,$5,$6)`;
    await source.query(media, [id("m1"), id("p1"), "IMAGE", `${BASE}/products/p1-cover.png`, 0, true]);
    await source.query(media, [id("m2"), id("p1"), "VIDEO", `${BASE}/products/p1-clip.mp4`, 1, false]);
    await source.query(media, [id("m3"), id("p2"), "IMAGE", `${BASE}/products/p2-cover.jpeg`, 0, false]);
    await source.query(media, [id("m4"), id("p2"), "VIDEO", `${BASE}/products/p2-clip.mov`, 1, false]);

    await source.query(`INSERT INTO "Purchase" VALUES ($1,$2,$3,'ACTIVE',140000,'2026-09-10T08:00:00Z')`, [id("pu1"), id("a"), id("p1")]);
    await source.query(`INSERT INTO "PaymentPlan" (id, "purchaseId", "initialDepositAmount", "initialDepositStatus", "remainingAmount", "installmentsCount", "startDate", status)
      VALUES ($1,$2,45000,'PAID',81428.57,7,'2026-09-11T00:00:00Z','ACTIVE')`, [id("plan1"), id("pu1")]); // reste déjà baissé d'un mois
    for (let i = 1; i <= 7; i++) {
      await source.query(`INSERT INTO "PaymentSchedule" VALUES ($1,$2,$3,$4,$5,$6,NULL)`, [
        id(`s${i}`), id("plan1"), i, new Date(Date.UTC(2026, 9 + i - 1, 11)), (95000 / 7).toFixed(2), i === 1 ? "DUE" : "UPCOMING",
      ]);
    }
    await source.query(`INSERT INTO "PaymentSubmission" VALUES ('sub1',$1)`, [id("plan1")]);
    await source.query(`INSERT INTO "PaymentConfirmation" VALUES ('conf1','sub1','CONFIRMED','2026-09-11T12:00:00Z')`);
    await source.query(`INSERT INTO "AccessInformation" (id, "purchaseId", content) VALUES ('acc1',$1,'E-mail : compte@jeu.com\nMot de passe : Secret123')`, [id("pu1")]);
    // Réservation sans apport : reste sur l'ancien site.
    await source.query(`INSERT INTO "Purchase" VALUES ($1,$2,$3,'AWAITING_DEPOSIT',21000,'2026-09-20T08:00:00Z')`, [id("pu2"), id("e"), id("p2")]);
    await source.query(`INSERT INTO "PaymentPlan" (id, "purchaseId", "initialDepositAmount", "initialDepositStatus", "remainingAmount", "installmentsCount", status)
      VALUES ($1,$2,5000,'PENDING',16000,2,'PENDING_DEPOSIT')`, [id("plan2"), id("pu2")]);
  });

  afterAll(async () => {
    await source?.end();
    const admin = new pg.Client({ connectionString: adminUrl("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${FAKE_DB}`);
    await admin.end();
  });

  it("l'équipe n'est pas copiée, l'ancien vendeur devient client", async () => {
    const data = await readVanta(source);
    const byId = new Map(data.users.map((u) => [u.id, toLegacyUser(u)]));
    expect(byId.get(id("c"))!.skip).toContain("équipe");
    expect(byId.get(id("e"))!.skip).toBeNull();
    expect(byId.get(id("a"))).toMatchObject({ phoneNumber: "+221771234567", country: "Sénégal" });
    expect(data.plans.map((p) => p.id)).toEqual([id("plan1")]); // apport payé seulement
  });

  it("simulation : le rapport décrit tout, rien n'est écrit", async () => {
    const report = await run({ apply: false });
    const outcome = (legacyId: string) => report.users.find((l) => l.legacyId === legacyId)?.outcome;
    expect(outcome(id("a"))).toBe("créé");
    expect(outcome(id("c"))).toBe("ignoré");
    expect(outcome(id("f"))).toBe("fusionné");
    const plan = report.lines.find((l) => l.step === "mensualités");
    expect(plan).toMatchObject({ outcome: "créé", detail: expect.stringContaining("7 × 13 571") });
    expect(plan!.detail).toContain("11/10/2026");
    expect(report.lines.find((l) => l.step === "identité" && l.ref === id("d"))).toMatchObject({ outcome: "à refaire" });
    expect(await prisma.legacyRef.count({ where: { source: SOURCE } })).toBe(0);
    expect(await prisma.user.count({ where: { email: email("a") } })).toBe(0);
  });

  it("écriture : clients, identité, offres, médias, mensualités aux dates d'origine", async () => {
    await run({ apply: true });

    const a = await userFor(id("a"));
    expect(a).toMatchObject({ firstName: "Awa", kycStatus: "VERIFIED", phoneNumber: "+221771234567", country: "Sénégal", address: "Dakar" });
    expect(a.avatarKey).toMatch(/^avatars\//);
    expect((await readLocalMedia(a.avatarKey!)).equals(PNG)).toBe(true);
    await expect(login({ email: email("a"), password: "AncienMotDePasse1" }, {})).resolves.toBeTruthy();
    const kyc = await prisma.identityVerification.findFirstOrThrow({ where: { userId: a.id } });
    expect(kyc).toMatchObject({ status: "VERIFIED", documentType: "NATIONAL_ID" });
    for (const key of [kyc.documentFrontKey, kyc.documentBackKey!, kyc.selfieKey]) {
      t.fileKeys.push(key);
      expect((await getFile(key)).buffer.equals(JPG)).toBe(true); // chiffré, relisible
    }
    const b = await userFor(id("b"));
    expect(b.phoneNumber).toBeNull(); // numéro déjà pris par a
    expect(b.googleSub).toBe(`google-${stamp}`);
    const d = await userFor(id("d"));
    expect(d).toMatchObject({ status: "SUSPENDED", kycStatus: "NOT_SUBMITTED" });
    expect((await userFor(id("f"))).id).toBe(existing.id);
    await expect(login({ email: existing.email, password: "SonMotDePasseNeuf1" }, {})).resolves.toBeTruthy();
    expect(await prisma.legacyRef.count({ where: { source: SOURCE, legacyId: id("c") } })).toBe(0);

    const p1 = await prisma.legacyRef.findUniqueOrThrow({ where: { source_entity_legacyId: { source: SOURCE, entity: "product", legacyId: id("p1") } } });
    const sold = await prisma.product.findUniqueOrThrow({ where: { id: p1.newId }, include: { images: { orderBy: { position: "asc" } }, credential: true } });
    expect(sold).toMatchObject({ status: "SOLD", teamPower: 4300, coins: 1200000, basePrice: 140000, installmentDownPayment: 45000, installmentMonths: 7, ownerType: "ADMIN", sellerId: null });
    expect(sold.extraInfo).toContain("Plateforme : PS5");
    expect(sold.images.map((i) => [i.mimeType, i.isPrimary])).toEqual([["image/png", true], ["video/mp4", false]]);
    expect(decryptString(sold.credential!.encryptedEmail)).toBe("compte@jeu.com");
    expect(decryptString(sold.credential!.encryptedPassword)).toBe("Secret123");
    const p2 = await prisma.legacyRef.findUniqueOrThrow({ where: { source_entity_legacyId: { source: SOURCE, entity: "product", legacyId: id("p2") } } });
    const hidden = await prisma.product.findUniqueOrThrow({ where: { id: p2.newId }, include: { images: true } });
    expect(hidden).toMatchObject({ status: "DRAFT", publishedAt: null });
    expect(hidden.images.map((i) => [i.mimeType, i.isPrimary])).toEqual([["image/jpeg", true], ["video/mp4", false]]); // .mov converti
    expect(await prisma.legacyRef.count({ where: { source: SOURCE, legacyId: id("p3") } })).toBe(0);

    const plan = await planFor(id("plan1"));
    expect(plan).toMatchObject({ totalAmount: 140000, downPaymentAmount: 45000, remainingAmount: 95000, monthCount: 7, totalPaid: 45000, paidCount: 0, status: "ACTIVE" });
    expect(plan.installments.reduce((s, i) => s + i.amountDue, 0)).toBe(95000);
    expect(plan.installments.map((i) => i.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-10-11", "2026-11-11", "2026-12-11", "2027-01-11", "2027-02-11", "2027-03-11", "2027-04-11",
    ]);
    expect(plan.installments.every((i) => i.status === "PENDING")).toBe(true);
    expect(plan.order).toMatchObject({ status: "PARTIALLY_PAID", paymentMode: "INSTALLMENTS", totalAmount: 140000, buyerId: a.id });
    expect(plan.order.payments).toEqual([expect.objectContaining({ type: "INITIAL_INSTALLMENT", amount: 45000, status: "SUCCESS", provider: "SYSTEM" })]);
    expect(plan.order.payments[0]!.paidAt?.toISOString()).toBe("2026-09-11T12:00:00.000Z");
    expect(await prisma.legacyRef.count({ where: { source: SOURCE, legacyId: id("plan2") } })).toBe(0);
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: FOLLOW_OLD_SITE_KEY } })).value).toBe(true);
  });

  it("avant la bascule : ni retard, ni rappel, ni paiement sur le nouveau site", async () => {
    const plan = await planFor(id("plan1"));
    // Échéances de CE plan passées (l'horloge n'est jamais avancée : la base est partagée).
    await prisma.installment.updateMany({ where: { planId: plan.id, index: { lte: 2 } }, data: { dueDate: new Date(Date.now() - 10 * 86_400_000) } });
    await prisma.installment.updateMany({ where: { planId: plan.id, index: 3 }, data: { dueDate: new Date(Date.now() + 86_400_000) } });
    await installments.markOverdueInstallments();
    await installments.sendInstallmentReminders();
    const after = await planFor(id("plan1"));
    expect(after.status).toBe("ACTIVE");
    expect(after.installments.every((i) => i.status === "PENDING")).toBe(true);
    expect(await prisma.notification.count({ where: { userId: plan.order.buyerId, title: { startsWith: "Mensualité" } } })).toBe(0);
    const err = await expectApiError(() => installments.createNextInstallmentPayment(plan.orderId, { actorId: plan.order.buyerId }));
    expect(err.code).toBe("LEGACY_PLAN");
  });

  it("relancée : aucun doublon ; un mois payé sur l'ancien site est reporté", async () => {
    const refs = await prisma.legacyRef.count({ where: { source: SOURCE } });
    const again = await run({ apply: true });
    expect(again.users.filter((l) => l.outcome === "créé")).toHaveLength(0);
    expect(again.lines.filter((l) => l.outcome === "créé")).toHaveLength(0);
    expect(await prisma.legacyRef.count({ where: { source: SOURCE } })).toBe(refs);

    await source.query(`UPDATE "PaymentSchedule" SET status = 'PAID', "paidAt" = '2026-10-10T15:00:00Z' WHERE id = $1`, [id("s1")]);
    const sync = await run({ apply: true });
    expect(sync.lines.find((l) => l.step === "mensualités")).toMatchObject({ outcome: "mis à jour", detail: expect.stringContaining("1 mensualité") });
    const plan = await planFor(id("plan1"));
    expect(plan).toMatchObject({ totalPaid: 45000 + plan.installments[0]!.amountDue, paidCount: 1 });
    expect(plan.installments[0]).toMatchObject({ status: "PAID", paidAt: new Date("2026-10-10T15:00:00Z") });
  });

  it("bascule : offres encore en vente publiées, mensualités rendues au nouveau site", async () => {
    // Offre mise en vente sur l'ancien site après la copie : créée et publiée d'un coup.
    await source.query(`INSERT INTO "Product" VALUES ($1,'ASNEW-000','asnew-${stamp}','Compte eFootball',NULL,$2,30000,5000,2,'AVAILABLE','2026-10-04T00:00:00Z')`, [
      id("p4"),
      { ovr: 3000, coins: 10000, division: 2 },
    ]);
    const report = await run({ apply: true, bascule: true });
    const p4 = await prisma.legacyRef.findUniqueOrThrow({ where: { source_entity_legacyId: { source: SOURCE, entity: "product", legacyId: id("p4") } } });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: p4.newId } })).toMatchObject({ status: "ACTIVE", publishedAt: expect.any(Date) });
    expect(report.lines.find((l) => l.step === "offre" && l.ref === id("p2"))).toMatchObject({ outcome: "publié" });
    const p2 = await prisma.legacyRef.findUniqueOrThrow({ where: { source_entity_legacyId: { source: SOURCE, entity: "product", legacyId: id("p2") } } });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: p2.newId } })).toMatchObject({ status: "ACTIVE", publishedAt: expect.any(Date) });
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: FOLLOW_OLD_SITE_KEY } })).value).toBe(false);

    await installments.markOverdueInstallments();
    const plan = await planFor(id("plan1"));
    // Le mois 1 a été payé sur l'ancien site ; le mois 2 est échu ; le mois 3 pas encore.
    expect(plan.installments.filter((i) => i.status === "OVERDUE").map((i) => i.index)).toEqual([2]);
  });
});
