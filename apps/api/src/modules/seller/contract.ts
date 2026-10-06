import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { Prisma } from "@misterdou/db";
import { ApiError, conflict, forbidden } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { notifyUser } from "../../lib/notify.js";
import { getIntSetting } from "../settings/service.js";
import { activateSeller } from "./join.js";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Contrat revendeur : pour ceux qui revendent des comptes qui ne leur
// appartiennent pas (petite marge), un forfait payé d'avance remplace la
// commission sur chaque vente. 6 mois, 1 an ou 18 mois (prix réglables dans
// Paramètres). Paiement par lien Wave, vérifié par l'équipe comme les autres.
// • Payé : le compte devient vendeur s'il ne l'était pas (adhésion incluse).
// • Pendant le contrat : 0 % de commission sur les ventes.
// • Renouvelé avant la fin : le nouveau contrat démarre à la fin de l'actuel.
// • À la fin : rappel 7 jours avant, puis retour à la commission habituelle.
// ---------------------------------------------------------------------------

export const CONTRACT_PLANS = [
  { months: 6, key: "resellerContract6Price", fallback: 5000 },
  { months: 12, key: "resellerContract12Price", fallback: 8000 },
  { months: 18, key: "resellerContract18Price", fallback: 10000 },
] as const;

export const contractRequestSchema = z.object({ months: z.union([z.literal(6), z.literal(12), z.literal(18)]) });

const REMIND_DAYS = 7;

export async function contractPlans(): Promise<Array<{ months: number; price: number }>> {
  return Promise.all(
    CONTRACT_PLANS.map(async (p) => {
      const price = await getIntSetting(p.key, p.fallback);
      return { months: p.months, price: price > 0 ? price : p.fallback };
    }),
  );
}

/** Ajoute des mois calendaires (le 31 janvier + 1 mois = le dernier jour de février). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Contrat en cours à une date donnée pour ce compte (0 % de commission), ou null. */
export async function runningContract(db: Tx | typeof prisma, userId: string, at = new Date()) {
  return db.sellerContract.findFirst({
    where: { userId, status: "ACTIVE", startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { endsAt: "desc" },
    select: { id: true, months: true, startsAt: true, endsAt: true },
  });
}

/** État affiché sur « Devenir vendeur » et dans l'espace vendeur. */
export async function contractState(userId: string) {
  const now = new Date();
  const [plans, contracts, pending, kyc, seller] = await Promise.all([
    contractPlans(),
    prisma.sellerContract.findMany({
      where: { userId, status: "ACTIVE", endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      select: { months: true, startsAt: true, endsAt: true },
    }),
    prisma.sellerContract.findFirst({
      where: { userId, status: "PENDING", payment: { status: { in: ["PENDING", "PROCESSING"] } } },
      orderBy: { createdAt: "desc" },
      select: { months: true, amount: true, payment: { select: { transactionToken: true, status: true } } },
    }),
    prisma.identityVerification.findFirst({ where: { userId }, orderBy: { submittedAt: "desc" }, select: { status: true } }),
    prisma.seller.findUnique({ where: { userId }, select: { status: true } }),
  ]);
  const current = contracts.find((c) => c.startsAt! <= now) ?? null;
  const last = contracts[contracts.length - 1] ?? null;
  return {
    plans,
    kycVerified: kyc?.status === "VERIFIED",
    sellerStatus: seller?.status ?? null,
    commissionPercent: await getIntSetting("sellerCommissionPercent", 15),
    // Contrat en cours, et date de fin en comptant les renouvellements déjà payés.
    current: current ? { months: current.months, startsAt: current.startsAt!.toISOString(), endsAt: current.endsAt!.toISOString() } : null,
    coveredUntil: last?.endsAt?.toISOString() ?? null,
    pending: pending?.payment?.transactionToken
      ? {
          months: pending.months,
          amount: pending.amount,
          checkoutUrl: `/checkout/${pending.payment.transactionToken}`,
          inReview: pending.payment.status === "PROCESSING",
        }
      : null,
  };
}

/** Ouvre (ou reprend) le paiement d'un contrat. Identité vérifiée exigée. */
export async function requestContract(months: 6 | 12 | 18, ctx: { actorId: string; ip?: string }) {
  const seller = await prisma.seller.findUnique({ where: { userId: ctx.actorId }, select: { status: true } });
  if (seller && seller.status !== "ACTIVE" && seller.status !== "APPLICATION_PENDING") {
    throw forbidden("Votre accès vendeur a été suspendu. Contactez le support.");
  }
  const kyc = await prisma.identityVerification.findFirst({ where: { userId: ctx.actorId }, orderBy: { submittedAt: "desc" }, select: { status: true } });
  if (kyc?.status !== "VERIFIED") {
    throw new ApiError("SELLER_NOT_KYC_VERIFIED", 403, "Vérifiez votre identité avant d’établir un contrat.");
  }

  // Un seul paiement de contrat ouvert à la fois : même durée → on le reprend ;
  // autre durée → l'ancien est annulé (sauf si sa preuve est déjà en vérification).
  const open = await prisma.sellerContract.findFirst({
    where: { userId: ctx.actorId, status: "PENDING", payment: { status: { in: ["PENDING", "PROCESSING"] } } },
    select: { id: true, months: true, amount: true, paymentId: true, payment: { select: { status: true, transactionToken: true } } },
  });
  if (open?.payment?.transactionToken) {
    if (open.months === months || open.payment.status === "PROCESSING") {
      if (open.months !== months) {
        throw conflict("PROOF_ALREADY_SENT", "Votre paiement de contrat est en cours de vérification : attendez la réponse de l’équipe.");
      }
      return { checkoutUrl: `/checkout/${open.payment.transactionToken}`, amount: open.amount };
    }
    await prisma.$transaction([
      prisma.payment.updateMany({ where: { id: open.paymentId!, status: "PENDING" }, data: { status: "CANCELLED", failureReason: "Autre durée choisie" } }),
      prisma.sellerContract.update({ where: { id: open.id }, data: { status: "CANCELLED" } }),
    ]);
  }

  const amount = (await contractPlans()).find((p) => p.months === months)!.price;
  const token = "mdpay_" + randomBytes(18).toString("base64url");
  const created = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        paymentNumber: `PAY-CTR-${randomInt(1_000_000, 9_999_999)}`,
        userId: ctx.actorId,
        type: "SELLER_CONTRACT",
        amount,
        currency: "XOF",
        provider: "WAVE_LINK",
        status: "PENDING",
        transactionToken: token,
      },
      select: { id: true, paymentNumber: true },
    });
    const contract = await tx.sellerContract.create({
      data: { userId: ctx.actorId, months, amount, paymentId: payment.id },
      select: { id: true },
    });
    return { payment, contract };
  });
  await logAudit({
    actorId: ctx.actorId,
    ip: ctx.ip,
    action: "SELLER_CONTRACT_REQUESTED",
    resourceType: "SellerContract",
    resourceId: created.contract.id,
    metadata: { months, amount, paymentNumber: created.payment.paymentNumber },
  });
  return { checkoutUrl: `/checkout/${token}`, amount };
}

