import type { FastifyInstance } from "fastify";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { featuredDailyRate } from "../promotions/service.js";

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
      });
    },
  );
}
