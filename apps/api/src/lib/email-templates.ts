import type { NotificationType } from "@misterdou/db";

// Registre des notifications critiques envoyées aussi par e-mail (§30, §61).
// Sujets/corps en français ; les paramètres restent volontairement souples.

export interface EmailTemplateParams {
  title: string;
  message: string;
  actionUrl?: string;
}

export interface EmailTemplate {
  subject: (params: EmailTemplateParams) => string;
  text: (params: EmailTemplateParams) => string;
}

function template(fallbackSubject: string): EmailTemplate {
  return {
    subject: (p) => p.title.trim() || fallbackSubject,
    text: (p) => `${p.message}${p.actionUrl ? `\n\n${p.actionUrl}` : ""}`,
  };
}

export const EMAIL_TEMPLATES: Partial<Record<NotificationType, EmailTemplate>> = {
  KYC_VERIFIED: template("Votre identité est vérifiée"),
  KYC_REJECTED: template("Action requise sur votre dossier de vérification"),
  ORDER_REFUNDED: template("Votre commande a été remboursée"),
  PAYMENT_CONFIRMED: template("Votre paiement est confirmé"),
  INSTALLMENT_OVERDUE: template("Échéance de paiement en retard"),
  SELLER_PAYOUT_AVAILABLE: template("Votre paiement vendeur est disponible"),
  ADMIN_ALERT: template("Alerte administrateur MISTERDOU"),
  FEATURED_EXPIRED: template("Votre mise en avant a expiré"),
  SECURITY_ALERT: template("Alerte de sécurité sur votre compte"),
};

export function isCriticalEmailType(type: NotificationType): boolean {
  return EMAIL_TEMPLATES[type] !== undefined;
}
