import { prisma } from "@misterdou/db";
import type { Prisma } from "@misterdou/db";
import { logAudit } from "../../lib/audit.js";
import { notifyTeam, notifyUser } from "../../lib/notify.js";

// ---------------------------------------------------------------------------
// Étapes d'un échange déclenchées par le reste du site (commandes, offres) :
// remise croisée à la livraison, demandes closes quand le compte n'est plus
// disponible, échange annulé quand le complément n'est jamais réglé.
// Aucune dépendance vers orders/service (évite les imports circulaires).
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient | typeof prisma;

/** Efface tout ce que le client a confié (identifiants, code de connexion). */
export const ERASE_CLIENT_SECRETS = {
  encryptedLogin: null,
  encryptedPassword: null,
  custodyCodeEncrypted: null,
  custodyCodeExpiresAt: null,
} as const;

async function sellerUserId(db: Db, sellerId: string | null): Promise<string | null> {
  if (!sellerId) return null;
  const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { userId: true } });
  return seller?.userId ?? null;
}

/**
 * Commande d'un échange livrée (ou apport validé en mensualités) : l'échange est
 * conclu et le vendeur peut lire les identifiants du compte du client.
 * Idempotent. Renvoie true si l'échange vient d'être conclu.
 */
export async function completeExchangeForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  const exchange = await tx.exchangeRequest.findUnique({
    where: { orderId },
    select: { id: true, number: true, status: true, sellerId: true, topUpAmount: true, product: { select: { title: true } } },
  });
  if (!exchange || exchange.status !== "AWAITING_PAYMENT") return false;
  const now = new Date();
  const claim = await tx.exchangeRequest.updateMany({
    where: { id: exchange.id, status: "AWAITING_PAYMENT" },
    data: { status: "COMPLETED", completedAt: now, closedAt: now },
  });
  if (claim.count === 0) return false;

  await logAudit({
    action: "EXCHANGE_COMPLETED",
    resourceType: "ExchangeRequest",
    resourceId: exchange.id,
    metadata: { number: exchange.number, orderId, topUpAmount: exchange.topUpAmount },
    severity: "WARNING",
  });
  const sellerUser = await sellerUserId(tx, exchange.sellerId);
  const topUp = exchange.topUpAmount ?? 0;
  if (sellerUser) {
    await notifyUser(sellerUser, "PRODUCT_SOLD", {
      title: "🔁 Échange conclu",
      message:
        `« ${exchange.product.title} » est échangé (${exchange.number}). Les identifiants du compte du client sont dans Espace vendeur → Échanges : changez tout de suite son e-mail et son mot de passe.` +
        (topUp > 0 ? ` Le complément vous revient (moins la commission) dès que le client confirme la réception.` : ""),
      actionUrl: `/seller/echanges?id=${exchange.id}`,
      priority: "CRITICAL",
    });
  } else {
    await notifyTeam("EXCHANGES", "ADMIN_ALERT", {
      title: "Échange conclu (compte MISTERDOU)",
      message: `${exchange.number} : le compte du client appartient maintenant à MISTERDOU. Changez son e-mail et son mot de passe depuis la console.`,
      actionUrl: `/admin/echanges?id=${exchange.id}`,
      priority: "CRITICAL",
    });
  }
  return true;
}

/** Ferme les demandes encore sans accord (attente de réponse ou de décision) sur une offre. */
export async function closeOpenExchangeRequests(productId: string, reason: string, db: Db = prisma, exceptId?: string): Promise<number> {
  const open = await db.exchangeRequest.findMany({
    where: { productId, status: { in: ["PENDING", "QUOTED"] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, number: true, clientId: true, product: { select: { title: true } } },
  });
  if (open.length === 0) return 0;
  const now = new Date();
  await db.exchangeRequest.updateMany({
    where: { id: { in: open.map((e) => e.id) }, status: { in: ["PENDING", "QUOTED"] } },
    data: { status: "CANCELLED", closedAt: now, closeReason: reason },
  });
  for (const e of open) {
    await notifyUser(e.clientId, "SYSTEM", {
      title: `Demande d’échange ${e.number} close`,
      message: `${reason} Votre demande pour « ${e.product.title} » est close.`,
      actionUrl: `/account/echanges?id=${e.id}`,
      priority: "NORMAL",
    });
  }
  return open.length;
}

/** Complément jamais réglé (ou commande annulée) : l'échange échoue, le compte du client n'est plus utilisé. */
export async function cancelExchangeForOrder(orderId: string, reason: string): Promise<boolean> {
  const exchange = await prisma.exchangeRequest.findUnique({
    where: { orderId },
    select: { id: true, number: true, status: true, clientId: true, sellerId: true, product: { select: { title: true } } },
  });
  if (!exchange || exchange.status !== "AWAITING_PAYMENT") return false;
  const claim = await prisma.exchangeRequest.updateMany({
    where: { id: exchange.id, status: "AWAITING_PAYMENT" },
    data: { status: "CANCELLED", closedAt: new Date(), closeReason: reason, ...ERASE_CLIENT_SECRETS },
  });
  if (claim.count === 0) return false;
  await logAudit({
    action: "EXCHANGE_CANCELLED",
    resourceType: "ExchangeRequest",
    resourceId: exchange.id,
    metadata: { number: exchange.number, orderId, reason },
  });
  await notifyUser(exchange.clientId, "SYSTEM", {
    title: `Échange ${exchange.number} annulé`,
    message: `${reason} Par précaution, changez le mot de passe de votre compte : l’équipe y a eu accès pendant la vérification.`,
    actionUrl: `/account/echanges?id=${exchange.id}`,
    priority: "CRITICAL",
  });
  const sellerUser = await sellerUserId(prisma, exchange.sellerId);
  if (sellerUser) {
    await notifyUser(sellerUser, "SYSTEM", {
      title: `Échange ${exchange.number} annulé`,
      message: `${reason} « ${exchange.product.title} » est de nouveau disponible à la vente.`,
      actionUrl: `/seller/echanges?id=${exchange.id}`,
      priority: "NORMAL",
    });
  }
  return true;
}
