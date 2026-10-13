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
  resellerContract6Price: {
    label: "Contrat revendeur — 6 mois",
    help: "Prix du contrat de 6 mois (adhésion vendeur incluse). Commission pendant le contrat : 0 % le premier, 1 % au premier renouvellement, puis 2 %.",
    unit: "FCFA",
  },
  resellerContract12Price: {
    label: "Contrat revendeur — 1 an",
    help: "Prix du contrat de 12 mois (adhésion vendeur incluse). Commission pendant le contrat : 0 % le premier, 1 % au premier renouvellement, puis 2 %.",
    unit: "FCFA",
  },
  resellerContract18Price: {
    label: "Contrat revendeur — 18 mois",
    help: "Prix du contrat de 18 mois (adhésion vendeur incluse). Commission pendant le contrat : 0 % le premier, 1 % au premier renouvellement, puis 2 %.",
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
  unpaidOrderExpiryHours: {
    label: "Délai pour payer une commande",
    help: "Une commande jamais payée est annulée après ce délai, et le compte revient en vente. Si une capture de paiement Wave attend d'être vérifiée, la commande reste ouverte.",
    unit: "heures",
  },
  waveMerchantLink: {
    label: "Lien de paiement Wave",
    help: "Le lien de votre compte Wave Business (il commence par https://pay.wave.com/). Le montant à payer y est ajouté tout seul. Laissez vide pour couper le paiement par Wave.",
  },
  exchangeReplyHours: {
    label: "Délai de réponse du vendeur",
    help: "Quand un client propose un échange, le vendeur a ce temps pour annoncer le montant à ajouter ou refuser. Passé ce délai, la demande est fermée.",
    unit: "heures",
  },
  exchangeQuoteHours: {
    label: "Délai de réponse du client",
    help: "Après la réponse du vendeur, le client a ce temps pour accepter l'échange. Passé ce délai, la proposition est fermée.",
    unit: "heures",
  },
  exchangeVideoMaxMb: {
    label: "Taille maximale de la vidéo d'échange",
    help: "Le poids maximum de la vidéo que le client envoie pour montrer son compte.",
    unit: "Mo",
  },
  exchangeVideoRetentionDays: {
    label: "Conservation des vidéos d'échange",
    help: "Après la fin d'un échange, sa vidéo est effacée au bout de ce nombre de jours.",
    unit: "jours",
  },
  chatImageRetentionDays: {
    label: "Conservation des photos des messages",
    help: "Les photos envoyées dans les discussions sont effacées après ce nombre de jours, sauf si un signalement est en cours.",
    unit: "jours",
  },
  legalEntityName: {
    label: "Nom de l'entreprise",
    help: "Affiché sur les pages légales (mentions légales, conditions générales).",
  },
  legalAddress: {
    label: "Adresse de l'entreprise",
    help: "L'adresse du siège, affichée sur les pages légales.",
  },
  legalRegistration: {
    label: "NINEA / RCCM",
    help: "Les numéros d'immatriculation de l'entreprise, affichés sur les pages légales.",
  },
  legalPublisher: {
    label: "Responsable de la publication",
    help: "Le nom de la personne responsable du site, affiché sur les mentions légales.",
  },
};

export const GROUP_LABELS: Record<string, string> = {
  platform: "Le site",
  support: "Contacter le support",
  sellers: "Vendeurs",
  payments: "Paiements et mensualités",
  orders: "Commandes",
  exchanges: "Échanges de comptes",
  legal: "Pages légales",
  security: "Sécurité",
};

/** Nom d'un groupe : jamais le nom technique. */
export const groupLabel = (group: string | null | undefined) => (group && GROUP_LABELS[group]) || "Autres réglages";
