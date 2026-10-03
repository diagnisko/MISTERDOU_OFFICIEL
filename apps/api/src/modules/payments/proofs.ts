import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { PaymentProofStatus, PaymentType, Prisma } from "@misterdou/db";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { deleteFile, getFile } from "../../lib/storage.js";
import { logger } from "../../lib/logger.js";
import { logAudit } from "../../lib/audit.js";
import { notifyTeam, notifyUser } from "../../lib/notify.js";
import { assertOwnedProof } from "../identity-verification/service.js";
import { getWaveMerchantLink } from "../settings/service.js";
import { settlePayment, type PaymentContext } from "./service.js";

// ---------------------------------------------------------------------------
// Paiement par lien Wave Business : le client paie le montant écrit dans le
// lien, puis envoie sa preuve (capture + numéro Wave payeur). Un administrateur
// ou un manager PAYMENTS vérifie la réception dans Wave Business et valide :
// la validation passe par settlePayment, comme un webhook (livraison du compte,
// part du vendeur en attente, notifications). Un refus rouvre le paiement pour
// une nouvelle preuve.
// ---------------------------------------------------------------------------

export const paymentProofSchema = z.object({
  proofKey: z.string().min(10).max(200),
  senderPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s.-]/g, ""))
    .refine((v) => /^\+?[0-9]{8,15}$/.test(v), "Numéro Wave invalide."),
  waveReference: z.string().trim().max(80).optional(),
});

export type PaymentProofInput = z.infer<typeof paymentProofSchema>;

const PAYMENT_LABELS: Record<PaymentType, string> = {
  ORDER_PAYMENT: "Achat",
  INITIAL_INSTALLMENT: "Apport (paiement en plusieurs fois)",
  INSTALLMENT: "Mensualité",
  REFUND: "Remboursement",
  FEATURED: "Mise en avant d’une offre",
  SELLER_REGISTRATION_FEE: "Frais d’adhésion vendeur",
};

function describe(type: PaymentType, title: string | null | undefined, days?: number | null): string {
  const base = title ? `${PAYMENT_LABELS[type]} « ${title} »` : PAYMENT_LABELS[type];
  return days ? `${base}, ${days} jour${days > 1 ? "s" : ""}` : base;
}

// Mise en avant : l'offre concernée et la durée achetée.
const FEATURED_SELECT = { take: 1, select: { days: true, product: { select: { title: true } } } } as const;

const xof = (amount: number) => `${amount.toLocaleString("fr-FR")} FCFA`;

// --- Client : envoi de la preuve -----------------------------------------------

