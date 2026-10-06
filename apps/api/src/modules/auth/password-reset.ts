import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { env } from "../../env.js";
import { ApiError, badRequest, notFound } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { sendEmail } from "../../lib/email.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";

// ---------------------------------------------------------------------------
// Mot de passe oublié, deux chemins :
// - le client demande un code à 6 chiffres reçu par e-mail (15 minutes,
//   5 essais, un seul code valable à la fois) ;
// - l'administrateur crée un lien signé (30 minutes, usage unique : la
//   signature inclut l'empreinte du mot de passe actuel) et l'envoie lui-même
//   au client (WhatsApp…), utile tant que l'e-mail n'est pas configuré.
// ---------------------------------------------------------------------------

const RESET_TTL_MINUTES = 30;
const RESET_KEY = createHmac("sha256", env.COOKIE_SECRET).update("password-reset/v1").digest();

export const forgotPasswordSchema = z.object({ email: z.email("E-mail invalide") });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(300),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum").max(72, "Mot de passe trop long"),
});

type ResetActor = { actorId?: string; actorRole?: RoleName; ip?: string };

function signature(userId: string, exp: number, passwordHash: string | null): string {
  return createHmac("sha256", RESET_KEY).update(`${userId}|${exp}|${passwordHash ?? ""}`).digest("base64url");
}

function createToken(user: { id: string; passwordHash: string | null }, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + RESET_TTL_MINUTES * 60;
  return `${user.id}.${exp}.${signature(user.id, exp, user.passwordHash)}`;
}

function resetLink(token: string): string {
  return `${env.WEB_ORIGIN[0]}/mot-de-passe-oublie/nouveau?token=${encodeURIComponent(token)}`;
}

// --- Code à 6 chiffres par e-mail (parcours public) ------------------------

const CODE_TTL_MINUTES = 15;
const CODE_MAX_ATTEMPTS = 5;
const CODE_COOLDOWN_SECONDS = 60;
const CODE_MAX_PER_HOUR = 5;
const CODE_KEY = createHmac("sha256", env.COOKIE_SECRET).update("password-reset-code/v1").digest();

export const resetWithCodeSchema = z.object({
  email: z.email("E-mail invalide"),
  code: z.string().trim().regex(/^\d{6}$/, "Le code contient 6 chiffres."),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum").max(72, "Mot de passe trop long"),
});

function codeHash(userId: string, code: string): string {
  return createHmac("sha256", CODE_KEY).update(`${userId}|${code}`).digest("base64url");
}

/**
 * Envoie un code au titulaire du compte. Décision du 2026-10-06 : un e-mail
 * inconnu est signalé tout de suite (« pas enregistré ») au lieu d'un faux
 * « code envoyé ». Un compte administrateur est traité comme inconnu (il se
 * réinitialise avec admin:reset) ; la route reste limitée à 3 demandes par minute.
 */
export async function requestPasswordReset(email: string, ctx: ResetActor): Promise<{ sent: true }> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, deletedAt: null, role: { name: { not: "ADMIN" } } },
    select: { id: true, email: true, firstName: true, status: true },
  });
  if (!user?.email) {
    throw new ApiError("EMAIL_NOT_REGISTERED", 404, "Cet e-mail n’est enregistré sur aucun compte MISTERDOU. Vérifiez l’adresse ou créez un compte.");
  }
  if (user.status !== "ACTIVE") {
    throw new ApiError("ACCOUNT_SUSPENDED", 403, "Ce compte est suspendu : contactez le support pour le réactiver.");
  }

  // Anti-abus : un code par minute, cinq par heure (sans le dire au demandeur).
  const now = Date.now();
  const recent = await prisma.passwordResetCode.findMany({
    where: { userId: user.id, createdAt: { gt: new Date(now - 3_600_000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent.length >= CODE_MAX_PER_HOUR) return { sent: true };
  if (recent[0] && now - recent[0].createdAt.getTime() < CODE_COOLDOWN_SECONDS * 1000) return { sent: true };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Un seul code valable à la fois : les précédents meurent.
  await prisma.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date(now) } });
  await prisma.passwordResetCode.create({
    data: { userId: user.id, codeHash: codeHash(user.id, code), expiresAt: new Date(now + CODE_TTL_MINUTES * 60_000) },
  });
  await sendEmail({
    to: user.email,
    subject: "Votre code MISTERDOU pour changer de mot de passe",
    text:
      `Bonjour${user.firstName ? ` ${user.firstName}` : ""},\n\n` +
      `Votre code : ${code}\n\n` +
      `Saisissez-le sur la page « Mot de passe oublié » (valable ${CODE_TTL_MINUTES} minutes) pour choisir un nouveau mot de passe.\n\n` +
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé. " +
      "MISTERDOU ne vous demandera jamais ce code par téléphone ou par message.",
    template: "SECURITY_ALERT",
  });
  await logAudit({ actorId: user.id, ip: ctx.ip, action: "PASSWORD_RESET_REQUESTED", resourceType: "User", resourceId: user.id });
  return { sent: true };
}

