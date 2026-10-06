// §39 — inscription, connexion, connexion Google, comptes administrateurs.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@misterdou/db";
import { login, loginWithGoogle, register, toMeDto } from "../src/modules/auth/service.js";
import { loginAdmin } from "../src/modules/admin-console/auth.js";
import { loginSchema, registerSchema } from "@misterdou/shared";
import { verifyPassword } from "../src/lib/password.js";
import { findActiveSession } from "../src/lib/sessions.js";
import { ApiError } from "../src/lib/errors.js";
import { env } from "../src/env.js";
import { cleanup, createAdmin, createUser, expectApiError, marker, tracker, type Tracked } from "./helpers.js";

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    async verifyIdToken(input: { idToken: string; audience: string }) {
      const payloads: Record<string, { sub: string; email: string; email_verified: boolean }> = {
        "valid-google-token": { sub: "google-sub-123", email: "google-client@example.com", email_verified: true },
        "valid-google-staff-token": { sub: "google-sub-staff", email: "p13-google-staff@example.com", email_verified: true },
      };
      const payload = payloads[input.idToken];
      if (!payload) throw new Error("token invalide");
      return { getPayload: () => payload };
    }
  },
}));

const t: Tracked = tracker();

afterAll(async () => {
  await cleanup(t);
});

