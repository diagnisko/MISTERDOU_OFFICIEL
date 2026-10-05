import { prisma } from "@misterdou/db";

// ---------------------------------------------------------------------------
// Échéanciers copiés de l'ancien site : tant que l'ancien site encaisse (avant
// la bascule du nom de domaine), le nouveau site ne relance pas, ne marque pas
// de retard et n'encaisse pas ces mensualités. Réglage interne, invisible dans
// la console (préfixe « legacy. »).
// ---------------------------------------------------------------------------

export const FOLLOW_OLD_SITE_KEY = "legacy.followOldSite";

export async function setFollowOldSite(on: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { key: FOLLOW_OLD_SITE_KEY },
    create: {
      key: FOLLOW_OLD_SITE_KEY,
      value: on,
      valueType: "boolean",
      group: "legacy",
      description: "Mensualités copiées de l'ancien site encore encaissées là-bas (avant la bascule du domaine).",
    },
    update: { value: on },
  });
}

/** Identifiants des échéanciers encore suivis par l'ancien site (liste vide après la bascule). */
export async function plansFollowedElsewhere(): Promise<string[]> {
  const setting = await prisma.settings.findUnique({ where: { key: FOLLOW_OLD_SITE_KEY }, select: { value: true } });
  if (setting?.value !== true) return [];
  const refs = await prisma.legacyRef.findMany({ where: { entity: "plan" }, select: { newId: true } });
  return refs.map((r) => r.newId);
}