export async function submitPaymentProof(token: string, input: PaymentProofInput, ctx: PaymentContext & { actorId: string }) {
  const payment = await prisma.payment.findUnique({
    where: { transactionToken: token },
    select: {
      id: true,
      userId: true,
      status: true,
      amount: true,
      type: true,
      paymentNumber: true,
      order: { select: { items: { select: { title: true }, take: 1 } } },
      featuredPurchases: FEATURED_SELECT,
    },
  });
  if (!payment || payment.userId !== ctx.actorId) throw notFound("Transaction introuvable");
  if (payment.status === "SUCCESS" || payment.status === "REFUNDED") {
    throw conflict("CONFLICT", "Ce paiement est déjà confirmé.");
  }
  if (payment.status === "FAILED" || payment.status === "CANCELLED") {
    throw conflict("CONFLICT", "Ce paiement est clôturé : relancez une nouvelle demande.");
  }
  if (payment.status === "PROCESSING") {
    const pending = await prisma.paymentProof.findFirst({ where: { paymentId: payment.id, status: "PENDING" }, select: { id: true } });
    throw conflict(
      "PROOF_ALREADY_SENT",
      pending ? "Votre preuve est déjà en cours de vérification." : "Un paiement est déjà en cours pour cette transaction.",
    );
  }
  if (!(await getWaveMerchantLink())) {
    throw badRequest("WAVE_LINK_UNAVAILABLE", "Le paiement par Wave est momentanément indisponible.");
  }

  await assertOwnedProof(input.proofKey, ctx.actorId, "payment_proof");

  const reference = input.waveReference?.trim() || null;
  if (reference) {
    const reused = await prisma.paymentProof.findFirst({
      where: {
        waveReference: { equals: reference, mode: "insensitive" },
        status: { in: ["PENDING", "APPROVED"] },
        paymentId: { not: payment.id },
      },
      select: { id: true },
    });
    if (reused) {
      throw conflict("PROOF_REFERENCE_USED", "Cette référence de transaction Wave a déjà servi pour un autre paiement.");
    }
  }

  const proof = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "PROCESSING", provider: "WAVE_LINK", providerReference: `wavelink-${payment.paymentNumber}` },
    });
    if (claimed.count === 0) throw conflict("PROOF_ALREADY_SENT", "Un paiement est déjà en cours pour cette transaction.");
    return tx.paymentProof.create({
      data: {
        paymentId: payment.id,
        userId: ctx.actorId,
        amount: payment.amount,
        screenshotKey: input.proofKey,
        senderPhone: input.senderPhone,
        waveReference: reference,
      },
      select: { id: true, status: true, createdAt: true },
    });
  });

  await logAudit({
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    ip: ctx.ip,
    action: "PAYMENT_PROOF_SUBMITTED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: { proofId: proof.id, amount: payment.amount, paymentNumber: payment.paymentNumber, hasReference: Boolean(reference) },
  });
  await notifyTeam("PAYMENTS", "ADMIN_ALERT", {
    title: "Paiement Wave à vérifier",
    message: `${xof(payment.amount)} : ${describe(payment.type, payment.order?.items[0]?.title ?? payment.featuredPurchases[0]?.product.title, payment.featuredPurchases[0]?.days)}. Vérifiez la réception dans Wave Business, puis validez.`,
    actionUrl: "/admin/payments",
    priority: "CRITICAL",
  });

  return { status: "PROCESSING" as const, proof: { id: proof.id, status: proof.status, createdAt: proof.createdAt.toISOString() } };
}

/** Dernière preuve d'un paiement (affichée au client sur la page de paiement). */
export async function latestProof(paymentId: string) {
  const proof = await prisma.paymentProof.findFirst({
    where: { paymentId },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true, reviewedAt: true, rejectionReason: true },
  });
  if (!proof) return null;
  return {
    status: proof.status,
    createdAt: proof.createdAt.toISOString(),
    reviewedAt: proof.reviewedAt?.toISOString() ?? null,
    rejectionReason: proof.rejectionReason,
  };
}

// --- Équipe : file des preuves ---------------------------------------------------

export const proofListQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"),
});

