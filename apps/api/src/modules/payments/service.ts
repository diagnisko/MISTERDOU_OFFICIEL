import { prisma } from "@misterdou/db";
import type { PaymentStatus, PaymentType, Prisma, RoleName } from "@misterdou/db";
import { notFound } from "../../lib/errors.js";
import { deliverOrderAfterSuccess } from "../../modules/orders/service.js";
import { applyDownPayment, applyInstallmentPayment } from "../../modules/installments/service.js";
import { activateFeatured } from "../../modules/promotions/service.js";
import { activateSeller } from "../../modules/seller/join.js";
import { notifyUser } from "../../lib/notify.js";
import { logAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { getWaveMerchantLink, waveLinkWithAmount } from "../settings/service.js";
import { latestProof } from "./proofs.js";

export interface PaymentContext {
  actorId?: string;
  actorRole?: RoleName;
  ip?: string;
}

type Tx = Prisma.TransactionClient;

const TERMINAL_STATUSES: PaymentStatus[] = ["SUCCESS", "FAILED", "CANCELLED", "REFUNDED"];

// ---------------------------------------------------------------------------
// SETTLE — l'unique porte d'évolution de statut. Atomique et idempotent :
// UPDATE … WHERE status ∈ (PENDING, PROCESSING) — un second appel ne crédite
// JAMAIS deux fois.
// ---------------------------------------------------------------------------

export type SettleOutcome = "SUCCESS" | "FAILED" | "CANCELLED";
// MANUAL : preuve de paiement Wave validée par un membre de l'équipe.
// ADMIN  : règlement enregistré depuis la console (échéance encaissée, solde).
export type SettleSource = "MANUAL" | "ADMIN";

export async function settlePayment(
  lookup: { id?: string; providerReference?: string; paymentNumber?: string },
  outcome: SettleOutcome,
  opts: {
    source: SettleSource;
    providerReference?: string;
    failureReason?: string | null;
    ctx?: PaymentContext;
  },
): Promise<{ status: PaymentStatus; already: boolean; paymentId: string; type: PaymentType; userId: string; amount: number }> {
  const payment = lookup.id
    ? await prisma.payment.findUnique({ where: { id: lookup.id } })
    : lookup.providerReference
      ? await prisma.payment.findUnique({ where: { providerReference: lookup.providerReference } })
      : lookup.paymentNumber
        ? await prisma.payment.findUnique({ where: { paymentNumber: lookup.paymentNumber } })
        : null;
  if (!payment) throw notFound("Paiement introuvable");

  if (TERMINAL_STATUSES.includes(payment.status)) {
    return {
      status: payment.status,
      already: true,
      paymentId: payment.id,
      type: payment.type,
      userId: payment.userId,
      amount: payment.amount,
    };
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["PENDING", "PROCESSING"] } },
      data:
        outcome === "SUCCESS"
          ? {
              status: "SUCCESS",
              paidAt: now,
              verifiedAt: now,
              ...(opts.providerReference ? { providerReference: opts.providerReference } : {}),
              failureReason: null,
            }
          : {
              status: outcome,
              failureReason: opts.failureReason ?? null,
              ...(opts.providerReference ? { providerReference: opts.providerReference } : {}),
            },
    });
    if (res.count === 0) return null;

    if (outcome === "SUCCESS") {
      switch (payment.type) {
        case "ORDER_PAYMENT":
          // Livraison de la commande : idempotente (Order.deliveredAt), KYC
          // re-vérifié au moment de la délivrance, accès tracé.
          if (payment.orderId) {
            await deliverOrderAfterSuccess(tx, payment, {
              ctx: { actorId: opts.ctx?.actorId ?? payment.userId, actorRole: opts.ctx?.actorRole, ip: opts.ctx?.ip },
            });
          } else {
            logger.warn({ type: payment.type, paymentId: payment.id }, "[payments] paiement de commande sans orderId");
          }
          break;
        case "INITIAL_INSTALLMENT":
          // Apport initial : ouvre le dossier financier, NE LIVRE PAS. Le compte
          // reste inaccessible tant que l'échéancier n'est pas soldé.
          if (!payment.orderId) {
            logger.warn({ paymentId: payment.id }, "[payments] apport sans orderId");
            break;
          }
          if (payment.installmentPlanId) {
            await applyDownPayment(tx, payment);
          } else {
            logger.warn({ paymentId: payment.id }, "[payments] apport sans installmentPlanId");
          }
          await tx.order.update({ where: { id: payment.orderId }, data: { status: "PARTIALLY_PAID" } });
          break;
        case "INSTALLMENT":
          // Mensualité : on ne livre que si l'échéancier devient soldé.
          if (payment.installmentPlanId) {
            const settled = await applyInstallmentPayment(tx, payment);
            if (settled && payment.orderId) {
              await deliverOrderAfterSuccess(tx, payment, {
                ctx: { actorId: opts.ctx?.actorId ?? payment.userId, actorRole: opts.ctx?.actorRole, ip: opts.ctx?.ip },
              });
            }
          } else {
            logger.warn({ paymentId: payment.id }, "[payments] mensualité sans installmentPlanId");
          }
          break;
        case "REFUND":
          break;
        case "FEATURED":
          // Mise en avant : prolonge Product.featuredUntil à partir de la
          // fin en cours (jamais de perte de jours déjà payés).
          await activateFeatured(tx, payment);
          break;
        case "SELLER_REGISTRATION_FEE":
          // Frais d'adhésion : le compte passe vendeur aussitôt.
          await activateSeller(tx, payment);
          break;
      }
    }
    return tx.payment.findUnique({ where: { id: payment.id } });
  });

  if (!updated) {
    const current = await prisma.payment.findUnique({ where: { id: payment.id } });
    return {
      status: current?.status ?? payment.status,
      already: true,
      paymentId: payment.id,
      type: payment.type,
      userId: payment.userId,
      amount: payment.amount,
    };
  }

  await logAudit({
    actorId: opts.ctx?.actorId,
    actorRole: opts.ctx?.actorRole,
    ip: opts.ctx?.ip,
    action: outcome === "SUCCESS" ? "PAYMENT_SUCCESS" : "PAYMENT_SETTLED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: {
      outcome,
      source: opts.source,
      amount: payment.amount,
      type: payment.type,
      paymentNumber: payment.paymentNumber,
      failureReason: opts.failureReason ?? undefined,
    },
    severity: outcome === "SUCCESS" ? "WARNING" : undefined,
  });

  if (outcome === "SUCCESS") {
    await notifyUser(payment.userId, "PAYMENT_CONFIRMED", {
      title: "Paiement confirmé",
      message: `Votre paiement de ${payment.amount.toLocaleString("fr-FR")} FCFA a été confirmé.`,
      actionUrl: "/account/orders",
      priority: "CRITICAL",
    });
  } else {
    await notifyUser(payment.userId, "SYSTEM", {
      title: "Paiement non abouti",
      message: `Votre paiement de ${payment.amount.toLocaleString("fr-FR")} FCFA a échoué${
        opts.failureReason ? ` : ${opts.failureReason}` : "."
      }`,
      actionUrl: "/account/orders",
    });
  }

  return {
    status: updated.status,
    already: false,
    paymentId: payment.id,
    type: payment.type,
    userId: payment.userId,
    amount: payment.amount,
  };
}

