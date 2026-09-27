import type { NotificationType } from "@misterdou/db";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Envoi d'e-mails — Phase 10 : OUTBOX structurée uniquement, zéro dépendance
// installée. Le transport SMTP (nodemailer + identifiants) se branche ICI en
// Phase 14 (docs/08) : il suffira de remplacer le log par l'envoi réel.
// Ne leve JAMAIS d'exception — un e-mail ne fait pas échouer l'action métier.
// ---------------------------------------------------------------------------

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  template: NotificationType;
}

export async function sendEmail(input: EmailInput): Promise<{ queued: boolean }> {
  try {
    logger.info(
      { outbox: true, to: input.to, subject: input.subject, template: input.template },
      "[email] outbox",
    );
    return { queued: true };
  } catch {
    return { queued: false };
  }
}
