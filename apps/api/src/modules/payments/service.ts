import { randomBytes } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { PaymentStatus, PaymentType, Prisma, RoleName } from "@misterdou/db";
import { badRequest, notFound } from "../../lib/errors.js";
import { deliverOrderAfterSuccess } from "../../modules/orders/service.js";
import { applyDownPayment, applyInstallmentPayment } from "../../modules/installments/service.js";
import { activateFeatured } from "../../modules/promotions/service.js";
import { notifyUser } from "../../lib/notify.js";
import { logAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../env.js";
import {
  CHECKOUT_METHOD_LABELS,
  createProviderCheckout,
  fetchProviderStatus,
  isProviderConfigured,
  type CheckoutMethod,
} from "./paytech.js";

export function randomTransactionToken(): string {
  return "mdpay_" + randomBytes(18).toString("base64url");
}

export interface PaymentContext {
  actorId?: string;
  actorRole?: RoleName;
  ip?: string;
}

type Tx = Prisma.TransactionClient;

const TERMINAL_STATUSES: PaymentStatus[] = ["SUCCESS", "FAILED", "CANCELLED", "REFUNDED"];

// ---------------------------------------------------------------------------
// Création d'un paiement (jamais créé côté frontend — montant calculé Serveur)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SETTLE — l'unique porte d'évolution de statut (webhook, poll, réconciliation,
// stub dev). Atomique et idempotent : UPDATE … WHERE status ∈ (PENDING,
// PROCESSING) — un second appel ne crédite JAMAIS deux fois (docs/06 §1.3).
// ---------------------------------------------------------------------------

export type SettleOutcome = "SUCCESS" | "FAILED" | "CANCELLED";
export type SettleSource = "WEBHOOK" | "RECONCILE" | "POLL" | "DEV";

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
              ...(opts.source === "WEBHOOK" ? { webhookReceivedAt: now } : {}),
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
// Checkout — PENDING → PROCESSING : appel fournisseur (mode réel) ou passage
// en mode local hébergé (Wave / Orange Money affichés côté client).
// ---------------------------------------------------------------------------

export type CheckoutInit =
  | { mode: "REDIRECT"; url: string; status: PaymentStatus }
  | { mode: "LOCAL"; status: PaymentStatus }
  | { mode: "POLL"; status: PaymentStatus }
  | { mode: "DONE"; status: PaymentStatus };

export async function initiateCheckout(
  transactionToken: string,
  method: CheckoutMethod,
  ctx: PaymentContext,
): Promise<CheckoutInit> {
  const payment = await prisma.payment.findUnique({ where: { transactionToken } });
  if (!payment) throw notFound("Transaction introuvable");
  if (payment.userId !== ctx.actorId) throw notFound("Transaction introuvable");

  if (payment.status === "SUCCESS" || payment.status === "REFUNDED") return { mode: "DONE", status: payment.status };
  if (payment.status === "FAILED" || payment.status === "CANCELLED") {
    throw badRequest("CONFLICT", "Ce paiement est déjà clôturé — relancez une nouvelle demande.");
  }

  if (payment.status === "PROCESSING") {
    if (payment.providerReference?.startsWith("local-")) return { mode: "LOCAL", status: "PROCESSING" };
    if (!isProviderConfigured()) return { mode: "POLL", status: "PROCESSING" };
    return { mode: "POLL", status: "PROCESSING" };
  }

  // PENDING → PROCESSING
  if (!isProviderConfigured()) {
    const providerReference = `local-${method}-${payment.paymentNumber}`;
    const res = await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "PROCESSING", providerReference },
    });
    if (res.count === 0) {
      const cur = await prisma.payment.findUnique({ where: { id: payment.id } });
      return { mode: "POLL", status: cur?.status ?? "PROCESSING" };
    }
    return { mode: "LOCAL", status: "PROCESSING" };
  }

  const webOrigin = env.WEB_ORIGIN[0];
  const callbackUrl = env.PAYTECH_CALLBACK_URL ?? `${webOrigin}/checkout/${payment.transactionToken}`;
  const checkout = await createProviderCheckout({
    reference: payment.paymentNumber,
    amount: payment.amount,
    currency: payment.currency,
    method,
    customerPhone: null,
    callbackUrl,
  });
  const res = await prisma.payment.updateMany({
    where: { id: payment.id, status: "PENDING" },
    data: { status: "PROCESSING", providerReference: checkout.reference },
  });
  if (res.count === 0) {
    const cur = await prisma.payment.findUnique({ where: { id: payment.id } });
    return { mode: "POLL", status: cur?.status ?? "PROCESSING" };
  }
  logger.info({ paymentNumber: payment.paymentNumber, method: CHECKOUT_METHOD_LABELS[method] }, "[payments] checkout initié");
  return { mode: "REDIRECT", url: checkout.url, status: "PROCESSING" };
}

