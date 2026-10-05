import { prisma } from "@misterdou/db";

// Correspondance ancien site → nouveau site (table LegacyRef) : une ligne
// d'origine n'est jamais créée deux fois, quel que soit le nombre de passages.

export type LegacyEntity = "user" | "kyc" | "avatar" | "product" | "media" | "order" | "plan";

export async function findRef(source: string, entity: LegacyEntity, legacyId: string): Promise<string | null> {
  const ref = await prisma.legacyRef.findUnique({
    where: { source_entity_legacyId: { source, entity, legacyId } },
    select: { newId: true },
  });
  return ref?.newId ?? null;
}

export async function saveRef(source: string, entity: LegacyEntity, legacyId: string, newId: string): Promise<void> {
  await prisma.legacyRef.upsert({
    where: { source_entity_legacyId: { source, entity, legacyId } },
    create: { source, entity, legacyId, newId },
    update: { newId },
  });
}
