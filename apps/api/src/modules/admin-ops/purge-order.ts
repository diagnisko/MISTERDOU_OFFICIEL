import { prisma } from "@misterdou/db";
import { conflict, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { deleteFile } from "../../lib/storage.js";
import { logger } from "../../lib/logger.js";
import type { OpsActor } from "./service.js";
import { ERASE_CLIENT_SECRETS } from "../exchanges/lifecycle.js";

// ---------------------------------------------------------------------------
// Suppression d'une commande (administrateur, mot de passe exigé) :
// la commande et tout ce qui en dépend disparaissent des statistiques —
// paiements et preuves Wave, échéancier, codes de vérification, avis du client
// sur ce compte, notifications de la commande. La part du vendeur est retirée
// de son solde (en attente ou disponible). Le compte vendu est désactivé (à
// supprimer ou remettre en vente depuis « Offres »). Seule une trace reste dans
// le journal d'audit. Refusé si l'argent du vendeur a déjà été retiré.
// ---------------------------------------------------------------------------

/**
 * Suppression d'un paiement (administrateur, mot de passe vérifié par la route) :
 * celui d'une commande supprime toute la commande (un paiement seul ne peut pas
 * sortir d'un contrat sans le rendre faux) ; les autres (adhésion vendeur,
 * contrat revendeur, mise en avant) quittent l'historique et les statistiques,
 * ce qu'ils ont activé reste actif.
 */
export async function purgePayment(paymentId: string, actor: OpsActor) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, orderId: true, paymentNumber: true, type: true, amount: true, status: true, proofs: { select: { screenshotKey: true } } },
  });
  if (!payment) throw notFound("Paiement introuvable.");
  if (payment.orderId) {
    const purged = await purgeOrder(payment.orderId, actor);
    return { ...purged, scope: "order" as const };
  }
  await prisma.$transaction(async (tx) => {
    await tx.paymentProof.deleteMany({ where: { paymentId: payment.id } });
    await tx.installment.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
    await tx.featuredProduct.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
    await tx.sellerContract.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
    await tx.payment.delete({ where: { id: payment.id } });
  });
  for (const key of payment.proofs.map((p) => p.screenshotKey).filter((k): k is string => Boolean(k))) {
    await deleteFile(key).catch((err: unknown) => logger.warn({ err }, "[purge] capture non supprimée"));
  }
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "TEST_PAYMENT_PURGED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: { paymentNumber: payment.paymentNumber, type: payment.type, amount: payment.amount, status: payment.status },
    severity: "CRITICAL",
  });
  return { scope: "payment" as const, paymentNumber: payment.paymentNumber };
}

export async function purgeOrder(orderId: string, actor: OpsActor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      buyerId: true,
      totalAmount: true,
      items: { select: { id: true, productId: true, commission: { select: { id: true, sellerId: true, status: true, netToSeller: true, commissionAmount: true } } } },
      payments: { select: { id: true, amount: true, status: true, proofs: { select: { screenshotKey: true } } } },
      exchange: { select: { status: true } },
    },
  });
  if (!order) throw notFound("Commande introuvable.");

  const commissions = order.items.flatMap((i) => (i.commission ? [i.commission] : []));
  for (const c of commissions) {
    if (c.status !== "RELEASED") continue;
    const balance = await prisma.sellerBalance.findUnique({ where: { sellerId: c.sellerId }, select: { balanceAvailable: true } });
    if ((balance?.balanceAvailable ?? 0) < c.netToSeller) {
      throw conflict("INVALID_STATE", "Le vendeur a déjà retiré l’argent de cette vente : la commande ne peut plus être effacée.");
    }
  }

  const productIds = [...new Set(order.items.map((i) => i.productId))];
  const proofKeys = order.payments.flatMap((p) => p.proofs.map((x) => x.screenshotKey)).filter((k): k is string => Boolean(k));
  const paidTotal = order.payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);

  await prisma.$transaction(async (tx) => {
    // Argent du vendeur : sa part sort de son solde, sa commission de ses cumuls.
    for (const c of commissions) {
      if (c.status === "REFUNDED") continue;
      await tx.sellerBalance.update({
        where: { sellerId: c.sellerId },
        data: {
          ...(c.status === "RELEASED" ? { balanceAvailable: { decrement: c.netToSeller } } : { balancePending: { decrement: c.netToSeller } }),
          totalEarnings: { decrement: c.netToSeller },
          totalCommissionPaid: { decrement: c.commissionAmount },
        },
      });
    }
    await tx.commission.deleteMany({ where: { orderItemId: { in: order.items.map((i) => i.id) } } });
    await tx.pendingCredit.deleteMany({ where: { orderId: order.id } });
    await tx.verificationCodeRequest.deleteMany({ where: { orderId: order.id } });
    await tx.supportTicket.updateMany({ where: { orderId: order.id }, data: { orderId: null } });

    const plan = await tx.installmentPlan.findUnique({ where: { orderId: order.id }, select: { id: true } });
    const paymentIds = order.payments.map((p) => p.id);
    await tx.paymentProof.deleteMany({ where: { paymentId: { in: paymentIds } } });
    if (plan) await tx.installment.deleteMany({ where: { planId: plan.id } });
    await tx.payment.deleteMany({ where: { OR: [{ orderId: order.id }, ...(plan ? [{ installmentPlanId: plan.id }] : [])] } });
    if (plan) await tx.installmentPlan.delete({ where: { id: plan.id } });

    await tx.productReview.deleteMany({ where: { userId: order.buyerId, productId: { in: productIds } } });
    await tx.notification.deleteMany({ where: { actionUrl: { contains: order.id } } });
    // Échange lié à cette commande : il est clos (le compte du client n'est plus utilisé).
    await tx.exchangeRequest.updateMany({
      where: { orderId: order.id },
      data: {
        orderId: null,
        ...(order.exchange && order.exchange.status !== "COMPLETED"
          ? { status: "CANCELLED" as const, closedAt: new Date(), closeReason: "Commande supprimée par l’administration.", ...ERASE_CLIENT_SECRETS }
          : {}),
      },
    });
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    await tx.order.delete({ where: { id: order.id } });

    // Le compte « vendu » par cette commande n'est plus en vente d'office : à remettre en vente ou supprimer.
    await tx.product.updateMany({ where: { id: { in: productIds }, status: "SOLD" }, data: { status: "SUSPENDED" } });
  });

  for (const key of proofKeys) await deleteFile(key).catch((err) => logger.warn({ err }, "[purge] capture déjà absente"));

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "TEST_ORDER_PURGED",
    resourceType: "Order",
    resourceId: order.id,
    metadata: { orderNumber: order.orderNumber, totalAmount: order.totalAmount, paidTotal, sellerShares: commissions.length },
    severity: "CRITICAL",
  });
  return { id: order.id, orderNumber: order.orderNumber, purged: true };
}