const dateFr = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Appelée par settlePayment DANS la transaction, une fois le contrat payé. */
export async function activateContract(tx: Tx, payment: { id: string; userId: string; amount: number }): Promise<void> {
  const contract = await tx.sellerContract.findUnique({ where: { paymentId: payment.id }, select: { id: true, months: true, status: true } });
  if (!contract) {
    logger.warn({ paymentId: payment.id }, "[contrat] paiement sans contrat");
    return;
  }
  if (contract.status === "ACTIVE") return; // déjà fait

  // Le contrat inclut l'adhésion : le compte devient vendeur s'il ne l'est pas.
  await activateSeller(tx, { id: payment.id, userId: payment.userId, amount: 0 });

  const now = new Date();
  const latest = await tx.sellerContract.findFirst({
    where: { userId: payment.userId, status: "ACTIVE", endsAt: { gt: now } },
    orderBy: { endsAt: "desc" },
    select: { endsAt: true },
  });
  const startsAt = latest?.endsAt ?? now;
  const endsAt = addMonths(startsAt, contract.months);
  await tx.sellerContract.update({ where: { id: contract.id }, data: { status: "ACTIVE", startsAt, endsAt } });

  await notifyUser(payment.userId, "SYSTEM", {
    title: "Contrat revendeur actif 🤝",
    message: latest
      ? `Renouvellement confirmé : votre contrat est prolongé jusqu’au ${dateFr(endsAt)}. Aucune commission sur vos ventes d’ici là.`
      : `Votre contrat est actif jusqu’au ${dateFr(endsAt)} : aucune commission sur vos ventes pendant toute cette période.`,
    actionUrl: "/seller",
    priority: "NORMAL",
  });
}

/**
 * Tâche quotidienne : rappel 7 jours avant la fin (sauf renouvellement déjà
 * payé), puis fin du contrat (retour à la commission habituelle).
 */
export async function runContractJobs(now = new Date()): Promise<{ reminded: number; expired: number }> {
  const soon = new Date(now.getTime() + REMIND_DAYS * 86_400_000);
  const ending = await prisma.sellerContract.findMany({
    where: { status: "ACTIVE", remindedAt: null, endsAt: { gt: now, lte: soon } },
    select: { id: true, userId: true, endsAt: true },
  });
  let reminded = 0;
  for (const c of ending) {
    const renewed = await prisma.sellerContract.count({ where: { userId: c.userId, status: "ACTIVE", endsAt: { gt: c.endsAt! } } });
    await prisma.sellerContract.update({ where: { id: c.id }, data: { remindedAt: now } });
    if (renewed > 0) continue;
    reminded += 1;
    await notifyUser(c.userId, "SYSTEM", {
      title: "Votre contrat revendeur se termine bientôt",
      message: `Il prend fin le ${dateFr(c.endsAt!)}. Renouvelez-le pour continuer à vendre sans commission.`,
      actionUrl: "/account/devenir-vendeur",
      priority: "NORMAL",
    });
  }

  const finished = await prisma.sellerContract.findMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    select: { id: true, userId: true },
  });
  const commission = await getIntSetting("sellerCommissionPercent", 15);
  for (const c of finished) {
    await prisma.sellerContract.update({ where: { id: c.id }, data: { status: "EXPIRED" } });
    const next = await runningContract(prisma, c.userId, now);
    if (next) continue;
    await notifyUser(c.userId, "SYSTEM", {
      title: "Contrat revendeur terminé",
      message: `Votre contrat a pris fin : la commission habituelle de ${commission} % s’applique de nouveau à vos ventes. Vous pouvez le renouveler à tout moment.`,
      actionUrl: "/account/devenir-vendeur",
      priority: "NORMAL",
    });
  }
  return { reminded, expired: finished.length };
}

export function startContractJobs(): NodeJS.Timeout {
  const run = async () => {
    try {
      const result = await runContractJobs();
      if (result.reminded || result.expired) logger.info(result, "[contrat] rappels et fins de contrat");
    } catch (err) {
      logger.error({ err }, "[contrat] échec de la tâche des contrats");
    }
  };
  void run();
  const timer = setInterval(() => void run(), 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
