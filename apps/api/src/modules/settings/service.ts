import { prisma } from "@misterdou/db";

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
];

export async function ensureDefaultSettings(): Promise<void> {
  await prisma.settings.createMany({ data: DEFAULT_SETTINGS, skipDuplicates: true });
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
