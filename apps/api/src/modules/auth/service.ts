import { prisma } from "@misterdou/db";
import type { UserStatus } from "@misterdou/db";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { createSession } from "../../lib/sessions.js";
import { conflict, badRequest } from "../../lib/errors.js";
import { notifyActiveAdmins } from "../../lib/notify.js";
import { env } from "../../env.js";
import type { RegisterInput, LoginInput, MeDto, RoleName } from "@misterdou/shared";
import { sendVerificationEmail } from "./email-verification.js";

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
}, role: RoleName = "CLIENT"): MeDto {
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
  // Lien de confirmation de l'adresse (non bloquant).
  await sendVerificationEmail(user).catch(() => undefined);

  return { user: toMeDto(user), sid };
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
  // Administrateur : la session s'ouvre par /auth/admin/login (double authentification).
  // La page de connexion enchaîne seule sur le code à 6 chiffres.
  if (user.role.name === "ADMIN") throw badRequest("ACTION_REQUIRES_2FA", "Compte d’administration : entrez le code à 6 chiffres de votre application d’authentification.");
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

  return { user: toMeDto(user, user.role.name), sid, previousLoginAt };
}

// ---------------------------------------------------------------------------
// Google OAuth — flux complet (actif dès que GOOGLE_OAUTH_CLIENT_ID est posé)
// ---------------------------------------------------------------------------

export async function loginWithGoogle(
  idToken: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ user: MeDto; sid: string; created: boolean; previousLoginAt: string | null }> {
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
    user: toMeDto(complete, complete.role.name),
    sid,
    created,
    previousLoginAt,
  };
}
