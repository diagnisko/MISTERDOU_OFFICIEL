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

      return sendOk(reply, {
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
