import { prisma } from "@misterdou/db";
import { logger } from "../../lib/logger.js";
import { notifyActiveAdmins, notifyUser } from "../../lib/notify.js";
import { getIntSetting } from "../settings/service.js";

// ---------------------------------------------------------------------------
// Après paiement : le produit quitte la boutique, la vente du vendeur est
// enregistrée (commission + crédit en attente), puis les fonds sont libérés à
// la réception confirmée par le client ou après le délai de sécurité.
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const OPEN_REPORT = ["CREATED", "PENDING", "IN_PROGRESS"] as const;

/**
 * Retire de la vente les produits de la commande. Renvoie les produits qui
 * n'étaient plus disponibles (vendus entre-temps à quelqu'un d'autre).
 */
export async function markProductsSold(tx: Tx, orderId: string): Promise<string[]> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true } });
  const taken: string[] = [];
  for (const { productId } of items) {
    const res = await tx.product.updateMany({ where: { id: productId, status: "ACTIVE" }, data: { status: "SOLD" } });
    if (res.count === 0) {
      const current = await tx.product.findUnique({ where: { id: productId }, select: { status: true } });
      if (current?.status !== "SOLD") continue;
      // Vendu à une autre commande déjà livrée ou en cours d'échéancier ?
      const other = await tx.orderItem.findFirst({
        where: {
          productId,
          orderId: { not: orderId },
          order: { status: { in: ["DELIVERED", "PARTIALLY_PAID", "COMPLETED"] } },
        },
        select: { id: true },
      });
      if (other) taken.push(productId);
    }
  }
  return taken;
}

/** Enregistre la part du vendeur (idempotent : une commission par article). */
export async function recordSellerSale(tx: Tx, orderId: string): Promise<Array<{ sellerUserId: string; net: number; title: string }>> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      items: {
        select: {
          id: true,
          title: true,
          unitPrice: true,
          quantity: true,
          sellerId: true,
          commission: { select: { id: true } },
          product: { select: { sellerId: true } },
        },
      },
    },
  });
  if (!order) return [];

  const rateRow = await tx.settings.findUnique({ where: { key: "sellerCommissionPercent" }, select: { value: true } });
  const rate = typeof rateRow?.value === "number" ? Math.min(50, Math.max(0, rateRow.value)) : 15;

  const credited: Array<{ sellerUserId: string; net: number; title: string }> = [];
  for (const item of order.items) {
    const sellerId = item.sellerId ?? item.product.sellerId;
    if (!sellerId || item.commission) continue;
    const amount = item.unitPrice * item.quantity;
    const commissionAmount = Math.round((amount * rate) / 100);
    const net = amount - commissionAmount;

    await tx.commission.create({
      data: { orderItemId: item.id, sellerId, orderAmount: amount, commissionRate: rate, commissionAmount, netToSeller: net },
    });
    await tx.sellerBalance.upsert({
      where: { sellerId },
      create: { sellerId, balancePending: net, totalEarnings: net, totalCommissionPaid: commissionAmount },
      update: {
        balancePending: { increment: net },
        totalEarnings: { increment: net },
        totalCommissionPaid: { increment: commissionAmount },
      },
    });
    await tx.pendingCredit.create({ data: { sellerId, orderId, amount: net, reference: order.orderNumber } });
    if (!item.sellerId) await tx.orderItem.update({ where: { id: item.id }, data: { sellerId } });

    const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { userId: true } });
    if (seller) credited.push({ sellerUserId: seller.userId, net, title: item.title });
  }
  return credited;
}

/** Double vente détectée : l'équipe doit rembourser l'un des deux acheteurs. */
export async function alertDoubleSale(orderNumber: string, productIds: string[]) {
  logger.error({ orderNumber, productIds }, "[orders] produit déjà vendu : paiement à rembourser");
  await notifyActiveAdmins("ADMIN_ALERT", {
    title: "Paiement sur un compte déjà vendu",
    message: `La commande ${orderNumber} a été payée pour un compte déjà vendu. Remboursez l’acheteur depuis la console.`,
    actionUrl: "/admin/orders",
    priority: "CRITICAL",
  });
}

/**
 * Passe en « disponible » les fonds en attente d'une commande. Idempotent :
 * un crédit déjà libéré n'est jamais compté deux fois.
 */
export async function releaseOrderCredits(orderId: string, reason: "RECEIVED" | "HOLD_EXPIRED" | "ADMIN") {
  const released = await prisma.$transaction(async (tx) => {
    const credits = await tx.pendingCredit.findMany({ where: { orderId, releasedAt: null } });
    const done: Array<{ sellerId: string; amount: number }> = [];
    for (const credit of credits) {
      const claim = await tx.pendingCredit.updateMany({
        where: { id: credit.id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (claim.count === 0) continue;
      await tx.sellerBalance.update({
        where: { sellerId: credit.sellerId },
        data: { balancePending: { decrement: credit.amount }, balanceAvailable: { increment: credit.amount } },
      });
      done.push({ sellerId: credit.sellerId, amount: credit.amount });
    }
    if (done.length > 0) {
      await tx.commission.updateMany({
        where: { orderItem: { orderId }, status: "RECORDED" },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
    }
    return done;
  });

  for (const { sellerId, amount } of released) {
    const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { userId: true } });
    if (!seller) continue;
    await notifyUser(seller.userId, "SELLER_PAYOUT_AVAILABLE", {
      title: "Fonds disponibles",
      message:
        reason === "RECEIVED"
          ? `Le client a confirmé la réception : ${amount.toLocaleString("fr-FR")} FCFA sont disponibles au retrait.`
          : `${amount.toLocaleString("fr-FR")} FCFA sont maintenant disponibles au retrait.`,
      actionUrl: "/seller",
      priority: "NORMAL",
    });
  }
  return released.reduce((sum, r) => sum + r.amount, 0);
}

/** Libère les fonds des commandes livrées depuis le délai de sécurité, sans signalement ouvert. */
export async function releaseMaturedCredits(now = new Date()): Promise<number> {
  const holdDays = await getIntSetting("payoutHoldDays", 3);
  const cutoff = new Date(now.getTime() - holdDays * 86_400_000);
  const orders = await prisma.order.findMany({
    where: {
      deliveredAt: { lte: cutoff },
      status: { not: "REFUNDED" },
      pendingCredits: { some: { releasedAt: null } },
      supportTicket: { none: { category: "SELLER_REPORT", status: { in: [...OPEN_REPORT] } } },
    },
    select: { id: true },
    take: 200,
  });
  let total = 0;
  for (const o of orders) total += await releaseOrderCredits(o.id, "HOLD_EXPIRED");
  return total;
}

export function startSellerPayoutJobs(): NodeJS.Timeout {
  const run = async () => {
    try {
      const amount = await releaseMaturedCredits();
      if (amount > 0) logger.info({ amount }, "[payouts] fonds vendeurs libérés (délai de sécurité)");
    } catch (err) {
      logger.error({ err }, "[payouts] échec de la libération des fonds");
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  return timer;
}
