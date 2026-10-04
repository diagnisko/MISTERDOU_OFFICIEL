// Reprise de l'ancien site (Supabase) : connexion avec l'ancien mot de passe,
// mot de passe oublié par code e-mail, import des comptes relançable.
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
const { mapSupabaseUser, readSupabaseUsers, importSupabaseUsers } = await import("../src/legacy/supabase-users.js");
const { targetHost } = await import("../src/legacy/config.js");

const t = tracker();
const SOURCE = "test-supabase";
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

afterAll(async () => {
  await prisma.legacyRef.deleteMany({ where: { source: SOURCE } });
  await cleanup(t);
});

describe("Connexion avec un mot de passe de l'ancien site", () => {
  it("accepte l'empreinte bcrypt de Supabase puis la convertit en scrypt", async () => {
    const user = await createUser(t);
    const legacyHash = await bcrypt.hash("AncienMotDePasse1", 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: legacyHash } });

    await expect(login({ email: user.email, password: "Mauvais" }, {})).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const ok = await login({ email: user.email, password: "AncienMotDePasse1" }, {});
    expect(ok.user.id).toBe(user.id);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(row.passwordHash).toMatch(/^\$scrypt\$/);
    expect(await verifyPassword("AncienMotDePasse1", row.passwordHash!)).toBe(true);
    await expect(login({ email: user.email, password: "AncienMotDePasse1" }, {})).resolves.toBeTruthy();
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

    // Code déjà utilisé.
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

    // Redemande immédiate : pas de nouvel e-mail (anti-abus), même réponse.
    const before = outbox.length;
    await expect(requestPasswordReset(user.email, {})).resolves.toEqual({ sent: true });
    expect(outbox.length).toBe(before);

    // Après la minute d'attente : un nouveau code, l'ancien ne vaut plus rien.
    await prisma.passwordResetCode.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await requestPasswordReset(user.email, {});
    const fresh = lastCode(user.email)!;
    expect(outbox.length).toBe(before + 1);
    await expect(resetPasswordWithCode({ email: user.email, code: fresh, password: "NouveauMotDePasse1" }, {})).resolves.toEqual({ reset: true });

    const sent = outbox.length;
    await requestPasswordReset("personne-ancien-site@example.com", {});
    const admin = await createUser(t, { role: "ADMIN" });
    await requestPasswordReset(admin.email, {});
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

describe("Lecture des comptes Supabase", () => {
  it("prend prénom/nom, e-mail vérifié, identité Google ; écarte supprimés et anonymes", () => {
    const hash = "$2a$10$" + "a".repeat(53);
    const now = new Date("2026-10-04T12:00:00Z");
    const u = mapSupabaseUser(
      {
        id: "u1",
        email: " Awa@Exemple.com ",
        encrypted_password: hash,
        email_confirmed_at: "2025-01-02T10:00:00Z",
        created_at: "2025-01-01T10:00:00Z",
        raw_user_meta_data: { full_name: "Awa Ndiaye Diop" },
        banned_until: "2027-01-01T00:00:00Z",
      },
      [{ user_id: "u1", provider: "google", provider_id: "google-sub-1" }],
      now,
    );
    expect(u).toMatchObject({
      email: "awa@exemple.com",
      passwordHash: hash,
      firstName: "Awa",
      lastName: "Ndiaye Diop",
      googleSub: "google-sub-1",
      suspended: true,
      skip: null,
    });
    expect(mapSupabaseUser({ id: "u2", email: "a@b.co", encrypted_password: "" }, []).passwordHash).toBeNull();
    expect(mapSupabaseUser({ id: "u3", email: "a@b.co", deleted_at: "2025-01-01" }, []).skip).toContain("supprimé");
    expect(mapSupabaseUser({ id: "u4", is_anonymous: true }, []).skip).toBe("visiteur anonyme");
    expect(mapSupabaseUser({ id: "u5", phone: "221770000000" }, []).skip).toContain("téléphone");
  });

  it("garde-fou : seule une base locale est acceptée sans --production", () => {
    expect(targetHost("postgresql://u:p@localhost:5433/misterdou_test").local).toBe(true);
    const neon = targetHost("postgresql://u:secret@ep-x-pooler.neon.tech/neondb");
    expect(neon.local).toBe(false);
    expect(neon.host).not.toContain("secret");
  });
});

describe("Import des comptes (faux Supabase sur la base locale)", () => {
  let source: pg.Client;
  const ids = { a: "00000000-0000-4000-8000-00000000000a", b: "00000000-0000-4000-8000-00000000000b", c: "00000000-0000-4000-8000-00000000000c", d: "00000000-0000-4000-8000-00000000000d", e: "00000000-0000-4000-8000-00000000000e" };
  const emails = { a: `ancien-a-${Date.now()}@example.com`, b: `ancien-b-${Date.now()}@example.com`, c: `ancien-c-${Date.now()}@example.com` };
  let existingClient: { id: string; email: string };
  let staff: { id: string; email: string };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${FAKE_DB}`);
    await admin.query(`CREATE DATABASE ${FAKE_DB}`);
    await admin.end();

    existingClient = await createUser(t, { password: "SonMotDePasseNeuf1" });
    staff = await createUser(t, { role: "STAFF" });

    source = new pg.Client({ connectionString: adminUrl(FAKE_DB) });
    await source.connect();
    await source.query(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, encrypted_password text, email_confirmed_at timestamptz,
        phone text, created_at timestamptz, last_sign_in_at timestamptz, raw_user_meta_data jsonb, banned_until timestamptz,
        deleted_at timestamptz, is_anonymous boolean DEFAULT false);
      CREATE TABLE auth.identities (id text, user_id uuid, provider text, provider_id text, identity_data jsonb);
    `);
    const hashA = await bcrypt.hash("AncienMotDePasse1", 10);
    const ins = "INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_user_meta_data, deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7)";
    await source.query(ins, [ids.a, emails.a, hashA, "2025-02-01T00:00:00Z", "2025-01-15T00:00:00Z", { first_name: "Fatou", last_name: "Sow" }, null]);
    await source.query(ins, [ids.b, emails.b, "", "2025-03-01", "2025-03-01", { full_name: "Moussa Ba" }, null]);
    await source.query(ins, [ids.c, emails.c, hashA, null, "2025-04-01", {}, "2025-05-01"]);
    await source.query(ins, [ids.d, existingClient.email.toUpperCase(), await bcrypt.hash("AutreAncien1", 10), null, "2025-01-01", {}, null]);
    await source.query(ins, [ids.e, staff.email, hashA, null, "2025-01-01", {}, null]);
    await source.query("INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data) VALUES ($1,$2,'google',$3,$4)", [
      `gid-${Date.now()}`,
      ids.b,
      `google-${Date.now()}`,
      { email: emails.b },
    ]);
  });

  afterAll(async () => {
    await source?.end();
    const admin = new pg.Client({ connectionString: adminUrl("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${FAKE_DB}`);
    await admin.end();
  });

  const run = async (apply: boolean) => {
    const lines = await importSupabaseUsers(await readSupabaseUsers(source), { apply, source: SOURCE });
    for (const l of lines) if (l.newId && !t.userIds.includes(l.newId)) t.userIds.push(l.newId);
    return Object.fromEntries(lines.map((l) => [l.legacyId, l]));
  };

  it("simulation : le rapport décrit tout, rien n'est écrit", async () => {
    const r = await run(false);
    expect(r[ids.a]!.outcome).toBe("créé");
    expect(r[ids.b]!.outcome).toBe("créé");
    expect(r[ids.c]).toMatchObject({ outcome: "ignoré", reason: expect.stringContaining("supprimé") });
    expect(r[ids.d]!.outcome).toBe("fusionné");
    expect(r[ids.e]).toMatchObject({ outcome: "ignoré", reason: expect.stringContaining("équipe") });
    expect(await prisma.user.count({ where: { email: { in: [emails.a, emails.b] } } })).toBe(0);
    expect(await prisma.legacyRef.count({ where: { source: SOURCE } })).toBe(0);
  });

  it("écriture : comptes créés, fusion sans écraser le mot de passe du nouveau site", async () => {
    const r = await run(true);
    const a = await prisma.user.findUniqueOrThrow({ where: { email: emails.a }, include: { role: true } });
    expect(a).toMatchObject({ firstName: "Fatou", lastName: "Sow", status: "ACTIVE" });
    expect(a.role.name).toBe("CLIENT");
    expect(a.emailVerifiedAt).not.toBeNull();
    expect(a.createdAt.toISOString()).toBe(new Date("2025-01-15T00:00:00Z").toISOString());
    const b = await prisma.user.findUniqueOrThrow({ where: { email: emails.b } });
    expect(b.passwordHash).toBeNull(); // inscrit par Google : se connecte par Google ou « mot de passe oublié »
    expect(b.googleSub).toMatch(/^google-/);
    expect(r[ids.d]!.newId).toBe(existingClient.id);
    await expect(login({ email: existingClient.email, password: "SonMotDePasseNeuf1" }, {})).resolves.toBeTruthy();
    await expect(login({ email: emails.a, password: "AncienMotDePasse1" }, {})).resolves.toBeTruthy();
  });

  it("relancé (transfert final) : aucun doublon, suit l'ancien mot de passe tant que le client ne l'a pas changé", async () => {
    const again = await run(true);
    expect(Object.values(again).filter((l) => l.outcome === "créé")).toHaveLength(0);
    expect(await prisma.user.count({ where: { email: emails.a } })).toBe(1);

    // b n'a jamais eu de mot de passe chez nous et en choisit un sur l'ancien site : repris.
    await source.query("UPDATE auth.users SET encrypted_password = $1 WHERE id = $2", [await bcrypt.hash("MotDePasseB1", 10), ids.b]);
    const third = await run(true);
    expect(third[ids.b]).toMatchObject({ outcome: "mis à jour", reason: "passwordHash" });
    await expect(login({ email: emails.b, password: "MotDePasseB1" }, {})).resolves.toBeTruthy();

    // a s'est connecté chez nous (empreinte convertie) : l'ancien site ne l'écrase plus.
    await source.query("UPDATE auth.users SET encrypted_password = $1 WHERE id = $2", [await bcrypt.hash("ChangeAilleurs1", 10), ids.a]);
    const fourth = await run(true);
    expect(fourth[ids.a]!.outcome).toBe("inchangé");
    await expect(login({ email: emails.a, password: "AncienMotDePasse1" }, {})).resolves.toBeTruthy();
  });
});
