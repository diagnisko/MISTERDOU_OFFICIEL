import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { badRequest, conflict, forbidden } from "../../lib/errors.js";
import { encryptString } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { notifyActiveAdmins, notifyUser } from "../../lib/notify.js";
import { featuredDailyRate } from "../promotions/service.js";
import { getIntSetting } from "../settings/service.js";

const withdrawalBody = z.object({
  amount: z.number().int().positive(),
  method: z.enum(["WAVE", "ORANGE_MONEY"]),
  phoneNumber: z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, "Numéro invalide"),
});

const METHOD_LABEL = { WAVE: "Wave", ORANGE_MONEY: "Orange Money" } as const;

// ---------------------------------------------------------------------------
// Espace vendeur — lecture seule : profil, soldes, offres. Sert la page
// /seller (mise en avant §13) ; les mutations vendeur arrivent avec P4.
// ---------------------------------------------------------------------------

export async function registerSellerRoutes(app: FastifyInstance) {
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
              basePrice: true,
              paymentMode: true,
              featuredUntil: true,
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

      return sendOk(reply, {
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
        products: products.map((p) => ({
          ...p,
          featuredUntil: p.featuredUntil?.toISOString() ?? null,
          isFeatured: p.featuredUntil !== null && p.featuredUntil > now,
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
                },
              })
            ).map((w) => ({
              ...w,
              requestedAt: w.requestedAt.toISOString(),
              processingStartedAt: w.processingStartedAt?.toISOString() ?? null,
              processedAt: w.processedAt?.toISOString() ?? null,
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
}