/** Nouveau mot de passe avec le code reçu. Toute erreur a le même message (aucune fuite). */
export async function resetPasswordWithCode(
  input: { email: string; code: string; password: string },
  ctx: ResetActor,
): Promise<{ reset: true }> {
  const invalid = () => badRequest("VALIDATION_ERROR", "Code incorrect ou expiré : vérifiez-le ou demandez-en un nouveau.");
  const user = await prisma.user.findFirst({
    where: { email: input.email.trim().toLowerCase(), deletedAt: null, status: "ACTIVE", role: { name: { not: "ADMIN" } } },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user) throw invalid();
  const current = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: CODE_MAX_ATTEMPTS } },
    orderBy: { createdAt: "desc" },
  });
  if (!current) throw invalid();

  const expected = Buffer.from(current.codeHash);
  const received = Buffer.from(codeHash(user.id, input.code.trim()));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    await prisma.passwordResetCode.update({ where: { id: current.id }, data: { attempts: { increment: 1 } } });
    throw invalid();
  }
  // Usage unique, même si deux demandes arrivent en même temps.
  const claim = await prisma.passwordResetCode.updateMany({
    where: { id: current.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claim.count === 0) throw invalid();

  await prisma.user.update({
    where: { id: user.id },
    // Le code reçu prouve que l'adresse lui appartient.
    data: { passwordHash: await hashPassword(input.password), ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
  });
  await finishReset(user.id, ctx);
  return { reset: true };
}

/** Après tout changement par oubli : sessions fermées, trace, alerte au titulaire. */
async function finishReset(userId: string, ctx: ResetActor) {
  const revoked = await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await logAudit({
    actorId: userId,
    ip: ctx.ip,
    action: "PASSWORD_RESET",
    resourceType: "User",
    resourceId: userId,
    metadata: { sessionsClosed: revoked.count },
    severity: "WARNING",
  });
  await notifyUser(userId, "SECURITY_ALERT", {
    title: "Mot de passe réinitialisé",
    message: "Votre mot de passe vient d’être réinitialisé et vos autres connexions ont été fermées. Si ce n’était pas vous, contactez le support immédiatement.",
    actionUrl: "/account/settings",
    priority: "CRITICAL",
  });
}

/** Lien créé par un administrateur (aucun e-mail envoyé : il le transmet lui-même). */
export async function adminPasswordResetLink(userId: string, actor: ResetActor & { actorId: string }) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true, status: true, role: { select: { name: true } } },
  });
  if (!user) throw notFound("Compte introuvable.");
  if (user.role.name === "ADMIN") throw badRequest("VALIDATION_ERROR", "Un administrateur se réinitialise avec la commande admin:reset.");
  if (user.status !== "ACTIVE") throw badRequest("VALIDATION_ERROR", "Ce compte est suspendu : réactivez-le d’abord.");
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "PASSWORD_RESET_LINK_CREATED",
    resourceType: "User",
    resourceId: user.id,
    severity: "CRITICAL",
  });
  return { link: resetLink(createToken(user)), expiresInMinutes: RESET_TTL_MINUTES };
}

export async function resetPassword(token: string, password: string, ctx: ResetActor): Promise<{ reset: true }> {
  const invalid = () => badRequest("VALIDATION_ERROR", "Ce lien n’est plus valable : refaites une demande de réinitialisation.");
  const [userId, expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!userId || !sig || !Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) throw invalid();

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, passwordHash: true, role: { select: { name: true } } },
  });
  if (!user || user.role.name === "ADMIN") throw invalid();
  const expected = Buffer.from(signature(user.id, exp, user.passwordHash));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalid();

  const claim = await prisma.user.updateMany({
    // Le mot de passe n'a pas changé entre-temps (lien à usage unique).
    where: { id: user.id, passwordHash: user.passwordHash },
    data: { passwordHash: await hashPassword(password) },
  });
  if (claim.count === 0) throw invalid();
  await finishReset(user.id, ctx);
  return { reset: true };
}
