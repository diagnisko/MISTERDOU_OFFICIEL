import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { deleteFile, encryptString } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { notifyActiveAdmins, notifyTeam, notifyUser } from "../../lib/notify.js";
import { getWithdrawalProofFile } from "../admin-ops/service.js";
import { featuredDailyRate } from "../promotions/service.js";
import { getIntSetting } from "../settings/service.js";
import { requestSellerJoin, sellerJoinState } from "./join.js";
import { contractRequestSchema, contractState, requestContract } from "./contract.js";

const withdrawalBody = z.object({
  amount: z.number().int().positive(),
  // Retraits envoyés uniquement par Wave.
  method: z.literal("WAVE").default("WAVE"),
  phoneNumber: z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, "Numéro invalide"),
});

const METHOD_LABEL = { WAVE: "Wave" } as const;

const receiptBody = z.discriminatedUnion("received", [
  z.object({ received: z.literal(true) }),
  z.object({ received: z.literal(false), note: z.string().trim().min(5).max(500) }),
]);

// ---------------------------------------------------------------------------
// Espace vendeur — lecture seule : profil, soldes, offres. Sert la page
// /seller (mise en avant §13) ; les mutations vendeur arrivent avec P4.
// ---------------------------------------------------------------------------

export async function registerSellerRoutes(app: FastifyInstance) {
  // --- Devenir vendeur : conditions, puis paiement des frais d'adhésion ---
  app.get("/seller/join", async (request, reply) => {
    const auth = requireAuth(request);
    return sendOk(reply, await sellerJoinState(auth.user.id));
  });

  app.post("/seller/join", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = requireAuth(request);
    return sendOk(reply, await requestSellerJoin({ actorId: auth.user.id, ip: request.ip }));
  });

  // --- Contrat revendeur : forfait sans commission (6, 12 ou 18 mois) ---
  app.get("/seller/contract", async (request, reply) => {
    const auth = requireAuth(request);
    return sendOk(reply, await contractState(auth.user.id));
  });

  app.post("/seller/contract", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = contractRequestSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", "Durée de contrat invalide (6, 12 ou 18 mois).");
    return sendOk(reply, await requestContract(input.data.months, { actorId: auth.user.id, ip: request.ip }));
  });

  // --- Cette offre est-elle la mienne ? (fiche produit : pas de bouton d'achat) ---
  app.get("/seller/owns/:productId", async (request, reply) => {
    const auth = requireAuth(request);
    const { productId } = request.params as { productId: string };
    const own = await prisma.product.count({ where: { id: productId, seller: { userId: auth.user.id } } });
    return sendOk(reply, { own: own > 0 });
  });

  app.get(
    "/seller/dashboard",
    {
      schema: {
        tags: ["Seller"],
        summary: "Profil vendeur, soldes et offres (pour la mise en avant)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const seller = await prisma.seller.findUnique({
        where: { userId: auth.user.id },
        select: {
          id: true,
          status: true,
          sellerSince: true,
          registrationFee: true,
          registrationPaidAt: true,
          sellerBalance: {
            select: {
              balanceAvailable: true,
              balancePending: true,
              totalEarnings: true,
              totalCommissionPaid: true,
            },
          },
        },
      });

      const now = new Date();
      const products = seller
        ? await prisma.product.findMany({
            where: { sellerId: seller.id, deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              rejectedReason: true,
              credential: { select: { id: true } },
              basePrice: true,
              paymentMode: true,
              featuredUntil: true,
              featuredProduct: { where: { status: "PENDING", paymentId: { not: null } }, take: 1, select: { id: true, payment: { select: { status: true } } } },
            },
          })
        : [];

      // Ventes : 6 derniers mois (net vendeur) + 8 dernières lignes, hors remboursées.
      const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
      const sales = seller
        ? await prisma.commission.findMany({
            where: { sellerId: seller.id, status: { not: "REFUNDED" }, createdAt: { gte: sixMonthsAgo } },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              orderAmount: true,
              commissionAmount: true,
              netToSeller: true,
              status: true,
              createdAt: true,
              orderItem: { select: { title: true, order: { select: { orderNumber: true } } } },
            },
          })
        : [];
      const salesByMonth = Array.from({ length: 6 }, (_, k) => {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + k, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4 + k, 1));
        const inMonth = sales.filter((s) => s.createdAt >= start && s.createdAt < end);
        return {
          month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
          net: inMonth.reduce((sum, s) => sum + s.netToSeller, 0),
          count: inMonth.length,
        };
      });

      const contract = await contractState(auth.user.id);
      return sendOk(reply, {
        contract: { current: contract.current, coveredUntil: contract.coveredUntil, commissionPercent: contract.commissionPercent },
        salesByMonth,
        recentSales: sales.slice(0, 8).map((s) => ({
          id: s.id,
          title: s.orderItem.title,
          orderNumber: s.orderItem.order.orderNumber,
          orderAmount: s.orderAmount,
          commissionAmount: s.commissionAmount,
          netToSeller: s.netToSeller,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
        })),
        seller: seller
          ? {
              id: seller.id,
              status: seller.status,
              sellerSince: seller.sellerSince?.toISOString() ?? null,
              registrationFee: seller.registrationFee,
              registrationPaidAt: seller.registrationPaidAt?.toISOString() ?? null,
            }
          : null,
        balance: seller?.sellerBalance ?? null,
        products: products.map(({ featuredProduct: featured, credential, ...p }) => ({
          ...p,
          hasCredentials: credential !== null,
          featuredUntil: p.featuredUntil?.toISOString() ?? null,
          isFeatured: p.featuredUntil !== null && p.featuredUntil > now,
          // Payée (solde ou preuve Wave envoyée) : en attente de validation par l'équipe.
          featuredPending: featured[0] ? featured[0].payment?.status !== "PENDING" : false,
        })),
        dailyRate: await featuredDailyRate(),
        minWithdrawal: await getIntSetting("minWithdrawalAmount", 1000),
        withdrawals: seller
          ? (
              await prisma.withdrawal.findMany({
                where: { sellerId: seller.id },
                orderBy: { requestedAt: "desc" },
                take: 10,
                select: {
                  id: true,
                  amount: true,
                  status: true,
                  requestedAt: true,
                  processingStartedAt: true,
                  etaMinutes: true,
                  processedAt: true,
                  rejectionReason: true,
                  paymentReference: true,
                  proofKey: true,
                  sellerConfirmedAt: true,
                  sellerDisputedAt: true,
                },
              })
            ).map(({ proofKey, ...w }) => ({
              ...w,
              hasProof: Boolean(proofKey),
              requestedAt: w.requestedAt.toISOString(),
              processingStartedAt: w.processingStartedAt?.toISOString() ?? null,
              processedAt: w.processedAt?.toISOString() ?? null,
              sellerConfirmedAt: w.sellerConfirmedAt?.toISOString() ?? null,
              sellerDisputedAt: w.sellerDisputedAt?.toISOString() ?? null,
            }))
          : [],
      });
    },
  );

  app.post(
    "/seller/withdrawals",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = withdrawalBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", input.error.issues[0]?.message ?? "Demande invalide.");

      const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id }, select: { id: true, status: true } });
      if (!seller) throw forbidden("Aucun profil vendeur n’est associé à ce compte.");
      if (seller.status !== "ACTIVE") throw forbidden("Votre compte vendeur n’est pas actif.");
      const kyc = await prisma.identityVerification.findFirst({
        where: { userId: auth.user.id },
        orderBy: { submittedAt: "desc" },
        select: { status: true },
      });
      if (kyc?.status !== "VERIFIED") throw forbidden("Votre identité doit être vérifiée avant un retrait.");

      const min = await getIntSetting("minWithdrawalAmount", 1000);
      if (input.data.amount < min) throw badRequest("VALIDATION_ERROR", `Montant minimum : ${min.toLocaleString("fr-FR")} FCFA.`);

      const snapshot = encryptString(
        JSON.stringify({ method: input.data.method, phoneNumber: input.data.phoneNumber.replace(/\s+/g, "") }),
      );
      const withdrawal = await prisma.$transaction(async (tx) => {
        // Débit atomique : impossible de retirer deux fois le même argent.
        const debit = await tx.sellerBalance.updateMany({
          where: { sellerId: seller.id, balanceAvailable: { gte: input.data.amount } },
          data: { balanceAvailable: { decrement: input.data.amount } },
        });
        if (debit.count === 0) throw conflict("INSUFFICIENT_BALANCE", "Solde disponible insuffisant.");
        return tx.withdrawal.create({
          data: { sellerId: seller.id, requestedById: auth.user.id, amount: input.data.amount, bankDetailsSnapshot: snapshot },
          select: { id: true, amount: true, status: true, requestedAt: true },
        });
      });

      await logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role?.name as RoleName | undefined,
        sessionId: auth.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        action: "WITHDRAWAL_REQUESTED",
        resourceType: "Withdrawal",
        resourceId: withdrawal.id,
        metadata: { amount: withdrawal.amount, method: input.data.method },
        severity: "WARNING",
      });
      await notifyActiveAdmins("ADMIN_ALERT", {
        title: "Nouvelle demande de retrait",
        message: `${withdrawal.amount.toLocaleString("fr-FR")} FCFA à envoyer par ${METHOD_LABEL[input.data.method]}.`,
        actionUrl: "/admin/withdrawals",
        priority: "NORMAL",
      });
      await notifyUser(auth.user.id, "SELLER_PAYOUT_AVAILABLE", {
        title: "Demande de retrait envoyée",
        message: `Votre demande de ${withdrawal.amount.toLocaleString("fr-FR")} FCFA est transmise à l’équipe. Vous serez prévenu dès sa prise en charge.`,
        actionUrl: "/seller",
        priority: "NORMAL",
      });
      return sendOk(reply, { ...withdrawal, requestedAt: withdrawal.requestedAt.toISOString() });
    },
  );

  // --- Capture de l'envoi d'un retrait (vendeur concerné uniquement) ---
  app.get("/seller/withdrawals/:id/proof", async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const file = await getWithdrawalProofFile(id, auth.user.id);
    reply
      .header("Content-Type", file.mime)
      .header("Content-Length", file.size)
      .header("Content-Disposition", "inline")
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(file.buffer);
  });

  // --- Le vendeur confirme (ou conteste) la réception de son retrait ---
  app.post(
    "/seller/withdrawals/:id/receipt",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const input = receiptBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Expliquez en quelques mots ce qui ne va pas (5 caractères minimum).");

      const withdrawal = await prisma.withdrawal.findFirst({
        where: { id, seller: { userId: auth.user.id } },
        select: { id: true, amount: true, status: true, sellerDisputedAt: true },
      });
      if (!withdrawal) throw notFound("Retrait introuvable.");
      if (withdrawal.status !== "APPROVED") throw conflict("INVALID_STATE", "Ce retrait n’attend pas de confirmation.");

      const now = new Date();
      if (input.data.received) {
        const res = await prisma.withdrawal.updateMany({
          where: { id, status: "APPROVED" },
          data: { status: "COMPLETED", sellerConfirmedAt: now },
        });
        if (res.count === 0) throw conflict("INVALID_STATE", "Ce retrait n’attend pas de confirmation.");
        // Reçu confirmé : la capture de l'envoi ne sert plus, on libère la place.
        const done = await prisma.withdrawal.findUnique({ where: { id }, select: { proofKey: true } });
        if (done?.proofKey) {
          await deleteFile(done.proofKey).catch(() => undefined);
          await prisma.withdrawal.update({ where: { id }, data: { proofKey: null } });
        }
      } else {
        await prisma.withdrawal.update({ where: { id }, data: { sellerDisputedAt: now, sellerDisputeNote: input.data.note } });
        await notifyTeam("WITHDRAWALS", "ADMIN_ALERT", {
          title: "Retrait non reçu",
          message: `Un vendeur signale ne pas avoir reçu son retrait de ${withdrawal.amount.toLocaleString("fr-FR")} FCFA : « ${input.data.note} »`,
          actionUrl: "/admin/withdrawals",
          priority: "CRITICAL",
        });
      }

      await logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role?.name as RoleName | undefined,
        sessionId: auth.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        action: input.data.received ? "WITHDRAWAL_RECEIVED" : "WITHDRAWAL_NOT_RECEIVED",
        resourceType: "Withdrawal",
        resourceId: id,
        metadata: { amount: withdrawal.amount, ...(input.data.received ? {} : { note: input.data.note }) },
        severity: input.data.received ? "INFO" : "CRITICAL",
      });
      return sendOk(reply, { id, status: input.data.received ? "COMPLETED" : "APPROVED", received: input.data.received });
    },
  );
}
