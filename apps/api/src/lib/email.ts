import type { NotificationType } from "@misterdou/db";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Envoi d'e-mails — transport SMTP réel via nodemailer quand SMTP_URL est
// configuré (ex. smtp://user:pass@host:587). Sans configuration, on repasse
// en mode "outbox" (log seul) pour ne jamais casser le développement local.
// Ne lève JAMAIS d'exception — un e-mail ne fait pas échouer l'action métier.
// ---------------------------------------------------------------------------

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  template: NotificationType;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!env.SMTP_URL) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

export async function sendEmail(input: EmailInput): Promise<{ queued: boolean }> {
  const client = getTransporter();
  if (!client) {
    logger.info(
      { outbox: true, to: input.to, subject: input.subject, template: input.template },
      "[email] SMTP non configuré — message journalisé uniquement",
    );
    return { queued: false };
  }
  try {
    await client.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    logger.info({ to: input.to, subject: input.subject, template: input.template }, "[email] envoyé");
    return { queued: true };
  } catch (err) {
    logger.error({ err, to: input.to, template: input.template }, "[email] échec d'envoi SMTP");
    return { queued: false };
  }
}
