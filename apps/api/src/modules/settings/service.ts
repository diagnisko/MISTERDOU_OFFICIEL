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

export async function getStringSetting(key: string, fallback: string): Promise<string> {
  const v = await getSetting(key);
  return typeof v === "string" ? v : fallback;
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