export async function listPaymentProofs(status: PaymentProofStatus) {
  const rows = await prisma.paymentProof.findMany({
    where: { status },
    // À vérifier : les plus anciennes d'abord ; déjà traitées : les plus récentes.
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      amount: true,
      senderPhone: true,
      waveReference: true,
      screenshotKey: true,
      createdAt: true,
      reviewedAt: true,
      rejectionReason: true,
      user: { select: { email: true, firstName: true, lastName: true, phoneNumber: true } },
      payment: {
        select: {
          id: true,
          paymentNumber: true,
          type: true,
          amount: true,
          status: true,
          order: {
            select: {
              orderNumber: true,
              status: true,
              items: { take: 1, select: { title: true, product: { select: { status: true } } } },
            },
          },
          featuredPurchases: FEATURED_SELECT,
        },
      },
    },
  });

  // Une même référence Wave sur deux paiements : signal de fraude possible.
  const references = [...new Set(rows.map((r) => r.waveReference).filter((r): r is string => Boolean(r)))];
  const twins = references.length
    ? await prisma.paymentProof.findMany({
        where: { waveReference: { in: references, mode: "insensitive" }, status: { in: ["PENDING", "APPROVED"] } },
        select: { id: true, waveReference: true, payment: { select: { paymentNumber: true } } },
      })
    : [];
  const pendingCount = status === "PENDING" ? rows.length : await prisma.paymentProof.count({ where: { status: "PENDING" } });

  return {
    pendingCount,
    items: rows.map((r) => {
      const item = r.payment.order?.items[0];
      const reusedBy = r.waveReference
        ? twins
            .filter((t) => t.id !== r.id && t.waveReference?.toLowerCase() === r.waveReference!.toLowerCase())
            .map((t) => t.payment.paymentNumber)
        : [];
      return {
        id: r.id,
        status: r.status,
        amount: r.amount,
        senderPhone: r.senderPhone,
        waveReference: r.waveReference,
        hasScreenshot: Boolean(r.screenshotKey),
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        rejectionReason: r.rejectionReason,
        client: r.user,
        label: describe(r.payment.type, item?.title ?? r.payment.featuredPurchases[0]?.product.title, r.payment.featuredPurchases[0]?.days),
        payment: { id: r.payment.id, paymentNumber: r.payment.paymentNumber, type: r.payment.type, status: r.payment.status },
        orderNumber: r.payment.order?.orderNumber ?? null,
        warnings: {
          // Le compte a été vendu à quelqu'un d'autre pendant la vérification.
          productSold: Boolean(item && item.product.status === "SOLD" && r.payment.order?.status === "PENDING_PAYMENT"),
          referenceReusedBy: reusedBy,
          amountChanged: r.amount !== r.payment.amount,
        },
      };
    }),
  };
}

export async function getPaymentProofFile(id: string) {
  const proof = await prisma.paymentProof.findUnique({ where: { id }, select: { screenshotKey: true } });
  if (!proof) throw notFound("Preuve introuvable.");
  if (!proof.screenshotKey) throw notFound("Capture supprimée après validation du paiement.");
  return getFile(proof.screenshotKey);
}

// ---------------------------------------------------------------------------
// Place libérée : une capture ne sert plus une fois le paiement validé (ni une
// capture d'envoi une fois que le vendeur a confirmé « Reçu »). Les preuves
// refusées sont gardées 30 jours (en cas de litige), puis supprimées.
// La ligne reste en base (montant, numéro, dates) ; seule l'image disparaît.
// ---------------------------------------------------------------------------

/** Clé vide = capture supprimée (la ligne de preuve, elle, est conservée). */
export const PROOF_REMOVED = "";
const REJECTED_KEEP_DAYS = 30;

async function dropFile(key: string | null | undefined) {
  if (!key) return;
  await deleteFile(key).catch((err) => logger.warn({ err }, "[proofs] capture déjà absente du stockage"));
}

export async function removeProofScreenshot(proofId: string) {
  const proof = await prisma.paymentProof.findUnique({ where: { id: proofId }, select: { screenshotKey: true } });
  if (!proof?.screenshotKey) return;
  await dropFile(proof.screenshotKey);
  await prisma.paymentProof.update({ where: { id: proofId }, data: { screenshotKey: PROOF_REMOVED } });
}

/** Rattrapage périodique (captures validées, envois reçus, refus anciens). */
export async function purgeProofScreenshots(now = new Date()): Promise<number> {
  const rejectedBefore = new Date(now.getTime() - REJECTED_KEEP_DAYS * 86_400_000);
  const proofs = await prisma.paymentProof.findMany({
    where: {
      screenshotKey: { not: PROOF_REMOVED },
      OR: [{ status: "APPROVED" }, { status: "REJECTED", reviewedAt: { lt: rejectedBefore } }],
    },
    select: { id: true, screenshotKey: true },
    take: 200,
  });
  for (const p of proofs) {
    await dropFile(p.screenshotKey);
    await prisma.paymentProof.update({ where: { id: p.id }, data: { screenshotKey: PROOF_REMOVED } });
  }
  const withdrawals = await prisma.withdrawal.findMany({
    where: { status: "COMPLETED", proofKey: { not: null } },
    select: { id: true, proofKey: true },
    take: 200,
  });
  for (const w of withdrawals) {
    await dropFile(w.proofKey);
    await prisma.withdrawal.update({ where: { id: w.id }, data: { proofKey: null } });
  }
  return proofs.length + withdrawals.length;
}

