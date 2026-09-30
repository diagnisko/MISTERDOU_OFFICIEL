// Libellés compréhensibles des paramètres de la plateforme : le nom technique
// (clé) reste en base, l'administrateur voit une phrase claire.

export type SettingLabel = {
  label: string;
  help: string;
  /** Unité affichée à côté du champ (FCFA, %, jours…). */
  unit?: string;
  /** Valeurs possibles, avec leur libellé (liste déroulante). */
  options?: Array<{ value: string; label: string }>;
};

export const SETTING_LABELS: Record<string, SettingLabel> = {
  supportWhatsapp: {
    label: "Numéro WhatsApp du support",
    help: "Affiché sur la page « Aide et support » et sous les signalements. Laissez vide pour masquer le bouton WhatsApp.",
  },
  supportEmail: {
    label: "E-mail du support",
    help: "Affiché sur la page « Aide et support ». Laissez vide pour masquer le bouton e-mail.",
  },
  platformName: {
    label: "Nom du site",
    help: "Le nom affiché aux clients dans les e-mails et les pages.",
  },
  currency: {
    label: "Monnaie",
    help: "La monnaie des prix. XOF = franc CFA.",
  },
  sellerCommissionPercent: {
    label: "Commission sur chaque vente",
    help: "La part que MISTERDOU garde sur chaque vente d'un vendeur. Le reste revient au vendeur.",
    unit: "%",
  },
  sellerRegistrationFee: {
    label: "Prix pour devenir vendeur",
    help: "Ce qu'un client paie une seule fois pour ouvrir son compte vendeur.",
    unit: "FCFA",
  },
  payoutHoldDays: {
    label: "Délai avant de libérer l'argent du vendeur",
    help: "Si l'acheteur ne clique pas sur « Reçu », l'argent de la vente est rendu disponible au vendeur après ce nombre de jours (sauf signalement en cours).",
    unit: "jours",
  },
  minWithdrawalAmount: {
    label: "Retrait minimum d'un vendeur",
    help: "Le plus petit montant qu'un vendeur peut demander à retirer.",
    unit: "FCFA",
  },
  featuredDailyRate: {
    label: "Prix d'une journée de mise en avant",
    help: "Ce que paie un vendeur pour que son offre soit mise en avant pendant un jour.",
    unit: "FCFA / jour",
  },
  maxInstallments: {
    label: "Nombre maximum de mensualités",
    help: "Le plus grand nombre de mois qu'un vendeur peut proposer pour payer un compte en plusieurs fois.",
    unit: "mois",
  },
  installmentRounding: {
    label: "Où placer les centimes des mensualités",
    help: "Quand le total ne se divise pas exactement, la différence est ajoutée à une mensualité.",
    options: [
      { value: "FIRST", label: "Sur la première mensualité" },
      { value: "LAST", label: "Sur la dernière mensualité" },
      { value: "BALANCED", label: "Répartie sur toutes les mensualités" },
    ],
  },
  verificationCodeTtlMinutes: {
    label: "Durée de validité d'un code de vérification",
    help: "Combien de temps le code donné à l'acheteur pour se connecter au compte reste valable.",
    unit: "minutes",
  },
};

export const GROUP_LABELS: Record<string, string> = {
  platform: "Le site",
  support: "Contacter le support",
  sellers: "Vendeurs",
  payments: "Paiements et mensualités",
  orders: "Commandes",
};
