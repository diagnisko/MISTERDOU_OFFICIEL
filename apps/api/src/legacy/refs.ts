import { prisma, type Prisma } from "@misterdou/db";

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

/**
 * Transaction de la copie : jusqu'à une minute (contre 5 s par défaut), car la
 * base est loin du poste qui copie et chaque écriture fait un aller-retour.
 */
export function longTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { maxWait: 20_000, timeout: 60_000 });
}
