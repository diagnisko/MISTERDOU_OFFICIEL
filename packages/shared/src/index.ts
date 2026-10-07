// MISTERDOU — contrat partagé Web <-> API
// Enums métier, schémas zod, types de réponse. Source unique de vérité.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums métier
// ---------------------------------------------------------------------------

export const ROLE_NAMES = ["CLIENT", "VENDOR", "STAFF", "ADMIN"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

// Permissions des managers (équipe admin) — 9 modules indépendants du rôle.
export const MANAGER_PERMISSIONS = [
  "KYC",
  "PAYMENTS",
  "WITHDRAWALS",
  "SELLERS",
  "PRODUCTS",
  "ORDERS",
  "STATS",
  "SETTINGS",
  "SUPPORT",
] as const;
export type ManagerPermission = (typeof MANAGER_PERMISSIONS)[number];

export const MANAGER_PERMISSION_LABELS: Record<ManagerPermission, string> = {
  KYC: "Vérifications (KYC)",
  PAYMENTS: "Paiements & tranches",
  WITHDRAWALS: "Retraits vendeurs",
  SELLERS: "Vendeurs",
  PRODUCTS: "Produits",
  ORDERS: "Commandes",
  STATS: "Statistiques",
  SETTINGS: "Paramètres & équipe",
  SUPPORT: "Clients & support",
};

export const MANAGER_PERMISSION_DESCRIPTIONS: Record<ManagerPermission, string> = {
  KYC: "Consulter et modérer les documents d'identité",
  PAYMENTS: "Encaisser les tranches, solder, rembourser",
  WITHDRAWALS: "Approuver ou refuser les retraits vendeurs",
  SELLERS: "Voir les fiches vendeurs et gérer leur statut",
  PRODUCTS: "Modérer les produits de la plateforme",
  ORDERS: "Suivre les commandes et leurs statuts",
  STATS: "Accéder au tableau de bord et aux statistiques",
  SETTINGS: "Modifier les paramètres, l'équipe et le journal",
  SUPPORT: "Gérer les comptes clients (suspendre, consulter)",
};

// Jours de semaine (horaires des managers)
export const SHIFT_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
export type ShiftDay = (typeof SHIFT_DAYS)[number];

export const SHIFT_DAY_LABELS: Record<ShiftDay, string> = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const KYC_STATUSES = [
  "NOT_SUBMITTED",
  "PENDING",
  "IN_PROGRESS",
  "VERIFIED",
  "REJECTED",
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const PHONE_STATUSES = ["UNVERIFIED", "PENDING", "VERIFIED"] as const;
export type PhoneStatus = (typeof PHONE_STATUSES)[number];

export const SELLER_STATUSES = [
  "APPLICATION_PENDING",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

export const PRODUCT_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "SUSPENDED",
  "SOLD",
  "ARCHIVED",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PAYMENT_MODES = ["ONE_TIME", "INSTALLMENTS"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PARTIALLY_PAID",
  "PAID",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TYPES = [
  "ORDER_PAYMENT",
  "INITIAL_INSTALLMENT",
  "INSTALLMENT",
  "SELLER_REGISTRATION_FEE",
  "FEATURED",
  "REFUND",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

// PAYTECH : ancien prestataire, conservé uniquement pour l'historique.
export const PAYMENT_PROVIDERS = ["WAVE_LINK", "BALANCE", "SYSTEM", "PAYTECH"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PLAN_STATUSES = ["ACTIVE", "COMPLETED", "DEFAULTED", "CANCELLED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const INSTALLMENT_STATUSES = [
  "PENDING",
  "PAID",
  "OVERDUE",
  "WAIVED",
  "CANCELLED",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const WITHDRAWAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const PROMOTION_STATUSES = ["SCHEDULED", "ACTIVE", "EXPIRED", "CANCELLED"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

// Cycle de vie d'une mise en avant (cf. enum FeaturedStatus de la base) :
// PENDING = paiement en cours, ACTIVE = en visibilité, EXPIRED/CANCELLED/
// REFUNDED = terminée ou annulée/remboursée.
export const FEATURED_STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED", "REFUNDED", "PENDING"] as const;
export type FeaturedStatus = (typeof FEATURED_STATUSES)[number];

export const SUPPORT_STATUSES = ["CREATED", "PENDING", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_CATEGORIES = [
  "VERIFICATION_CODE",
  "SELLER_REPORT",
  "PAYMENT_ISSUE",
  "DELIVERY",
  "OTHER",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const NOTIFICATION_TYPES = [
  "KYC_VERIFIED",
  "KYC_REJECTED",
  "NEW_MESSAGE",
  "ORDER_CONFIRMED",
  "ORDER_DELIVERED",
  "ORDER_REFUNDED",
  "PAYMENT_CONFIRMED",
  "UPCOMING_INSTALLMENT",
  "INSTALLMENT_OVERDUE",
  "PRODUCT_SOLD",
  "SELLER_PAYOUT_AVAILABLE",
  "FEATURED_ACTIVATED",
  "FEATURED_EXPIRED",
  "ADMIN_ALERT",
  "SYSTEM",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "SMS", "PUSH"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_PRIORITIES = ["LOW", "NORMAL", "CRITICAL"] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const SESSION_KINDS = ["COOKIE", "BEARER"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const DOC_TYPES = ["NATIONAL_ID", "PASSPORT"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const VERIFICATION_STATUSES = ["PENDING", "IN_PROGRESS", "VERIFIED", "REJECTED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

// Purposes de téléversement (stockage privé chiffré — jamais servi en statique)
export const UPLOAD_PURPOSES = [
  "kyc_front",
  "kyc_back",
  "kyc_passport",
  "kyc_selfie",
  "product_image",
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

// ---------------------------------------------------------------------------
// Codes d'erreur machine stables (le frontend peut les mapper sans lire de texte)
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  "SERVICE_UNAVAILABLE",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "KYC_REQUIRED",
  "PHONE_NOT_VERIFIED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_SUSPENDED",
  "PHONE_ALREADY_REGISTERED",
  "EMAIL_ALREADY_REGISTERED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_TOO_MANY_ATTEMPTS",
  "INSUFFICIENT_BALANCE",
  "ACTION_REQUIRES_2FA",
  "PAYMENT_NOT_VERIFIED",
  "FEATURE_DISABLED",
  "GOOGLE_OAUTH_NOT_CONFIGURED",
  "KYC_ALREADY_PENDING",
  "KYC_ALREADY_VERIFIED",
  "SELLER_ALREADY_APPLIED",
  "SELLER_NOT_KYC_VERIFIED",
  "FILE_TOO_LARGE",
  "FILE_TYPE_INVALID",
  "MEDIA_LIMIT",
  "MEDIA_EXISTS",
  "PRODUCT_RESERVED",
  "FILE_ACCESS_DENIED",
  "LOCATION_CONSENT_REQUIRED",
  "SELF_ACTION",
  "INVALID_STATE",
  "INSTALLMENT_ALREADY_PAID",
  "PLAN_NOTHING_TO_SETTLE",
  "ORDER_NOT_DELIVERED",
  "ORDER_REFUNDED",
  "ORDER_ALREADY_REFUNDED",
  "CREDENTIAL_UNREADABLE",
  "CREDENTIALS_IN_USE",
  "KYC_REVOKED",
  "PAYMENT_MODE_UNAVAILABLE",
  // P7 — paiement en tranches
  "INSTALLMENTS_REQUIRED",
  "INSTALLMENTS_UNAVAILABLE",
  "PLAN_ALREADY_PAID",
  "ORDER_NOT_PAYABLE",
  // P9 — mise en avant payée par le vendeur
  "FEATURED_UNAVAILABLE",
  "PROMO_OVERLAP",
  "ALREADY_CANCELLED",
  // Vendeur : sa propre offre, adhésion
  "OWN_OFFER",
  "SELLER_ALREADY_ACTIVE",
  // Paiement par lien Wave : preuve vérifiée par l'équipe
  "WAVE_LINK_UNAVAILABLE",
  "PROOF_ALREADY_SENT",
  "PROOF_REFERENCE_USED",
  "PROOF_ALREADY_REVIEWED",
  "ALREADY_REVIEWED",
  "PASSWORD_REQUIRED",
  "INVALID_PASSWORD",
  "ACCOUNT_BUSY",
  "AWAITING_PAYMENT",
  "LEGACY_PLAN",
  "ALREADY_TEAM_MEMBER",
  "SELLER_CANNOT_BE_MANAGER",
  "EMAIL_NOT_REGISTERED",
  // Manager hors de ses créneaux : console fermée
  "OUTSIDE_SHIFT",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Schémas zod partagés (auth)
// ---------------------------------------------------------------------------

const phoneNumber = z.string().regex(/^[0-9]{6,15}$/, "Numéro invalide (6 à 15 chiffres)");
const countryCode = z.string().regex(/^\+[0-9]{1,4}$/, "Indicatif invalide (ex. +221)");

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis").max(80, "Prénom trop long"),
  email: z.email("E-mail invalide"),
  password: z
    .string()
    .min(8, "Mot de passe : 8 caractères minimum")
    .max(72, "Mot de passe trop long"),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email("E-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const googleOAuthSchema = z.object({
  idToken: z.string().min(10, "idToken invalide"),
});

export type GoogleOAuthInput = z.infer<typeof googleOAuthSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Schémas zod — Équipe admin (managers) & actions administratives
// ---------------------------------------------------------------------------

export const managerShiftSchema = z
  .object({
    day: z.enum(SHIFT_DAYS),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((s) => s.endMinute > s.startMinute, {
    message: "L'heure de fin doit être après l'heure de début",
    path: ["endMinute"],
  });

export const managerCreateSchema = z.object({
  email: z.string().trim().min(1).max(254).email("E-mail invalide"),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  // Facultatif pour un compte déjà inscrit qui a son mot de passe (il le garde).
  password: z.string().min(8, "8 caractères minimum").max(72).optional(),
  title: z.string().trim().max(120).optional(),
  permissions: z.array(z.enum(MANAGER_PERMISSIONS)).min(1, "Au moins une permission"),
  // Un créneau par jour couvert (« du lundi au mercredi » = 3 lignes), plusieurs par jour possibles.
  shifts: z.array(managerShiftSchema).max(21).optional(),
});

export type ManagerCreateInput = z.infer<typeof managerCreateSchema>;

export const managerUpdateSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(),
  permissions: z.array(z.enum(MANAGER_PERMISSIONS)).min(1, "Au moins une permission").optional(),
  shifts: z.array(managerShiftSchema).max(21).optional(),
  password: z.string().min(8).max(72).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export type ManagerUpdateInput = z.infer<typeof managerUpdateSchema>;

export const planCollectSchema = z.object({
  installmentId: z.string().min(1),
  method: z.enum(["CASH", "TRANSFER", "MOBILE_MONEY", "OTHER"]).optional(),
  reference: z.string().trim().max(120).optional(),
});

export type PlanCollectInput = z.infer<typeof planCollectSchema>;

export const planSettleSchema = z.object({
  reference: z.string().trim().max(120).optional(),
});

export type PlanSettleInput = z.infer<typeof planSettleSchema>;

// ---------------------------------------------------------------------------
// Enveloppe de réponse API
// ---------------------------------------------------------------------------

export type ApiEnvelope<T = unknown, M = never> =
  | { ok: true; data: T; meta?: M }
  | { ok: false; error: { code: ApiErrorCode; message: string; details?: unknown } };

// ---------------------------------------------------------------------------
// DTOs partiels (utilisés dès la Phase 1)
// ---------------------------------------------------------------------------

export const publicMetaSchema = z.object({
  platformName: z.string(),
  currency: z.string(),
  maxInstallments: z.number().int().positive(),
});

export type PublicMeta = z.infer<typeof publicMetaSchema>;

export const meDtoSchema = z.object({
  id: z.string(),
  role: z.enum(ROLE_NAMES),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  countryCode: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  status: z.enum(USER_STATUSES),
  twoFactorEnabled: z.boolean(),
  createdAt: z.string(),
});

export type MeDto = z.infer<typeof meDtoSchema>;

// ---------------------------------------------------------------------------
// Schémas zod partagés (Phase 2 — KYC & vendeur)
// ---------------------------------------------------------------------------

export const kycLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  approximateAddress: z.string().max(255).optional(),
  consentGiven: z.literal(true),
});

export type KycLocationInput = z.infer<typeof kycLocationSchema>;

export const kycSubmitSchema = z
  .object({
    documentType: z.enum(DOC_TYPES),
    nationalIdNumber: z.string().max(64).optional(),
    firstName: z.string().trim().min(2).max(100),
    lastName: z.string().trim().min(2).max(100),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ)").optional(),
    country: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    address: z.string().trim().max(255).optional(),
    documentFrontKey: z.string().min(1, "Document recto requis"),
    documentBackKey: z.string().optional(),
    passportKey: z.string().optional(),
    selfieKey: z.string().min(1, "Photo du visage requise"),
    location: kycLocationSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.documentType === "NATIONAL_ID" && !data.documentBackKey) {
      ctx.addIssue({
        code: "custom",
        path: ["documentBackKey"],
        message: "Le verso de la pièce est requis pour une CNI",
      });
    }
    if (data.documentType === "PASSPORT" && data.passportKey && !data.documentFrontKey) {
      ctx.addIssue({
        code: "custom",
        path: ["documentFrontKey"],
        message: "Le document principal est requis",
      });
    }
  });

export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

export const kycAdminActionSchema = z.object({
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(5).max(500),
});

export type KycAdminActionInput = z.infer<typeof kycAdminActionSchema>;

// ---------------------------------------------------------------------------
// Constantes applicatives partagées
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = "md_sid";
export const CSRF_COOKIE_NAME = "md_csrf";

// ---------------------------------------------------------------------------
// Journal d'activité (console) : chaque action enregistrée, en français simple,
// rangée par catégorie. Les connexions des membres et les anciennes
// « consultations » de listes sont de la routine : masquées de la vue « Tout ».
// ---------------------------------------------------------------------------

export const AUDIT_CATEGORIES = {
  offers: "Offres",
  orders: "Commandes",
  payments: "Paiements",
  sellers: "Vendeurs",
  clients: "Clients",
  messages: "Messages & support",
  team: "Équipe & sécurité",
  settings: "Paramètres",
  logins: "Connexions des membres",
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES | "routine";

export const AUDIT_ACTIONS: Record<string, { label: string; category: AuditCategory }> = {
  // Offres
  OFFER_CREATED: { label: "Offre ajoutée", category: "offers" },
  OFFER_UPDATED: { label: "Offre modifiée", category: "offers" },
  OFFER_REMOVED: { label: "Offre supprimée", category: "offers" },
  OFFER_APPROVED: { label: "Offre validée et mise en ligne", category: "offers" },
  OFFER_REJECTED: { label: "Offre refusée", category: "offers" },
  ADMIN_OFFER_STATUS_CHANGED: { label: "Statut d’une offre changé", category: "offers" },
  PRODUCT_MEDIA_ADDED: { label: "Photo ou vidéo ajoutée à une offre", category: "offers" },
  PRODUCT_MEDIA_REMOVED: { label: "Photo ou vidéo retirée d’une offre", category: "offers" },
  PRODUCT_MEDIA_COVER: { label: "Photo de couverture changée", category: "offers" },
  PRODUCT_CREDENTIAL_SET: { label: "Clé d’accès d’un compte ajoutée", category: "offers" },
  PRODUCT_CREDENTIAL_REPLACED: { label: "Clé d’accès d’un compte remplacée", category: "offers" },
  PRODUCT_CREDENTIAL_REVEALED: { label: "Clé d’accès d’un compte affichée par l’équipe", category: "offers" },
  FEATURED_REQUESTED: { label: "Mise en avant demandée", category: "offers" },
  FEATURED_APPROVED: { label: "Mise en avant acceptée", category: "offers" },
  FEATURED_REJECTED: { label: "Mise en avant refusée", category: "offers" },
  FEATURED_PAID_BALANCE: { label: "Mise en avant payée avec le solde vendeur", category: "offers" },
  FEATURED_ACTIVATED_ADMIN: { label: "Mise en avant activée par l’équipe", category: "offers" },
  PROMOTION_CREATED: { label: "Promotion créée", category: "offers" },
  PROMOTION_CANCELLED: { label: "Promotion annulée", category: "offers" },

  // Commandes
  ORDER_CREATED: { label: "Nouvelle commande", category: "orders" },
  ORDER_DELIVERED: { label: "Commande livrée", category: "orders" },
  ORDER_RECEIVED: { label: "Réception confirmée par le client", category: "orders" },
  ORDER_EXPIRED: { label: "Commande annulée (non payée à temps)", category: "orders" },
  ORDER_CREDENTIAL_REVEALED: { label: "Le client a affiché les identifiants de son compte", category: "orders" },
  TEST_ORDER_PURGED: { label: "Commande effacée", category: "orders" },
  VERIFICATION_CODE_REQUESTED: { label: "Code de vérification demandé", category: "orders" },
  VERIFICATION_CODE_PROVIDED: { label: "Code de vérification envoyé au client", category: "orders" },
  REVIEW_CREATED: { label: "Avis laissé par un client", category: "orders" },

  // Paiements
  PAYMENT_PROOF_SUBMITTED: { label: "Capture de paiement Wave envoyée", category: "payments" },
  PAYMENT_PROOF_APPROVED: { label: "Paiement Wave validé", category: "payments" },
  PAYMENT_PROOF_REJECTED: { label: "Paiement Wave refusé", category: "payments" },
  PAYMENT_SUCCESS: { label: "Paiement encaissé", category: "payments" },
  PAYMENT_SETTLED: { label: "Paiement clôturé", category: "payments" },
  PAYMENT_REFUNDED: { label: "Paiement remboursé", category: "payments" },
  INSTALLMENT_PAYMENT_CREATED: { label: "Mensualité à payer créée", category: "payments" },
  INSTALLMENT_PAY_REQUESTED: { label: "Paiement d’une mensualité demandé", category: "payments" },
  PLAN_INSTALLMENT_COLLECTED: { label: "Mensualité encaissée par l’équipe", category: "payments" },
  PLAN_SETTLED: { label: "Paiement en plusieurs fois soldé", category: "payments" },
  INSTALLMENT_PLAN_CANCELLED: { label: "Paiement en plusieurs fois annulé", category: "payments" },

  // Vendeurs
  SELLER_JOIN_REQUESTED: { label: "Demande pour devenir vendeur", category: "sellers" },
  SELLER_CONTRACT_REQUESTED: { label: "Contrat revendeur demandé", category: "sellers" },
  ADMIN_SELLER_STATUS_CHANGED: { label: "Statut d’un vendeur changé", category: "sellers" },
  WITHDRAWAL_REQUESTED: { label: "Retrait demandé par un vendeur", category: "sellers" },
  WITHDRAWAL_APPROVED: { label: "Retrait accepté", category: "sellers" },
  WITHDRAWAL_PROCESSING: { label: "Retrait en cours de traitement", category: "sellers" },
  WITHDRAWAL_REJECTED: { label: "Retrait refusé", category: "sellers" },
  WITHDRAWAL_RECEIVED: { label: "Le vendeur confirme avoir reçu son retrait", category: "sellers" },
  WITHDRAWAL_NOT_RECEIVED: { label: "Le vendeur signale un retrait non reçu", category: "sellers" },

  // Clients
  REGISTER: { label: "Nouveau membre inscrit", category: "clients" },
  KYC_SUBMITTED: { label: "Pièce d’identité envoyée", category: "clients" },
  KYC_VERIFIED: { label: "Identité validée", category: "clients" },
  KYC_REJECTED: { label: "Identité refusée", category: "clients" },
  KYC_IN_PROGRESS: { label: "Vérification d’identité en cours", category: "clients" },
  KYC_PENDING: { label: "Vérification d’identité remise en attente", category: "clients" },
  ADMIN_CLIENT_STATUS_CHANGED: { label: "Compte d’un membre suspendu ou réactivé", category: "clients" },
  ADMIN_CLIENT_DELETED: { label: "Compte d’un membre supprimé", category: "clients" },

  // Messages & support
  MESSAGE_SENT: { label: "Message envoyé", category: "messages" },
  CONVERSATION_CREATED: { label: "Nouvelle conversation", category: "messages" },
  SUPPORT_TICKET_CREATED: { label: "Nouvelle demande au support", category: "messages" },
  SUPPORT_TICKET_UPDATED: { label: "Demande au support mise à jour", category: "messages" },
  SUPPORT_TICKET_REPLIED: { label: "Réponse de l’équipe à une demande", category: "messages" },

  // Équipe & sécurité
  MANAGER_CREATED: { label: "Membre ajouté à l’équipe", category: "team" },
  MANAGER_PROMOTED: { label: "Un client a rejoint l’équipe", category: "team" },
  MANAGER_UPDATED: { label: "Membre de l’équipe modifié", category: "team" },
  MANAGER_DELETED: { label: "Membre retiré de l’équipe", category: "team" },
  ADMIN_LOGIN: { label: "Connexion à la console", category: "team" },
  ADMIN_LOGIN_TRUSTED_DEVICE: { label: "Connexion à la console (appareil de confiance)", category: "team" },
  ADMIN_LOGIN_TOTP_SETUP_REQUIRED: { label: "Connexion à la console (double authentification à activer)", category: "team" },
  ADMIN_TOTP_ENABLED: { label: "Double authentification activée", category: "team" },
  ADMIN_TOTP_FAILED: { label: "Code de double authentification faux", category: "team" },
  ADMIN_TOTP_SECRET_VIEWED: { label: "Clé de double authentification affichée", category: "team" },
  ADMIN_PASSWORD_RESET: { label: "Mot de passe administrateur réinitialisé", category: "team" },
  ADMIN_ACCESS_RESET_WITH_MFA: { label: "Accès administrateur réinitialisé", category: "team" },
  DELETE_PASSWORD_FAILED: { label: "Mot de passe faux lors d’une action protégée", category: "team" },
  SENSITIVE_DATA_ACCESS: { label: "Accès à des données sensibles", category: "team" },

  // Paramètres
  SETTINGS_CHANGE: { label: "Paramètre modifié", category: "settings" },
  SETTING_COMMISSION_RESTORED_15: { label: "Commission remise à 15 %", category: "settings" },

  // Connexions et comptes des membres (masqué de « Tout », onglet dédié)
  LOGIN: { label: "Connexion d’un membre", category: "logins" },
  LOGIN_GOOGLE: { label: "Connexion d’un membre avec Google", category: "logins" },
  LOGOUT: { label: "Déconnexion", category: "logins" },
  PASSWORD_CHANGED: { label: "Mot de passe changé", category: "logins" },
  PASSWORD_SET: { label: "Mot de passe créé", category: "logins" },
  PASSWORD_RESET_REQUESTED: { label: "Mot de passe oublié : lien demandé", category: "logins" },
  PASSWORD_RESET_LINK_CREATED: { label: "Lien de nouveau mot de passe créé", category: "logins" },
  PASSWORD_RESET: { label: "Mot de passe réinitialisé", category: "logins" },
  EMAIL_VERIFIED: { label: "Adresse e-mail confirmée", category: "logins" },
  PROFILE_UPDATED: { label: "Profil modifié", category: "logins" },
  AVATAR_UPDATED: { label: "Photo de profil changée", category: "logins" },
  AVATAR_REMOVED: { label: "Photo de profil retirée", category: "logins" },
  NOTIFICATION_PREFS_UPDATED: { label: "Préférences de notification modifiées", category: "logins" },

  // Routine : consultations de listes (plus enregistrées ; anciennes lignes jamais affichées)
  ADMIN_CLIENTS_LISTED: { label: "Liste des clients consultée", category: "routine" },
  ADMIN_SELLERS_LISTED: { label: "Liste des vendeurs consultée", category: "routine" },
  ADMIN_OFFERINGS_LISTED: { label: "Liste des offres consultée", category: "routine" },
  ADMIN_ORDERS_LISTED: { label: "Liste des commandes consultée", category: "routine" },
  ADMIN_PAYMENTS_LISTED: { label: "Liste des paiements consultée", category: "routine" },
  SUPPORT_TICKETS_LISTED: { label: "Liste du support consultée", category: "routine" },
  ADMIN_MEMBER_VIEWED: { label: "Fiche d’un membre consultée", category: "routine" },
  KYC_QUEUE_VIEWED: { label: "File des identités consultée", category: "routine" },
};

/** Actions d'une catégorie. */
export function auditActionsOf(category: AuditCategory): string[] {
  return Object.entries(AUDIT_ACTIONS)
    .filter(([, meta]) => meta.category === category)
    .map(([action]) => action);
}

/** Actions masquées de la vue « Tout » : connexions des membres et routine. */
export const AUDIT_HIDDEN_ACTIONS = Object.entries(AUDIT_ACTIONS)
  .filter(([, meta]) => meta.category === "routine" || meta.category === "logins")
  .map(([action]) => action);

/** Nom lisible d'une action (inconnue : « Autre action »). */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTIONS[action]?.label ?? "Autre action";
}
