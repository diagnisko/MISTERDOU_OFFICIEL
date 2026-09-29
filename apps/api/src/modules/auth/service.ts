import { randomInt } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { UserStatus } from "@misterdou/db";
import { normalizePhone } from "../../lib/phone.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { createSession } from "../../lib/sessions.js";
import { conflict, badRequest } from "../../lib/errors.js";
import { notifyActiveAdmins } from "../../lib/notify.js";
import { env } from "../../env.js";
import { logger } from "../../lib/logger.js";
import type { RegisterInput, LoginInput, OtpRequestInput, OtpVerifyInput, MeDto, RoleName } from "@misterdou/shared";

export function toMeDto(user: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  status: UserStatus;
  twoFactorEnabled: boolean;
  createdAt: Date;
}, phoneVerified = false, role: RoleName = "CLIENT"): MeDto {
  return {
    id: user.id,
    role,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    countryCode: user.countryCode,
    phoneNumber: user.phoneNumber,
    status: user.status,
    twoFactorEnabled: user.twoFactorEnabled,
    phoneVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

const CLIENT_ROLE_ID_CACHE = new Map<string, string>();

async function clientRoleId(): Promise<string> {
  if (CLIENT_ROLE_ID_CACHE.has("CLIENT")) return CLIENT_ROLE_ID_CACHE.get("CLIENT")!;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "CLIENT" } });
  CLIENT_ROLE_ID_CACHE.set("CLIENT", role.id);
  return role.id;
}

// ---------------------------------------------------------------------------
// Inscription classique (e-mail + prénom + mot de passe) — le téléphone reste
// optionnel, rattachable plus tard via /auth/phone (KYC, profil).
// ---------------------------------------------------------------------------

export async function register(input: RegisterInput, ctx: { ip?: string; userAgent?: string }) {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw conflict("EMAIL_ALREADY_REGISTERED", "Cet e-mail est déjà enregistré");
  }

  const passwordHash = await hashPassword(input.password);
  const roleId = await clientRoleId();

  const user = await prisma.user.create({
    data: {
      roleId,
      email,
      firstName: input.firstName.trim(),
      passwordHash,
      notificationPreference: { create: {} },
    },
    include: { role: { select: { name: true } } },
  });

  const sid = await createSession({
    userId: user.id,
    kind: "COOKIE",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ttlSeconds: env.SESSION_TTL_SECONDS,
  });

  await notifyActiveAdmins("ADMIN_ALERT", {
    title: "Nouveau client",
    message: `${email} vient de créer un compte.`,
    actionUrl: "/admin/clients",
    priority: "NORMAL",
  });

  return { user: toMeDto(user), sid, phoneVerified: false, requiresOtp: false };
}

// ---------------------------------------------------------------------------
// Connexion (e-mail + mot de passe)
// ---------------------------------------------------------------------------

export async function login(
  input: LoginInput,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ user: MeDto; sid: string; previousLoginAt: string | null }> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: { select: { name: true } } },
  });

  // Même message pour utilisateur inconnu ou mauvais mot de passe (anti-enumeration)
  const INVALID = "Identifiants invalides";
  if (!user?.passwordHash) throw badRequest("INVALID_CREDENTIALS", INVALID);

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw badRequest("INVALID_CREDENTIALS", INVALID);
  // Les administrateurs passent par /auth/admin/login (2FA).
  if (user.role.name === "ADMIN") throw badRequest("INVALID_CREDENTIALS", INVALID);
  if (user.status !== "ACTIVE") throw badRequest("ACCOUNT_SUSPENDED", "Compte suspendu. Contactez l'administration.");

  const previousLoginAt = user.lastLoginAt?.toISOString() ?? null;
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? undefined },
  });

  const sid = await createSession({
    userId: user.id,
    kind: "COOKIE",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ttlSeconds: env.SESSION_TTL_SECONDS,
  });

  return { user: toMeDto(user, false, user.role.name), sid, previousLoginAt };
}