// ---------------------------------------------------------------------------
// État du checkout (poll) — applique la même vérification serveur que le
// webhook : mode local (dev) confirme au poll ; mode réel interroge le
// fournisseur (renfort docs/06 §1.4).
// ---------------------------------------------------------------------------

export type CheckoutState = {
  status: PaymentStatus;
  amount: number;
  currency: string;
  type: PaymentType;
  paymentNumber: string;
  paidAt: string | null;
};

export async function getCheckoutState(transactionToken: string): Promise<CheckoutState> {
  let payment = await prisma.payment.findUnique({ where: { transactionToken } });
  if (!payment) throw notFound("Transaction introuvable");

  if (payment.status === "PROCESSING") {
    if (payment.providerReference?.startsWith("local-")) {
      if (env.NODE_ENV !== "production") {
        await settlePayment(
          { id: payment.id },
          "SUCCESS",
          { source: "POLL", providerReference: payment.providerReference },
        );
        payment = await prisma.payment.findUnique({ where: { transactionToken } });
      }
    } else if (isProviderConfigured() && payment.providerReference) {
      const remote = await fetchProviderStatus(payment.providerReference);
      if (remote) {
        await settlePayment({ id: payment.id }, remote, {
          source: "RECONCILE",
          failureReason: remote === "SUCCESS" ? null : "Statut fournisseur : " + remote,
        });
        payment = await prisma.payment.findUnique({ where: { transactionToken } });
      }
    }
  }

  if (!payment) throw notFound("Transaction introuvable");
  return {
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    type: payment.type,
    paymentNumber: payment.paymentNumber,
    paidAt: payment.paidAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Réconciliation périodique — payments PROCESSING trop vieilles (webhook perdu).
// ---------------------------------------------------------------------------

const RECONCILE_AGE_MS = 5 * 60_000;
const RECONCILE_INTERVAL_MS = 60_000;

export async function reconcileProcessingPayments(): Promise<number> {
  const cutoff = new Date(Date.now() - RECONCILE_AGE_MS);
  const stale = await prisma.payment.findMany({
    where: { status: "PROCESSING", updatedAt: { lt: cutoff } },
    take: 50,
    select: { id: true, providerReference: true, paymentNumber: true, amount: true },
  });
  let settled = 0;
  for (const p of stale) {
    try {
      if (p.providerReference?.startsWith("local-")) {
        if (env.NODE_ENV !== "production") {
          const r = await settlePayment({ id: p.id }, "SUCCESS", {
            source: "RECONCILE",
            providerReference: p.providerReference,
          });
          if (!r.already) settled++;
        }
        continue;
      }
      const remote = await fetchProviderStatus(p.providerReference ?? p.paymentNumber);
      if (remote) {
        const r = await settlePayment({ id: p.id }, remote, {
          source: "RECONCILE",
          failureReason: remote === "SUCCESS" ? null : "Statut fournisseur : " + remote,
        });
        if (!r.already) settled++;
      }
    } catch (err) {
      logger.warn({ err, paymentId: p.id }, "[payments] réconciliation d'un paiement échouée");
    }
  }
  if (settled > 0) logger.info({ settled }, "[payments] réconciliation a confirmé des paiements");
  return settled;
}

export function startPaymentReconciliation(): NodeJS.Timeout {
  const timer = setInterval(() => {
    reconcileProcessingPayments().catch((err) => logger.error({ err }, "[payments] job de réconciliation échoué"));
  }, RECONCILE_INTERVAL_MS);
  timer.unref();
  return timer;
}

// ---------------------------------------------------------------------------
// Confirmation DEV (stub) — route dev uniquement, MÊME moteur settlePayment.
// ---------------------------------------------------------------------------

export async function confirmTransaction(
  token: string,
  ctx?: PaymentContext,
  expectedUserId?: string,
): Promise<{ status: PaymentStatus; already: boolean }> {
  const payment = await prisma.payment.findUnique({ where: { transactionToken: token } });
  if (!payment) throw badRequest("PAYMENT_NOT_VERIFIED", "Transaction inconnue");
  if (expectedUserId && payment.userId !== expectedUserId) {
    throw badRequest("PAYMENT_NOT_VERIFIED", "Transaction inconnue");
  }
  const result = await settlePayment(
    { id: payment.id },
    "SUCCESS",
    { source: "DEV", providerReference: payment.providerReference ?? `dev-stub-${token}`, ctx },
  );
  return { status: result.status, already: result.already };
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

// ---------------------------------------------------------------------------
// Effets de bord TRANSACTIONNELS d'un SUCCESS
// ---------------------------------------------------------------------------

