import { prisma } from "@misterdou/db";
import type { Prisma } from "@misterdou/db";
import { badRequest, conflict } from "../../lib/errors.js";
import { notifyTeam } from "../../lib/notify.js";
import { HOLD_STATUSES } from "../exchanges/hold.js";

// ---------------------------------------------------------------------------
// ID du compte eFootball : un même compte ne peut pas être en vente deux fois
// sur le site, quel que soit le vendeur. Une offre vendue libère l'ID (le
// nouveau propriétaire peut le republier) ; un compte confié à l'équipe dans un
// échange en cours le bloque aussi.
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient | typeof prisma;

/** « 12 34-ab » → « 1234AB » : on compare les comptes sans espaces, tirets ni casse. */
export function normalizeGameId(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseGameId(raw: string): string {
  const id = normalizeGameId(raw);
  if (id.length < 4 || id.length > 40) {
    throw badRequest("VALIDATION_ERROR", "ID eFootball invalide : de 4 à 40 lettres ou chiffres.");
  }
  return id;
}

/** Verrou de transaction sur un ID : deux publications simultanées du même compte passent l'une après l'autre. */
export async function lockGameId(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`game-id:${id}`}))) AS l`;
}

export type GameIdConflict =
  | { kind: "product"; productId: string; title: string; sellerId: string | null }
  | { kind: "exchange"; exchangeId: string; clientId: string };

/** Offre non vendue (ou échange en cours) qui occupe déjà cet ID, sinon null. */
export async function findGameIdConflict(
  db: Db,
  id: string,
  exclude: { productId?: string; exchangeId?: string } = {},
): Promise<GameIdConflict | null> {
  const product = await db.product.findFirst({
    where: { gameAccountId: id, deletedAt: null, status: { not: "SOLD" }, ...(exclude.productId ? { id: { not: exclude.productId } } : {}) },
    select: { id: true, title: true, sellerId: true },
  });
  if (product) return { kind: "product", productId: product.id, title: product.title, sellerId: product.sellerId };
  const exchange = await db.exchangeRequest.findFirst({
    where: { gameAccountId: id, status: { in: [...HOLD_STATUSES] }, ...(exclude.exchangeId ? { id: { not: exclude.exchangeId } } : {}) },
    select: { id: true, clientId: true },
  });
  return exchange ? { kind: "exchange", exchangeId: exchange.id, clientId: exchange.clientId } : null;
}

/**
 * Refuse un ID déjà occupé. L'équipe est prévenue quand l'ID est utilisé par
 * quelqu'un d'autre (possible revente d'un compte qui n'appartient pas au vendeur).
 */
export async function assertGameIdFree(
  db: Db,
  id: string,
  ctx: { sellerId: string | null; exclude?: { productId?: string; exchangeId?: string }; context: string },
): Promise<void> {
  const hit = await findGameIdConflict(db, id, ctx.exclude);
  if (!hit) return;
  const sameOwner = hit.kind === "product" && hit.sellerId === ctx.sellerId;
  if (!sameOwner) {
    await notifyTeam("PRODUCTS", "ADMIN_ALERT", {
      title: "Compte déjà en ligne : tentative refusée",
      message:
        hit.kind === "product"
          ? `${ctx.context} avec l'ID eFootball ${id}, déjà publié dans « ${hit.title} ». Vérifiez qui est le vrai propriétaire.`
          : `${ctx.context} avec l'ID eFootball ${id}, confié en ce moment à l'équipe dans un échange.`,
      actionUrl: hit.kind === "product" ? `/admin/offers?gameId=${encodeURIComponent(id)}` : "/admin/echanges",
      priority: "CRITICAL",
    });
  }
  throw conflict(
    "GAME_ID_IN_USE",
    hit.kind === "product"
      ? sameOwner
        ? `Ce compte (ID ${id}) est déjà dans une de vos offres : « ${hit.title} ».`
        : `Ce compte (ID ${id}) est déjà publié sur MISTERDOU.`
      : `Ce compte (ID ${id}) fait déjà l’objet d’un échange en cours sur MISTERDOU.`,
  );
}

/** Historique d'un ID : ventes passées et échanges terminés (fiche à valider). */
export async function gameIdHistory(id: string, excludeProductId?: string) {
  const [sales, exchanges] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        product: { gameAccountId: id, ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
        order: { deliveredAt: { not: null }, status: { notIn: ["REFUNDED", "CANCELLED"] } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { title: true, productId: true, order: { select: { orderNumber: true, deliveredAt: true } } },
    }),
    prisma.exchangeRequest.findMany({
      where: { gameAccountId: id, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { number: true, completedAt: true },
    }),
  ]);
  return [
    ...sales.map((s) => ({ kind: "sale" as const, title: s.title, reference: s.order.orderNumber, at: s.order.deliveredAt!.toISOString() })),
    ...exchanges.map((e) => ({ kind: "exchange" as const, title: "Compte reçu par échange", reference: e.number, at: e.completedAt!.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}