// ---------------------------------------------------------------------------
// OTP téléphone (request / verify)
// ---------------------------------------------------------------------------

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;

export async function requestOtp(
  input: OtpRequestInput,
  ctx: { actorId: string; ip?: string; userAgent?: string },
): Promise<{ requested: boolean; alreadyVerified: boolean; expiresInSeconds: number; devCode?: string }> {
  const phone = normalizePhone(input.countryCode, input.phoneNumber);
  const user = await prisma.user.findUnique({ where: { id: ctx.actorId } });
  if (!user || user.phoneNumber !== phone) throw badRequest("NOT_FOUND", "Numéro de téléphone invalide.");

  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const codeHash = await hashPassword(code);

  const existing = await prisma.phoneVerification.findFirst({ where: { userId: user.id } });
  if (existing && existing.status === "VERIFIED") {
    return { requested: false, alreadyVerified: true, expiresInSeconds: 0 };
  }
  if (existing && existing.updatedAt > new Date(Date.now() - 60 * 60 * 1000) && existing.requestedTimes >= 5) {
    throw badRequest("RATE_LIMITED", "Trop de codes demandés. Réessayez dans une heure.");
  }

  const row = await prisma.phoneVerification.upsert({
    where: { id: existing?.id ?? "__unused__" },
    create: {
      userId: user.id,
      phoneNumber: phone,
      countryCode: input.countryCode,
      otpCodeHash: codeHash,
      otpExpiresAt: expiresAt,
      status: "PENDING",
      requestedTimes: 1,
    },
    update: {
      phoneNumber: phone,
      countryCode: input.countryCode,
      otpCodeHash: codeHash,
      otpExpiresAt: expiresAt,
      otpAttempts: 0,
      status: "PENDING",
      requestedTimes: existing && existing.updatedAt > new Date(Date.now() - 60 * 60 * 1000)
        ? { increment: 1 }
        : 1,
    },
  });

  // Livraison du code : provider SMS branché en Phase 10 ;
  // en développement le code est RENVOYÉ par l'API (devCode) pour permettre les tests e2e.
  if (env.NODE_ENV === "development") {
    logger.info({ phone, otpCode: code, rowId: row.id }, "[dev] code OTP généré");
  }

  return {
    requested: true,
    alreadyVerified: false,
    expiresInSeconds: OTP_TTL_MS / 1000,
    ...(env.NODE_ENV === "development" ? { devCode: code } : {}),
  };
}