describe("Inscription (§39 — inscription)", () => {
  it("crée un compte CLIENT, hache le mot de passe et ouvre une session", async () => {
    // Un administrateur actif doit exister pour recevoir l'alerte « Nouveau client ».
    await createAdmin(t);
    const email = `p13-${marker()}@example.com`;
    const result = await register({ firstName: "Awa", email, password: "MotDePasse123!" }, { ip: "127.0.0.1" });
    t.userIds.push(result.user.id);

    expect(result.user.role).toBe("CLIENT");
    expect(result.user.status).toBe("ACTIVE");
    expect(result.sid).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { id: result.user.id }, include: { role: true } });
    expect(user?.email).toBe(email.toLowerCase());
    expect(user?.role.name).toBe("CLIENT");
    expect(user?.passwordHash).toMatch(/^\$scrypt\$N=/);
    expect(await verifyPassword("MotDePasse123!", user!.passwordHash!)).toBe(true);
    expect(await verifyPassword("mauvais-mot-de-passe", user!.passwordHash!)).toBe(false);

    // Préférence de notifications créée par défaut + session réellement active.
    const pref = await prisma.notificationPreference.findUnique({ where: { userId: result.user.id } });
    expect(pref?.inApp).toBe(true);
    const session = await findActiveSession(result.sid);
    expect(session?.user.id).toBe(result.user.id);
    expect(session?.isAdminSession).toBe(false);

    // Alerte admin générée (nettoyée par cleanup — notification étrangère).
    const adminAlerts = await prisma.notification.count({
      where: { type: "ADMIN_ALERT", title: "Nouveau client", message: { contains: email } },
    });
    expect(adminAlerts).toBeGreaterThan(0);
  });

  it("refuse un e-mail déjà enregistré (409 EMAIL_ALREADY_REGISTERED)", async () => {
    const email = `p13-${marker()}@example.com`;
    const first = await register({ firstName: "Awa", email, password: "MotDePasse123!" }, {});
    t.userIds.push(first.user.id);

    const err = await expectApiError(() => register({ firstName: "Awa", email, password: "MotDePasse123!" }, {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(err.statusCode).toBe(409);
  });

  it("valide le schéma d'inscription (mot de passe < 8 caractères rejeté)", () => {
    expect(registerSchema.safeParse({ firstName: "Awa", email: "x@example.com", password: "court" }).success).toBe(false);
    expect(registerSchema.safeParse({ firstName: "Awa", email: "pas-un-email", password: "MotDePasse123!" }).success).toBe(false);
    expect(registerSchema.safeParse({ firstName: "", email: "x@example.com", password: "MotDePasse123!" }).success).toBe(false);
    expect(registerSchema.safeParse({ firstName: "Awa", email: "x@example.com", password: "MotDePasse123!" }).success).toBe(true);
  });
});

describe("Connexion (§39 — connexion)", () => {
  it("connecte un client et met à jour lastLoginAt", async () => {
    const user = await createUser(t, { password: "MotDePasse123!" });
    const before = new Date(0);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: before } });

    const result = await login({ email: user.email, password: "MotDePasse123!" }, { ip: "127.0.0.1", userAgent: "vitest" });
    expect(result.user.id).toBe(user.id);
    expect(result.sid).toBeTruthy();

    const session = await findActiveSession(result.sid);
    expect(session?.user.id).toBe(user.id);
    const refreshed = await prisma.user.findUnique({ where: { id: user.id }, select: { lastLoginAt: true, lastLoginIp: true } });
    expect(refreshed?.lastLoginAt?.getTime()).toBeGreaterThan(before.getTime());
    expect(refreshed?.lastLoginIp).toBe("127.0.0.1");
  });

  it("rejette le mauvais mot de passe (400 INVALID_CREDENTIALS)", async () => {
    const user = await createUser(t, { password: "MotDePasse123!" });
    const err = await expectApiError(() => login({ email: user.email, password: "Mauvais123!" }, {}));
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(err.statusCode).toBe(400);
  });

  it("rejette un compte suspendu (400 ACCOUNT_SUSPENDED)", async () => {
    const user = await createUser(t, { password: "MotDePasse123!", status: "SUSPENDED" });
    const err = await expectApiError(() => login({ email: user.email, password: "MotDePasse123!" }, {}));
    expect(err.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("valide le schéma de connexion (e-mail obligatoire)", () => {
    expect(loginSchema.safeParse({ email: "x@example.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "x@example.com", password: "x" }).success).toBe(true);
  });
});

describe("Comptes administrateurs (§39 — permissions / accès non autorisé)", () => {
  it("connecte un STAFF via loginAdmin (sans MFA)", async () => {
    const staff = await createUser(t, { role: "STAFF", password: "MotDePasse123!" });
    const result = await loginAdmin({ email: staff.email, password: "MotDePasse123!" }, {});
    expect(result.role).toBe("STAFF");
    expect(result.setupRequired).toBe(false);
    const session = await findActiveSession(result.sid);
    expect(session?.isAdminSession).toBe(false);
  });

  it("ADMIN sans 2FA → session de configuration (setupRequired)", async () => {
    const admin = await createUser(t, { role: "ADMIN", password: "MotDePasse123!" });
    const result = await loginAdmin({ email: admin.email, password: "MotDePasse123!" }, {});
    expect(result.role).toBe("ADMIN");
    expect(result.setupRequired).toBe(true);
    const session = await findActiveSession(result.sid);
    expect(session?.isAdminSession).toBe(false);
  });

  it("ADMIN avec 2FA : code demandé, code faux refusé, mauvais mot de passe distinct", async () => {
    const admin = await createUser(t, { role: "ADMIN", password: "MotDePasse123!", twoFactorEnabled: true });
    const missing = await expectApiError(() => loginAdmin({ email: admin.email, password: "MotDePasse123!" }, {}));
    expect(missing.code).toBe("ACTION_REQUIRES_2FA");
    const wrongCode = await expectApiError(() =>
      loginAdmin({ email: admin.email, password: "MotDePasse123!", totpCode: "000000" }, {}),
    );
    expect(wrongCode.code).toBe("OTP_INVALID");
    // Mauvais mot de passe : on ne révèle pas qu'un code serait demandé.
    const wrongPassword = await expectApiError(() => loginAdmin({ email: admin.email, password: "Faux-mot-de-passe1" }, {}));
    expect(wrongPassword.code).toBe("INVALID_CREDENTIALS");
  });

  it("ADMIN sur la connexion standard : pas de session, double authentification demandée", async () => {
    const admin = await createUser(t, { role: "ADMIN", password: "MotDePasse123!" });
    const err = await expectApiError(() => login({ email: admin.email, password: "MotDePasse123!" }, {}));
    expect(err.code).toBe("ACTION_REQUIRES_2FA");
    // Mauvais mot de passe : même réponse que pour n'importe quel compte.
    const wrong = await expectApiError(() => login({ email: admin.email, password: "Mauvais123!" }, {}));
    expect(wrong.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("Connexion Google (§39 — connexion Google)", () => {
  const originalClientId = env.GOOGLE_OAUTH_CLIENT_ID;

  it("refuse le flux si le client OAuth n'est pas configuré", async () => {
    (env as { GOOGLE_OAUTH_CLIENT_ID?: string }).GOOGLE_OAUTH_CLIENT_ID = undefined;
    try {
      const err = await expectApiError(() => loginWithGoogle("valid-google-token", {}));
      expect(err.code).toBe("GOOGLE_OAUTH_NOT_CONFIGURED");
    } finally {
      (env as { GOOGLE_OAUTH_CLIENT_ID?: string }).GOOGLE_OAUTH_CLIENT_ID = originalClientId;
    }
  });

  it("crée le compte CLIENT au premier jeton valide puis réutilise le même compte", async () => {
    const first = await loginWithGoogle("valid-google-token", { ip: "127.0.0.1" });
    t.userIds.push(first.user.id);
    expect(first.user.role).toBe("CLIENT");
    expect(first.user.email).toBe("google-client@example.com");

    const again = await loginWithGoogle("valid-google-token", {});
    expect(again.user.id).toBe(first.user.id);

    const sessions = await prisma.session.count({ where: { userId: first.user.id } });
    expect(sessions).toBe(2);
  });

  it("refuse un jeton Google invalide", async () => {
    // Refus propre (400 INVALID_CREDENTIALS), plus d'erreur brute de la bibliothèque Google.
    await expect(loginWithGoogle("invalid-google-token", {})).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("refuse un compte non CLIENT (ex. STAFF) sur le flux Google", async () => {
    const staff = await createUser(t, { role: "STAFF" });
    await prisma.user.update({ where: { id: staff.id }, data: { email: "p13-google-staff@example.com" } });
    const err = await expectApiError(() => loginWithGoogle("valid-google-staff-token", {}));
    expect(err.code).toBe("INVALID_CREDENTIALS");
    await prisma.user.update({ where: { id: staff.id }, data: { email: staff.email } });
  });
});

describe("DTO public (jamais de champ sensible)", () => {
  it("toMeDto n'expose ni hash ni statut interne", async () => {
    const user = await createUser(t, {});
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const dto = toMeDto(row, "CLIENT");
    expect(Object.keys(dto)).not.toContain("passwordHash");
    expect(JSON.stringify(dto)).not.toContain("scrypt");
    expect(dto.id).toBe(user.id);
  });
});
