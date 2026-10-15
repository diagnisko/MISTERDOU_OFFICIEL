// Sécurité : blocage après des mauvais mots de passe, alertes (nouvel appareil,
// réglage modifié, retrait vers un nouveau numéro) et « Déconnecter partout ».
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { SUITE_STARTED_AT, authFor, buildMiniApp, cleanup, createAdmin, createSeller, createStaff, createUser, expectApiError, track, tracker } from "./helpers.js";
import { login } from "../src/modules/auth/service.js";
import { loginAdmin } from "../src/modules/admin-console/auth.js";
import { listWithdrawals, revokeManagerSessions, updateSetting } from "../src/modules/admin-ops/service.js";
import { registerSellerRoutes } from "../src/modules/seller/routes.js";
import { LOGIN_FAIL_LIMIT, deviceLabel } from "../src/lib/login-guard.js";

const t = tracker();
const PASSWORD = "MotDePasse123!";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

afterAll(async () => {
  await cleanup(t);
});

const notes = (userId: string, title: string) =>
  prisma.notification.count({ where: { userId, title, createdAt: { gte: SUITE_STARTED_AT } } });

describe("Blocage après des mauvais mots de passe", () => {
  it("bloque le compte 15 minutes au 5e échec, même avec le bon mot de passe ensuite, et prévient le propriétaire", async () => {
    const user = await createUser(t);
    for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
      expect((await expectApiError(() => login({ email: user.email, password: "mauvais" }, { ip: "203.0.113.5" }))).code).toBe("INVALID_CREDENTIALS");
    }
    const locked = await expectApiError(() => login({ email: user.email, password: PASSWORD }, { ip: "198.51.100.7" }));
    expect(locked.code).toBe("RATE_LIMITED");
    expect(locked.message).toContain("bloqué 15 minutes");
    expect(await notes(user.id, "Tentatives de connexion bloquées")).toBe(1);
  });

  it("répond pareil pour une adresse inconnue (rien ne trahit qu'un compte existe)", async () => {
    const email = `inconnu-${Date.now()}@example.com`;
    for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
      expect((await expectApiError(() => login({ email, password: "x" }, {}))).code).toBe("INVALID_CREDENTIALS");
    }
    expect((await expectApiError(() => login({ email, password: "x" }, {}))).code).toBe("RATE_LIMITED");
  });

  it("repart de zéro après une connexion réussie", async () => {
    const user = await createUser(t);
    for (let i = 0; i < 3; i++) await expectApiError(() => login({ email: user.email, password: "mauvais" }, {}));
    await login({ email: user.email, password: PASSWORD }, {});
    for (let i = 0; i < 2; i++) await expectApiError(() => login({ email: user.email, password: "mauvais" }, {}));
    const again = await login({ email: user.email, password: PASSWORD }, {});
    expect(again.user.id).toBe(user.id);
  });

  it("protège aussi la console (mot de passe faux, puis bloqué)", async () => {
    const staff = await createUser(t, { role: "STAFF" });
    for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
      expect((await expectApiError(() => loginAdmin({ email: staff.email, password: "mauvais" }, {}))).code).toBe("INVALID_CREDENTIALS");
    }
    expect((await expectApiError(() => loginAdmin({ email: staff.email, password: PASSWORD }, {}))).code).toBe("RATE_LIMITED");
  });
});

