import { prisma } from "@misterdou/db";
import { logAudit } from "../../lib/audit.js";

export type SettingValue = number | string | boolean | Record<string, unknown>;

// Retrouve une valeur de paramètre (toujours depuis la BDD — jamais codée en dur ici).
export async function getSetting(key: string): Promise<SettingValue | undefined> {
  const row = await prisma.settings.findUnique({ where: { key } });
  if (!row) return undefined;
  return row.value as SettingValue;
}

export async function getIntSetting(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  return typeof v === "number" ? v : fallback;
}

// Vue publique : uniquement les paramètres nécessaires à l'affichage du catalogue.
// UNE seule requête (les trois clés sont lues en lot) : /api/v1/meta et /api/seed
// sont appelés à chaque affichage de la landing.
export async function getPublicMeta() {
  const KEYS = ["platformName", "currency", "maxInstallments"] as const;
  const rows = await prisma.settings.findMany({
    where: { key: { in: [...KEYS] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value as SettingValue | undefined]));

  const platformName = byKey.get("platformName");
  const currency = byKey.get("currency");
  const maxInstallments = byKey.get("maxInstallments");

  return {
    platformName: typeof platformName === "string" ? platformName : "MISTERDOU",
    currency: typeof currency === "string" ? currency : "XOF",
    maxInstallments: typeof maxInstallments === "number" ? maxInstallments : 8,
  };
}

// Paramètres ajoutés après la mise en service : créés au démarrage s'ils
// manquent (jamais écrasés), pour apparaître dans Console > Paramètres.
const DEFAULT_SETTINGS = [
  { key: "supportWhatsapp", value: "+12272254876", valueType: "string", group: "support", description: "Numéro WhatsApp du support (vide = bouton masqué)" },
  { key: "supportEmail", value: "", valueType: "string", group: "support", description: "E-mail du support (vide = bouton masqué)" },
  { key: "sellerRegistrationFee", value: 1000, valueType: "int", group: "sellers", description: "Frais d'adhésion pour devenir vendeur (FCFA)" },
  { key: "resellerContract6Price", value: 5000, valueType: "int", group: "sellers", description: "Contrat revendeur 6 mois, sans commission (FCFA)" },
  { key: "resellerContract12Price", value: 8000, valueType: "int", group: "sellers", description: "Contrat revendeur 1 an, sans commission (FCFA)" },
  { key: "resellerContract18Price", value: 10000, valueType: "int", group: "sellers", description: "Contrat revendeur 18 mois, sans commission (FCFA)" },
  { key: "legalEntityName", value: "", valueType: "string", group: "legal", description: "Pages légales : nom de l'entreprise ou de l'exploitant" },
  { key: "legalAddress", value: "", valueType: "string", group: "legal", description: "Pages légales : adresse du siège" },
  { key: "legalRegistration", value: "", valueType: "string", group: "legal", description: "Pages légales : NINEA / RCCM" },
  { key: "legalPublisher", value: "", valueType: "string", group: "legal", description: "Pages légales : responsable de la publication" },
  {
    key: "unpaidOrderExpiryHours",
    value: 24,
    valueType: "int",
    group: "orders",
    description: "Délai avant l'annulation d'une commande jamais réglée (heures) ; une preuve Wave en vérification la garde ouverte",
  },
  {
    key: "waveMerchantLink",
    value: "https://pay.wave.com/m/M_sn_FXjtL8L8mMRr/c/sn/",
    valueType: "string",
    group: "payments",
    description: "Lien de paiement Wave Business (le montant est ajouté tout seul ; vide = paiement Wave désactivé)",
  },
];

export async function ensureDefaultSettings(): Promise<void> {
  await prisma.settings.createMany({ data: DEFAULT_SETTINGS, skipDuplicates: true });
  await restoreCommissionOnce();
}

const COMMISSION_FIX_ACTION = "SETTING_COMMISSION_RESTORED_15";

/**
 * Correction unique (2026-10-06, demande du propriétaire) : la commission en
 * ligne était passée à 10 % ; elle revient à 15 %. Faite une seule fois (trace
 * dans le journal d'audit) : un changement ultérieur dans Paramètres est respecté.
 */
export async function restoreCommissionOnce(): Promise<boolean> {
  const done = await prisma.auditLog.count({ where: { action: COMMISSION_FIX_ACTION } });
  if (done > 0) return false;
  const row = await prisma.settings.findUnique({ where: { key: "sellerCommissionPercent" }, select: { value: true } });
  await prisma.settings.upsert({
    where: { key: "sellerCommissionPercent" },
    create: { key: "sellerCommissionPercent", value: 15, valueType: "int", group: "sellers", description: "Commission de la plateforme sur chaque vente vendeur (%)" },
    update: { value: 15 },
  });
  await logAudit({
    action: COMMISSION_FIX_ACTION,
    resourceType: "Settings",
    resourceId: "sellerCommissionPercent",
    metadata: { before: row?.value ?? null, after: 15 },
    severity: "WARNING",
  });
  return true;
}

/** Moyens de contact du support affichés sur la page « Aide et support ». */
export async function getSupportContacts(): Promise<{ whatsapp: string | null; email: string | null }> {
  const rows = await prisma.settings.findMany({ where: { key: { in: ["supportWhatsapp", "supportEmail"] } }, select: { key: true, value: true } });
  const read = (key: string) => {
    const v = rows.find((r) => r.key === key)?.value;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  return { whatsapp: read("supportWhatsapp"), email: read("supportEmail") };
}

// ---------------------------------------------------------------------------
// Lien de paiement Wave Business : le montant à payer est écrit dans le lien
// (?amount=…), calculé côté serveur (prix de l'offre, apport, mensualités…).
// ---------------------------------------------------------------------------

const WAVE_LINK_PREFIX = "https://pay.wave.com/";

/** Un lien Wave Business valide (https://pay.wave.com/…). */
export function isWaveLink(value: string): boolean {
  if (!value.startsWith(WAVE_LINK_PREFIX)) return false;
  try {
    return new URL(value).host === "pay.wave.com";
  } catch {
    return false;
  }
}

/** Lien Wave réglé dans Console > Paramètres, sans montant ; null si absent. */
export async function getWaveMerchantLink(): Promise<string | null> {
  const v = await getSetting("waveMerchantLink");
  return typeof v === "string" && isWaveLink(v.trim()) ? v.trim() : null;
}

/** Lien Wave avec le montant à payer (remplace un éventuel montant déjà présent). */
export function waveLinkWithAmount(base: string, amount: number): string {
  const url = new URL(base);
  url.searchParams.set("amount", String(amount));
  return url.toString();
}

// ---------------------------------------------------------------------------
// Pages légales (CGU, confidentialité, mentions légales) : identité de
// l'exploitant et règles chiffrées, toutes réglées dans Console > Paramètres.
// ---------------------------------------------------------------------------

export async function getLegalInfo() {
  const KEYS = [
    "platformName",
    "legalEntityName",
    "legalAddress",
    "legalRegistration",
    "legalPublisher",
    "supportEmail",
    "supportWhatsapp",
    "sellerCommissionPercent",
    "payoutHoldDays",
    "unpaidOrderExpiryHours",
    "sellerRegistrationFee",
    "minWithdrawalAmount",
    "resellerContract6Price",
    "resellerContract12Price",
    "resellerContract18Price",
  ] as const;
  const rows = await prisma.settings.findMany({ where: { key: { in: [...KEYS] } }, select: { key: true, value: true } });
  const byKey = new Map(rows.map((r) => [r.key, r.value as SettingValue | undefined]));
  const text = (key: (typeof KEYS)[number]) => {
    const v = byKey.get(key);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const int = (key: (typeof KEYS)[number], fallback: number) => {
    const v = byKey.get(key);
    return typeof v === "number" ? v : fallback;
  };
  return {
    platformName: text("platformName") ?? "MISTERDOU",
    entityName: text("legalEntityName"),
    address: text("legalAddress"),
    registration: text("legalRegistration"),
    publisher: text("legalPublisher"),
    supportEmail: text("supportEmail"),
    supportWhatsapp: text("supportWhatsapp"),
    commissionPercent: int("sellerCommissionPercent", 15),
    payoutHoldDays: int("payoutHoldDays", 3),
    unpaidOrderExpiryHours: int("unpaidOrderExpiryHours", 24),
    sellerRegistrationFee: int("sellerRegistrationFee", 1000),
    minWithdrawal: int("minWithdrawalAmount", 1000),
    contractPrices: {
      six: int("resellerContract6Price", 5000),
      twelve: int("resellerContract12Price", 8000),
      eighteen: int("resellerContract18Price", 10000),
    },
  };
}
