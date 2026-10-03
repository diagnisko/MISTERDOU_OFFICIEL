import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { decryptString, encryptString } from "../../lib/storage.js";
import { createSession } from "../../lib/sessions.js";
import { verifyPassword } from "../../lib/password.js";
import { logAudit } from "../../lib/audit.js";
import { env } from "../../env.js";
import { createTotpSecret, totpProvisioningUri, verifyTotp } from "./totp.js";

const INVALID_LOGIN = "Identifiants invalides";
const SETTINGS_GROUP = "security";

async function totpSettingKey(userId: string) {
  return `adminTotpSecret:${userId}`;
}

async function getTotpSecret(userId: string): Promise<string | null> {
  const setting = await prisma.settings.findUnique({ where: { key: await totpSettingKey(userId) }, select: { value: true } });
  if (typeof setting?.value !== "string") return null;
  try {
    return decryptString(setting.value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// « Se souvenir de cet appareil 30 jours » : après un code à 6 chiffres
// valide, un jeton signé est posé dans un cookie protégé. Le mot de passe reste
// toujours demandé ; seul le code est épargné. Le jeton meurt si le mot de passe
// ou le secret d'authentification change, ou après 30 jours.
// ---------------------------------------------------------------------------

export const TRUSTED_DEVICE_COOKIE = "md_trusted_device";
export const TRUSTED_DEVICE_DAYS = 30;
const TRUSTED_KEY = createHmac("sha256", env.COOKIE_SECRET).update("admin-trusted-device/v1").digest();

function trustedSignature(userId: string, exp: number, passwordHash: string, totpSecret: string): string {
  return createHmac("sha256", TRUSTED_KEY).update(`${userId}|${exp}|${passwordHash}|${totpSecret}`).digest("base64url");
}

function createTrustedToken(userId: string, passwordHash: string, totpSecret: string): string {
  const exp = Math.floor(Date.now() / 1000) + TRUSTED_DEVICE_DAYS * 86_400;
  return `${userId}.${exp}.${trustedSignature(userId, exp, passwordHash, totpSecret)}`;
}

function isTrustedToken(token: string | undefined, userId: string, passwordHash: string, totpSecret: string): boolean {
  if (!token) return false;
  const [id, expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (id !== userId || !sig || !Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(trustedSignature(userId, exp, passwordHash, totpSecret));
  const received = Buffer.from(sig);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function loginAdmin(
  input: { email: string; password: string; totpCode?: string; rememberDevice?: boolean; trustedToken?: string },
  ctx: { ip?: string; userAgent?: string },
) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, include: { role: { select: { name: true } } } });
  if (!user?.passwordHash || (user.role.name !== "ADMIN" && user.role.name !== "STAFF") || user.status !== "ACTIVE") throw badRequest("INVALID_CREDENTIALS", INVALID_LOGIN);
  if (!(await verifyPassword(input.password, user.passwordHash))) throw badRequest("INVALID_CREDENTIALS", INVALID_LOGIN);

  // L'équipe (STAFF) n'a pas de MFA : session standard, entrée par /admin.
  if (user.role.name === "STAFF") {
    const sid = await createSession({ userId: user.id, kind: "COOKIE", ip: ctx.ip, userAgent: ctx.userAgent, ttlSeconds: env.SESSION_TTL_SECONDS });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? undefined } });
    await logAudit({ actorId: user.id, actorRole: "STAFF", ip: ctx.ip, userAgent: ctx.userAgent, action: "LOGIN", resourceType: "User", resourceId: user.id });
    return { sid, setupRequired: false, role: "STAFF" as const, user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } };
  }

  const setupRequired = !user.twoFactorEnabled;
  let trustToken: string | null = null;
  let trustedDevice = false;
  if (!setupRequired) {
    const secret = await getTotpSecret(user.id);
    trustedDevice = Boolean(secret) && !input.totpCode && isTrustedToken(input.trustedToken, user.id, user.passwordHash, secret!);
    if (!trustedDevice) {
      // Mot de passe juste : on dit clairement ce qui manque (le code), au lieu
      // d'un « identifiants invalides » qui faisait croire à un mauvais mot de passe.
      if (!input.totpCode) throw badRequest("ACTION_REQUIRES_2FA", "Entrez le code à 6 chiffres de votre application d’authentification.");
      if (!secret || !verifyTotp(secret, input.totpCode)) {
        await logAudit({ actorId: user.id, actorRole: "ADMIN", ip: ctx.ip, userAgent: ctx.userAgent, action: "ADMIN_TOTP_FAILED", resourceType: "User", resourceId: user.id, severity: "WARNING" });
        throw badRequest("OTP_INVALID", "Code d’authentification incorrect ou expiré. Utilisez le code affiché en ce moment dans l’application.");
      }
      if (input.rememberDevice) trustToken = createTrustedToken(user.id, user.passwordHash, secret);
    }
  }

  const ttlSeconds = setupRequired ? env.ADMIN_SETUP_SESSION_TTL_SECONDS : env.ADMIN_SESSION_TTL_SECONDS;
  const sid = await createSession({ userId: user.id, kind: "COOKIE", ip: ctx.ip, userAgent: ctx.userAgent, ttlSeconds, isAdminSession: !setupRequired });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? undefined } });
  await logAudit({
    actorId: user.id,
    actorRole: "ADMIN",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    action: setupRequired ? "ADMIN_LOGIN_TOTP_SETUP_REQUIRED" : trustedDevice ? "ADMIN_LOGIN_TRUSTED_DEVICE" : "ADMIN_LOGIN",
    resourceType: "User",
    resourceId: user.id,
    metadata: trustToken ? { deviceRemembered: true } : undefined,
    severity: "WARNING",
  });
  return { sid, setupRequired, trustToken, role: "ADMIN" as const, user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } };
}