describe("Connexion d'un membre depuis un nouvel appareil", () => {
  it("prévient le membre et les administrateurs, une seule fois par appareil", async () => {
    const { user: admin } = await createAdmin(t);
    const { user: staff } = await createStaff(t, ["ORDERS"]); // une session « vitest » existe déjà

    const first = await loginAdmin({ email: staff.email, password: PASSWORD }, { userAgent: CHROME_WINDOWS, ip: "203.0.113.9", country: "SN" });
    expect(first.role).toBe("STAFF");
    expect(await notes(staff.id, "Nouvelle connexion à votre compte")).toBe(1);
    const adminAlert = await prisma.notification.findFirstOrThrow({
      where: { userId: admin.id, title: "Connexion d’un membre depuis un nouvel appareil", message: { contains: staff.firstName }, createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(adminAlert.message).toContain("Chrome sur Windows");
    expect(adminAlert.message).toContain("pays : SN");
    expect(adminAlert.message).toContain("Déconnecter partout");

    // Même appareil : plus d'alerte.
    await loginAdmin({ email: staff.email, password: PASSWORD }, { userAgent: CHROME_WINDOWS });
    expect(await notes(staff.id, "Nouvelle connexion à votre compte")).toBe(1);
  });

  it("ne dit rien pour une toute première connexion, ni pour un client", async () => {
    const newcomer = await createUser(t, { role: "STAFF" });
    await loginAdmin({ email: newcomer.email, password: PASSWORD }, { userAgent: SAFARI_IPHONE });
    expect(await notes(newcomer.id, "Nouvelle connexion à votre compte")).toBe(0);

    const client = await createUser(t);
    await authFor(client.id);
    await login({ email: client.email, password: PASSWORD }, { userAgent: SAFARI_IPHONE });
    expect(await notes(client.id, "Nouvelle connexion à votre compte")).toBe(0);
  });

  it("décrit l'appareil en clair", () => {
    expect(deviceLabel(CHROME_WINDOWS)).toBe("Chrome sur Windows");
    expect(deviceLabel(SAFARI_IPHONE)).toBe("Safari sur iPhone");
    expect(deviceLabel(undefined)).toBe("navigateur inconnu sur appareil inconnu");
  });
});

describe("« Déconnecter partout »", () => {
  it("ferme toutes les connexions du membre et le prévient", async () => {
    const { user: admin } = await createAdmin(t);
    const { user: staff } = await createStaff(t, ["SUPPORT"]);
    await authFor(staff.id);
    const profile = await prisma.managerProfile.findUniqueOrThrow({ where: { userId: staff.id } });

    const result = await revokeManagerSessions(profile.id, { actorId: admin.id, actorRole: "ADMIN" });
    expect(result.sessionsClosed).toBe(2);
    expect(await prisma.session.count({ where: { userId: staff.id, revokedAt: null } })).toBe(0);
    expect(await notes(staff.id, "Toutes vos connexions ont été fermées")).toBe(1);
  });
});

describe("Réglage modifié", () => {
  it("alerte tous les administrateurs avec l'ancienne et la nouvelle valeur, pas quand rien ne change", async () => {
    const { user: admin } = await createAdmin(t);
    const row = await prisma.settings.findUniqueOrThrow({ where: { key: "legalPublisher" } });
    const actor = { actorId: admin.id, actorRole: "ADMIN" as const };
    try {
      await updateSetting("legalPublisher", "Responsable de test", actor);
      const alert = await prisma.notification.findFirstOrThrow({
        where: { userId: admin.id, title: "Réglage modifié : Responsable de la publication", createdAt: { gte: SUITE_STARTED_AT } },
        orderBy: { createdAt: "desc" },
      });
      expect(alert.message).toContain("« Responsable de test »");
      expect(alert.priority).toBe("CRITICAL");

      const before = await notes(admin.id, "Réglage modifié : Responsable de la publication");
      await updateSetting("legalPublisher", "Responsable de test", actor);
      expect(await notes(admin.id, "Réglage modifié : Responsable de la publication")).toBe(before);
    } finally {
      await prisma.settings.update({ where: { key: "legalPublisher" }, data: { value: row.value ?? "" } });
    }
  });
});

describe("Retrait vers un nouveau numéro", () => {
  it("prévient le vendeur à chaque demande et signale à l'équipe un numéro jamais payé", async () => {
    const { user: admin } = await createAdmin(t);
    const sellerUser = await createUser(t, { role: "VENDOR", kycVerified: true });
    await createSeller(t, sellerUser, { balanceAvailable: 50_000 });
    const app = await buildMiniApp({ auth: await authFor(sellerUser.id) }, async (instance) => {
      await instance.register(registerSellerRoutes, { prefix: "/api/v1" });
    });
    const ask = () => app.inject({ method: "POST", url: "/api/v1/seller/withdrawals", payload: { amount: 5_000, method: "WAVE", phoneNumber: "+221 77 123 45 67" } });

    const first = await ask();
    expect(first.statusCode).toBe(200);
    const firstId = (first.json() as { data: { id: string } }).data.id;
    track(t, "withdrawalIds", firstId);
    expect(await notes(admin.id, "Retrait vers un nouveau numéro")).toBeGreaterThanOrEqual(1);
    const sellerAlert = await prisma.notification.findFirstOrThrow({
      where: { userId: sellerUser.id, title: "Demande de retrait envoyée", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(sellerAlert.type).toBe("SECURITY_ALERT");
    expect(sellerAlert.message).toContain("•••• 4567");
    const listed = (await listWithdrawals({ page: 1, perPage: 50, q: sellerUser.email })).items.find((w) => w.id === firstId);
    expect(listed?.payout).toMatchObject({ phoneNumber: "+221771234567", newNumber: true });

    // Une fois ce numéro payé, la demande suivante n'est plus signalée.
    await prisma.withdrawal.update({ where: { id: firstId }, data: { status: "COMPLETED" } });
    const beforeNormal = await notes(admin.id, "Nouvelle demande de retrait");
    const second = await ask();
    const secondId = (second.json() as { data: { id: string } }).data.id;
    track(t, "withdrawalIds", secondId);
    expect(await notes(admin.id, "Nouvelle demande de retrait")).toBe(beforeNormal + 1);
    const listedAgain = (await listWithdrawals({ page: 1, perPage: 50, q: sellerUser.email })).items.find((w) => w.id === secondId);
    expect(listedAgain?.payout?.newNumber).toBe(false);
    await app.close();
  });
});
