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

export const PAYMENT_PROVIDERS = ["PAYTECH", "BALANCE", "SYSTEM"] as const;
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
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Schémas zod partagés (auth)
// ---------------------------------------------------------------------------

const phoneNumber = z.string().regex(/^[0-9]{6,15}$/, "Numéro invalide (6 à 15 chiffres)");
const countryCode = z.string().regex(/^\+[0-9]{1,4}$/, "Indicatif invalide (ex. +221)");
const oneTimePassword = z.string().regex(/^[0-9]{6}$/, "Code OTP : 6 chiffres");

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

export const otpRequestSchema = z.object({
  countryCode,
  phoneNumber,
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  countryCode,
  phoneNumber,
  code: oneTimePassword,
});

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

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
  password: z.string().min(8, "8 caractères minimum").max(72),
  title: z.string().trim().max(120).optional(),
  permissions: z.array(z.enum(MANAGER_PERMISSIONS)).min(1, "Au moins une permission"),
  shifts: z.array(managerShiftSchema).max(7).optional(),
});

export type ManagerCreateInput = z.infer<typeof managerCreateSchema>;

export const managerUpdateSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(),
  permissions: z.array(z.enum(MANAGER_PERMISSIONS)).min(1, "Au moins une permission").optional(),
  shifts: z.array(managerShiftSchema).max(7).optional(),
  password: z.string().min(8).max(72).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export type ManagerUpdateInput = z.infer<typeof managerUpdateSchema>;

export const adminUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
  reason: z.string().trim().max(300).optional(),
});

export const adminSellerStatusSchema = z.object({
  status: z.enum(SELLER_STATUSES),
  reason: z.string().trim().max(300).optional(),
});

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

export const apiEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown(),
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(API_ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
]);

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
  phoneVerified: z.boolean(),
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

export const verifyPhoneSchema = z.object({
  countryCode,
  phoneNumber,
  code: oneTimePassword,
});

export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;

// ---------------------------------------------------------------------------
// Constantes applicatives partagées
// ---------------------------------------------------------------------------

export const INSTALLMENT_HARD_CAP = 8;
export const SESSION_COOKIE_NAME = "md_sid";
export const CSRF_COOKIE_NAME = "md_csrf";
export const DEFAULT_CURRENCY = "XOF";