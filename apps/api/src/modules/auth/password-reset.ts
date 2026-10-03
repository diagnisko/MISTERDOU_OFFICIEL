import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { env } from "../../env.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { sendEmail } from "../../lib/email.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";

// ---------------------------------------------------------------------------
// Mot de passe oublié — lien signé, valable 30 minutes, à usage unique : la
// signature inclut l'empreinte du mot de passe actuel, donc le lien meurt dès
// que le mot de passe change. Aucune table supplémentaire.
// Sans SMTP configuré, l'administrateur peut créer le lien depuis la console
// et l'envoyer lui-même au client (WhatsApp, e-mail).
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

/** Envoie le lien si le compte existe ; la réponse ne dit jamais s'il existe. */
export async function requestPasswordReset(email: string, ctx: ResetActor): Promise<{ sent: true }> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), deletedAt: null, status: "ACTIVE" },
    select: { id: true, email: true, firstName: true, passwordHash: true },
  });
  if (!user?.email) return { sent: true };

  const link = resetLink(createToken(user));
  await sendEmail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe MISTERDOU",
    text:
      `Bonjour${user.firstName ? ` ${user.firstName}` : ""},\n\n` +
      `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable ${RESET_TTL_MINUTES} minutes) :\n${link}\n\n` +
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.",
    template: "SECURITY_ALERT",
  });
  await logAudit({ actorId: user.id, ip: ctx.ip, action: "PASSWORD_RESET_REQUESTED", resourceType: "User", resourceId: user.id });
  return { sent: true };
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
  const revoked = await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });

  await logAudit({
    actorId: user.id,
    ip: ctx.ip,
    action: "PASSWORD_RESET",
    resourceType: "User",
    resourceId: user.id,
    metadata: { sessionsClosed: revoked.count },
    severity: "WARNING",
  });
  await notifyUser(user.id, "SECURITY_ALERT", {
    title: "Mot de passe réinitialisé",
    message: "Votre mot de passe vient d’être réinitialisé et vos autres connexions ont été fermées. Si ce n’était pas vous, contactez le support immédiatement.",
    actionUrl: "/account/settings",
    priority: "CRITICAL",
  });
  return { reset: true };
}