export async function startAdminTotpSetup(actor: { id: string; email: string | null; role?: { name: RoleName } | null }) {
  if (actor.role?.name !== "ADMIN") throw forbidden();
  const secret = await getTotpSecret(actor.id) ?? createTotpSecret();
  await prisma.settings.upsert({
    where: { key: await totpSettingKey(actor.id) },
    create: { key: await totpSettingKey(actor.id), value: encryptString(secret), valueType: "string", group: SETTINGS_GROUP, description: "Secret MFA chiffré de l’administrateur" },
    update: { value: encryptString(secret) },
  });
  await logAudit({ actorId: actor.id, actorRole: "ADMIN", action: "ADMIN_TOTP_SECRET_VIEWED", resourceType: "User", resourceId: actor.id, severity: "CRITICAL" });
  return { secret, otpauthUri: totpProvisioningUri(actor.email ?? actor.id, secret) };
}

export async function confirmAdminTotp(actor: { id: string; email: string | null; role?: { name: RoleName } | null }, sessionId: string, code: string) {
  if (actor.role?.name !== "ADMIN") throw forbidden();
  const secret = await getTotpSecret(actor.id);
  if (!secret || !verifyTotp(secret, code)) throw badRequest("OTP_INVALID", "Code d’authentification invalide.");

  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { twoFactorEnabled: true } });
    return tx.session.updateMany({
      where: { id: sessionId, userId: actor.id, isAdminSession: false, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { isAdminSession: true, expiresAt: new Date(Date.now() + env.ADMIN_SESSION_TTL_SECONDS * 1000) },
    });
  });
  if (updated.count !== 1) throw notFound("Session temporaire expirée. Reconnectez-vous.");
  await logAudit({ actorId: actor.id, actorRole: "ADMIN", action: "ADMIN_TOTP_ENABLED", resourceType: "User", resourceId: actor.id, severity: "CRITICAL" });
  return { enabled: true };
}