// ---------------------------------------------------------------------------
// État d'un paiement (page de paiement) : montant, lien Wave avec le montant
// déjà rempli et dernière preuve envoyée. Seule l'équipe confirme un paiement.
// ---------------------------------------------------------------------------

export type CheckoutState = {
  status: PaymentStatus;
  amount: number;
  currency: string;
  type: PaymentType;
  paymentNumber: string;
  paidAt: string | null;
  /** Commande concernée : le client y est renvoyé après paiement. */
  orderId: string | null;
  /** Lien Wave Business avec le montant à payer (null : paiement Wave par lien désactivé). */
  waveLink: string | null;
  /** Dernière preuve de paiement envoyée (paiement par lien Wave). */
  proof: Awaited<ReturnType<typeof latestProof>>;
};

export async function getCheckoutState(transactionToken: string): Promise<CheckoutState> {
  const payment = await prisma.payment.findUnique({ where: { transactionToken } });
  if (!payment) throw notFound("Transaction introuvable");
  const payable = payment.status === "PENDING" || payment.status === "PROCESSING";
  const [waveBase, proof] = await Promise.all([payable ? getWaveMerchantLink() : Promise.resolve(null), latestProof(payment.id)]);
  return {
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    type: payment.type,
    paymentNumber: payment.paymentNumber,
    paidAt: payment.paidAt?.toISOString() ?? null,
    orderId: payment.orderId,
    waveLink: waveBase ? waveLinkWithAmount(waveBase, payment.amount) : null,
    proof,
  };
}

// ---------------------------------------------------------------------------
// Historiques
// ---------------------------------------------------------------------------

export async function listMyPayments(userId: string) {
  const rows = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      paymentNumber: true,
      type: true,
      amount: true,
      currency: true,
      status: true,
      failureReason: true,
      createdAt: true,
      paidAt: true,
    },
  });
  return rows.map((p) => ({
    id: p.id,
    paymentNumber: p.paymentNumber,
    type: p.type,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    failureReason: p.failureReason,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
  }));
}