export async function verifyOtp(
  input: OtpVerifyInput,
  ctx: { actorId: string; ip?: string; userAgent?: string },
): Promise<{ verified: boolean }> {
  const phone = normalizePhone(input.countryCode, input.phoneNumber);
  const user = await prisma.user.findUnique({ where: { id: ctx.actorId } });
  if (!user || user.phoneNumber !== phone) throw badRequest("NOT_FOUND", "Numéro de téléphone invalide.");

  const pv = await prisma.phoneVerification.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (!pv?.otpCodeHash || !pv.otpExpiresAt) throw badRequest("OTP_INVALID", "Demandez un nouveau code.");
  if (pv.otpAttempts >= OTP_MAX_ATTEMPTS) {
    throw badRequest("OTP_TOO_MANY_ATTEMPTS", "Trop de tentatives. Demandez un nouveau code.");
  }
  if (pv.otpExpiresAt < new Date()) throw badRequest("OTP_EXPIRED", "Code expiré. Demandez un nouveau code.");

  // Verrou atomique : chaque tentative consomme UNE place (UPDATE … WHERE
  // otpAttempts < max) — impossible de contourner la limite par requêtes
  // parallèles (read-then-write non atomique).
  const claimed = await prisma.phoneVerification.updateMany({
    where: { id: pv.id, status: "PENDING", otpAttempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { otpAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw badRequest("OTP_TOO_MANY_ATTEMPTS", "Trop de tentatives. Demandez un nouveau code.");
  }

  const ok = await verifyPassword(input.code, pv.otpCodeHash);
  if (!ok) {
    throw badRequest("OTP_INVALID", "Code incorrect.");
  }

  await prisma.phoneVerification.update({
    where: { id: pv.id },
    data: {
      status: "VERIFIED",
      verifiedAt: new Date(),
      verifiedAtIp: ctx.ip ?? undefined,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
    },
  });

  return { verified: true };
}

// ---------------------------------------------------------------------------
// Google OAuth — flux complet (actif dès que GOOGLE_OAUTH_CLIENT_ID est posé)
// ---------------------------------------------------------------------------

export async function loginWithGoogle(
  idToken: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ user: MeDto; sid: string; phoneRequired: boolean; created: boolean; previousLoginAt: string | null }> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    throw badRequest(
      "GOOGLE_OAUTH_NOT_CONFIGURED",
      "Connexion Google non configurée (GOOGLE_OAUTH_CLIENT_ID manquant)",
    );
  }
  const { OAuth2Client } = await import("google-auth-library");
  const client = new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID);
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_OAUTH_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw badRequest("INVALID_CREDENTIALS", "Jeton Google invalide");

  const googleSub = payload.sub;
  const googleEmail = payload.email.toLowerCase();

  let user = await prisma.user.findUnique({ where: { googleSub } });
  if (!user) user = await prisma.user.findUnique({ where: { email: googleEmail } });

  let created = false;
  if (!user) {
    const roleId = await clientRoleId();
    user = await prisma.user.create({
      data: {
        roleId,
        email: googleEmail,
        emailVerifiedAt: payload.email_verified ? new Date() : null,
        googleSub,
        googleEmail,
        notificationPreference: { create: {} },
      },
    });
    created = true;
  } else if (!user.googleSub) {
    user = await prisma.user.update({ where: { id: user.id }, data: { googleSub } });
  }

  const complete = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { role: { select: { name: true } } },
  });
  if (complete.role.name === "ADMIN" || complete.role.name === "STAFF") {
    throw badRequest("INVALID_CREDENTIALS", "Identifiants invalides");
  }
  const previousLoginAt = complete.lastLoginAt?.toISOString() ?? null;
  await prisma.user.update({
    where: { id: complete.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? undefined },
  });

  const sid = await createSession({
    userId: complete.id,
    kind: "COOKIE",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ttlSeconds: env.SESSION_TTL_SECONDS,
  });

  if (created) {
    await notifyActiveAdmins("ADMIN_ALERT", {
      title: "Nouveau client",
      message: `${googleEmail} vient de créer un compte (Google).`,
      actionUrl: "/admin/clients",
      priority: "NORMAL",
    });
  }

  return {
    user: toMeDto(complete, false, complete.role.name),
    sid,
    phoneRequired: complete.phoneNumber === null,
    created,
    previousLoginAt,
  };
}

// ---------------------------------------------------------------------------
// Attacher un téléphone (première connexion Google), puis OTP requis
// ---------------------------------------------------------------------------

export async function setPhone(
  userId: string,
  input: { countryCode: string; phoneNumber: string },
): Promise<{ ok: true }> {
  const phone = normalizePhone(input.countryCode, input.phoneNumber);
  const existing = await prisma.user.findUnique({ where: { phoneNumber: phone } });
  if (existing && existing.id !== userId) {
    throw conflict("PHONE_ALREADY_REGISTERED", "Ce numéro de téléphone est déjà enregistré");
  }
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true } });
  if (current?.phoneNumber !== phone) {
    await prisma.phoneVerification.updateMany({
      where: { userId },
      data: { status: "UNVERIFIED", verifiedAt: null, otpCodeHash: null, otpExpiresAt: null, otpAttempts: 0, requestedTimes: 0 },
    });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { countryCode: input.countryCode, phoneNumber: phone },
  });
  return { ok: true };
}