export function startProofCleanupJob(): NodeJS.Timeout {
  const run = async () => {
    try {
      const removed = await purgeProofScreenshots();
      if (removed > 0) logger.info({ removed }, "[proofs] captures supprimées (place libérée)");
    } catch (err) {
      logger.error({ err }, "[proofs] échec du nettoyage des captures");
    }
  };
  void run();
  const timer = setInterval(() => void run(), 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

type ReviewActor = Required<Pick<PaymentContext, "actorId">> & PaymentContext;

async function pendingProof(id: string) {
  const proof = await prisma.paymentProof.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      amount: true,
      payment: { select: { id: true, status: true, userId: true, type: true, transactionToken: true, paymentNumber: true } },
    },
  });
  if (!proof) throw notFound("Preuve introuvable.");
  if (proof.status !== "PENDING") throw conflict("PROOF_ALREADY_REVIEWED", "Cette preuve a déjà été traitée.");
  if (proof.payment.status !== "PROCESSING") {
    throw conflict("INVALID_STATE", "Ce paiement n’attend plus de vérification.");
  }
  return proof;
}

export async function approvePaymentProof(id: string, actor: ReviewActor) {
  const proof = await pendingProof(id);
  const claimed = await prisma.paymentProof.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", reviewedById: actor.actorId, reviewedAt: new Date() },
  });
  if (claimed.count === 0) throw conflict("PROOF_ALREADY_REVIEWED", "Cette preuve a déjà été traitée.");

  // Même porte que le webhook : livraison, part du vendeur, notifications.
  const settled = await settlePayment({ id: proof.payment.id }, "SUCCESS", {
    source: "MANUAL",
    ctx: { actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip },
  });
  // Paiement validé : la capture ne sert plus, on libère la place.
  await removeProofScreenshot(id);

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "PAYMENT_PROOF_APPROVED",
    resourceType: "Payment",
    resourceId: proof.payment.id,
    metadata: { proofId: id, amount: proof.amount, paymentNumber: proof.payment.paymentNumber },
    severity: "WARNING",
  });
  return { id, status: "APPROVED" as const, paymentStatus: settled.status };
}

export async function rejectPaymentProof(id: string, reason: string, actor: ReviewActor) {
  const proof = await pendingProof(id);
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.paymentProof.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: actor.actorId, reviewedAt: new Date(), rejectionReason: reason },
    });
    if (claimed.count === 0) throw conflict("PROOF_ALREADY_REVIEWED", "Cette preuve a déjà été traitée.");
    // Le paiement redevient payable : le client peut envoyer une nouvelle preuve.
    await tx.payment.updateMany({ where: { id: proof.payment.id, status: "PROCESSING" }, data: { status: "PENDING" } });
  });

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "PAYMENT_PROOF_REJECTED",
    resourceType: "Payment",
    resourceId: proof.payment.id,
    metadata: { proofId: id, amount: proof.amount, paymentNumber: proof.payment.paymentNumber, reason },
    severity: "WARNING",
  });
  await notifyUser(proof.payment.userId, "SYSTEM", {
    title: "Paiement non validé",
    message: `Votre preuve de paiement de ${xof(proof.amount)} n’a pas été acceptée (motif : « ${reason} »). Vous pouvez envoyer une nouvelle preuve.`,
    actionUrl: proof.payment.transactionToken ? `/checkout/${proof.payment.transactionToken}` : "/account/orders",
    priority: "CRITICAL",
  });
  return { id, status: "REJECTED" as const };
}
