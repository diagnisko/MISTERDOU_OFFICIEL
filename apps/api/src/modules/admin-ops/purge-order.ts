import { prisma } from "@misterdou/db";
import { conflict, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { deleteFile } from "../../lib/storage.js";
import { logger } from "../../lib/logger.js";
import type { OpsActor } from "./service.js";

// ---------------------------------------------------------------------------
// Effacement d'une COMMANDE DE TEST (administrateur, mot de passe exigé) :
// la commande et tout ce qui en dépend disparaissent des statistiques —
// paiements et preuves Wave, échéancier, codes de vérification, avis du client
// sur ce compte, notifications de la commande. La part du vendeur est retirée
// de son solde (en attente ou disponible). Le compte vendu est désactivé (à
// supprimer ou remettre en vente depuis « Offres »). Seule une trace reste dans
// le journal d'audit. Refusé si l'argent du vendeur a déjà été retiré.
// ---------------------------------------------------------------------------

export async function purgeTestOrder(orderId: string, actor: OpsActor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      buyerId: true,
      totalAmount: true,
      items: { select: { id: true, productId: true, commission: { select: { id: true, sellerId: true, status: true, netToSeller: true, commissionAmount: true } } } },
      payments: { select: { id: true, amount: true, status: true, proofs: { select: { screenshotKey: true } } } },
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
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    await tx.order.delete({ where: { id: order.id } });

    // Le compte « vendu » par ce test n'est plus en vente d'office : à remettre en vente ou supprimer.
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
