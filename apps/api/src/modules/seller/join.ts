import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { Prisma } from "@misterdou/db";
import { ApiError, conflict, forbidden } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";
import { getIntSetting } from "../settings/service.js";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Devenir vendeur : un client à l'identité vérifiée règle les frais d'adhésion
// (Settings.sellerRegistrationFee, 1 000 FCFA par défaut). Dès que le paiement
// est confirmé par le serveur, le compte passe vendeur, sans validation
// manuelle. Il garde tous les droits d'un client (voir et acheter les offres
// des autres).
// ---------------------------------------------------------------------------

export const SELLER_FEE_KEY = "sellerRegistrationFee";

export async function sellerRegistrationFee(): Promise<number> {
  const fee = await getIntSetting(SELLER_FEE_KEY, 1000);
  return fee > 0 ? fee : 1000;
}

async function isKycVerified(userId: string): Promise<boolean> {
  const kyc = await prisma.identityVerification.findFirst({
    where: { userId },
    orderBy: { submittedAt: "desc" },
    select: { status: true },
  });
  return kyc?.status === "VERIFIED";
}

export async function sellerJoinState(userId: string) {
  const [seller, kycVerified, fee, pending, commissionPercent] = await Promise.all([
    prisma.seller.findUnique({ where: { userId }, select: { status: true } }),
    isKycVerified(userId),
    sellerRegistrationFee(),
    prisma.payment.findFirst({
      where: { userId, type: "SELLER_REGISTRATION_FEE", status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
      select: { transactionToken: true },
    }),
    getIntSetting("sellerCommissionPercent", 15),
  ]);
  return {
    fee,
    commissionPercent,
    kycVerified,
    sellerStatus: seller?.status ?? null,
    checkoutUrl: pending?.transactionToken ? `/checkout/${pending.transactionToken}` : null,
  };
}

/** Ouvre (ou reprend) le paiement des frais d'adhésion. */
export async function requestSellerJoin(ctx: { actorId: string; ip?: string }): Promise<{ checkoutUrl: string; amount: number }> {
  const seller = await prisma.seller.findUnique({ where: { userId: ctx.actorId }, select: { status: true } });
  if (seller?.status === "ACTIVE") throw conflict("SELLER_ALREADY_ACTIVE", "Votre compte vendeur est déjà actif.");
  if (seller && seller.status !== "APPLICATION_PENDING") {
    throw forbidden("Votre accès vendeur a été suspendu. Contactez le support.");
  }
  if (!(await isKycVerified(ctx.actorId))) {
    throw new ApiError("SELLER_NOT_KYC_VERIFIED", 403, "Vérifiez votre identité avant de devenir vendeur.");
  }

  // Un paiement déjà ouvert est repris : jamais deux frais d'adhésion en parallèle.
  const pending = await prisma.payment.findFirst({
    where: { userId: ctx.actorId, type: "SELLER_REGISTRATION_FEE", status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    select: { transactionToken: true, amount: true },
  });
  if (pending?.transactionToken) return { checkoutUrl: `/checkout/${pending.transactionToken}`, amount: pending.amount };

  const amount = await sellerRegistrationFee();
  const token = "mdpay_" + randomBytes(18).toString("base64url");
  const payment = await prisma.payment.create({
    data: {
      paymentNumber: `PAY-SELL-${randomInt(1_000_000, 9_999_999)}`,
      userId: ctx.actorId,
      type: "SELLER_REGISTRATION_FEE",
      amount,
      currency: "XOF",
      provider: "PAYTECH",
      status: "PENDING",
      transactionToken: token,
    },
    select: { id: true, paymentNumber: true },
  });
  await logAudit({
    actorId: ctx.actorId,
    ip: ctx.ip,
    action: "SELLER_JOIN_REQUESTED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: { amount, paymentNumber: payment.paymentNumber },
  });
  return { checkoutUrl: `/checkout/${token}`, amount };
}

/** Appelée par settlePayment DANS la transaction, une fois les frais payés. */
export async function activateSeller(tx: Tx, payment: { id: string; userId: string; amount: number }): Promise<void> {
  const now = new Date();
  const existing = await tx.seller.findUnique({ where: { userId: payment.userId }, select: { id: true, status: true } });
  if (existing && existing.status !== "APPLICATION_PENDING") return; // déjà actif, ou suspendu : rien à changer

  const seller = existing
    ? await tx.seller.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", registrationFee: payment.amount, registrationPaidAt: now, sellerSince: now, approvedAt: now },
        select: { id: true },
      })
    : await tx.seller.create({
        data: {
          userId: payment.userId,
          status: "ACTIVE",
          registrationFee: payment.amount,
          registrationPaidAt: now,
          sellerSince: now,
          approvedAt: now,
        },
        select: { id: true },
      });
  await tx.sellerBalance.upsert({ where: { sellerId: seller.id }, create: { sellerId: seller.id }, update: {} });

  // Rôle « vendeur » pour un client ; l'équipe garde le sien.
  const user = await tx.user.findUnique({ where: { id: payment.userId }, select: { role: { select: { name: true } } } });
  if (user?.role.name === "CLIENT") {
    const vendor = await tx.role.findUniqueOrThrow({ where: { name: "VENDOR" }, select: { id: true } });
    await tx.user.update({ where: { id: payment.userId }, data: { roleId: vendor.id } });
  }

  await notifyUser(payment.userId, "SYSTEM", {
    title: "Bienvenue parmi les vendeurs",
    message: "Votre compte vendeur est actif. Retrouvez vos offres, vos ventes et vos retraits dans l’espace vendeur.",
    actionUrl: "/seller",
    priority: "NORMAL",
  });
}
