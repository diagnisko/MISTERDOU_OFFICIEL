import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { env } from "../../env.js";
import { badRequest } from "../../lib/errors.js";
import { sendEmail } from "../../lib/email.js";
import { logAudit } from "../../lib/audit.js";

// ---------------------------------------------------------------------------
// Vérification de l'adresse e-mail : lien signé (7 jours) envoyé à
// l'inscription, renvoyable depuis le compte. Elle n'est pas bloquante : elle
// confirme que l'adresse appartient bien au client (mot de passe oublié, alertes).
// Le lien meurt si l'adresse du compte change.
// ---------------------------------------------------------------------------

const VERIFY_TTL_DAYS = 7;
const VERIFY_KEY = createHmac("sha256", env.COOKIE_SECRET).update("email-verification/v1").digest();

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(300) });

function signature(userId: string, exp: number, email: string): string {
  return createHmac("sha256", VERIFY_KEY).update(`${userId}|${exp}|${email}`).digest("base64url");
}

/** Lien de confirmation (7 jours) pour l'adresse actuelle du compte. */
export function verificationLink(user: { id: string; email: string }): string {
  const exp = Math.floor(Date.now() / 1000) + VERIFY_TTL_DAYS * 86_400;
  const token = `${user.id}.${exp}.${signature(user.id, exp, user.email)}`;
  return `${env.WEB_ORIGIN[0]}/verifier-email?token=${encodeURIComponent(token)}`;
}

/** Envoie le lien de vérification (ne lève jamais : l'inscription n'en dépend pas). */
export async function sendVerificationEmail(user: { id: string; email: string | null; firstName: string | null }): Promise<void> {
  if (!user.email) return;
  const link = verificationLink({ id: user.id, email: user.email });
  await sendEmail({
    to: user.email,
    subject: "Confirmez votre adresse e-mail MISTERDOU",
    text:
      `Bonjour${user.firstName ? ` ${user.firstName}` : ""},\n\n` +
      `Pour confirmer que cette adresse vous appartient, ouvrez ce lien (valable ${VERIFY_TTL_DAYS} jours) :\n${link}\n\n` +
      "Si vous n'avez pas créé de compte MISTERDOU, ignorez cet e-mail.",
    template: "SECURITY_ALERT",
  });
}

export async function resendVerificationEmail(userId: string): Promise<{ sent: boolean; alreadyVerified: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, emailVerifiedAt: true } });
  if (!user?.email) return { sent: false, alreadyVerified: false };
  if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };
  await sendVerificationEmail(user);
  return { sent: true, alreadyVerified: false };
}

export async function verifyEmail(token: string, ctx: { ip?: string }): Promise<{ verified: true }> {
  const invalid = () => badRequest("VALIDATION_ERROR", "Ce lien de confirmation n’est plus valable : renvoyez-en un depuis votre compte.");
  const [userId, expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!userId || !sig || !Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) throw invalid();
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (!user?.email) throw invalid();
  const expected = Buffer.from(signature(user.id, exp, user.email));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalid();
  if (!user.emailVerifiedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await logAudit({ actorId: user.id, ip: ctx.ip, action: "EMAIL_VERIFIED", resourceType: "User", resourceId: user.id });
  }
  return { verified: true };
}
