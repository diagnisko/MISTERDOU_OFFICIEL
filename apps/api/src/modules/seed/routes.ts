import type { FastifyInstance } from "fastify";
import { prisma } from "@misterdou/db";
import { sendPublicOk, PUBLIC_CACHE_CONTROL } from "../../lib/envelope.js";
import { getPublicMeta } from "../settings/service.js";
import { promoRelationSelect, resolvePrice } from "../../lib/pricing.js";
import { publicUrl } from "../../lib/media.js";

// ---------------------------------------------------------------------------
// GET /api/seed — une seule requête publique pour alimenter la landing.
// Toutes les valeurs sont lues en base, jamais codées en dur côté serveur.
// Cache court (30 s) : le front rafraîchit en tâche de fond.
// ---------------------------------------------------------------------------

const NOT_SOLD: Array<"CANCELLED" | "REFUNDED"> = ["CANCELLED", "REFUNDED"];

// Projection des produits disponibles sur l'accueil.
const HOME_SELECT = {
  id: true,
  slug: true,
  title: true,
  division: true,
  teamPower: true,
  coins: true,
  basePrice: true,
  featuredPriceOverride: true,
  paymentMode: true,
  installmentMonths: true,
  installmentDownPayment: true,
} as const;

interface PlanSample {
  total: number;
  months: number;
  apport: number;
  monthly: number;
}

// Plan indicatif (utilisé uniquement pour l'exemple "Payez en plusieurs fois") :
// mensualités arrondies à la centaine, apport = reste (cohérent avec Settings.maxInstallments).
function installmentPlan(total: number, maxMonths: number): PlanSample {
  const n = Math.max(2, Math.min(maxMonths, Math.max(2, Math.floor(total / 100))));
  let monthly = Math.floor(total / n / 100) * 100;
  if (monthly < 100) monthly = 100;
  if (monthly * (n - 1) >= total) {
    monthly = Math.max(100, Math.floor((total - 100) / (n - 1) / 100) * 100);
  }
  const apport = total - monthly * (n - 1);
  return { total, months: n, apport: apport > 0 ? apport : 100, monthly };
}

export async function registerSeedRoutes(app: FastifyInstance) {
  app.route({
    method: "GET",
    url: "/seed",
    schema: {
      tags: ["Public"],
      summary: "Données d'initialisation de la landing (stats, vedettes, tarifs, promo)",
    },
    handler: async (request, reply) => {
      const now = new Date();
      const [inStock, soldAgg, ratingAgg, pricing, products, activePromo] =
        await Promise.all([
          prisma.product.count({ where: { status: "ACTIVE", deletedAt: null } }),
          prisma.orderItem.aggregate({
            _sum: { quantity: true },
            where: { order: { status: { notIn: NOT_SOLD } } },
          }),
          prisma.productReview.aggregate({ _avg: { rating: true } }),
          getPublicMeta(),
          prisma.product.findMany({
            where: { status: "ACTIVE", deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 6,
            select: {
              ...HOME_SELECT,
              featuredUntil: true,
              ...promoRelationSelect(now),
              images: {
                where: { mimeType: { startsWith: "image/" } },
                orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
                take: 1,
                select: { objectKey: true },
              },
            },
          }),
          // Bannière promo de la landing : la promotion en cours qui se termine
          // le plus tôt (compte à rebours côté client, invalide à expiration).
          prisma.promotion.findFirst({
            where: {
              status: "ACTIVE",
              startsAt: { lte: now },
              endsAt: { gt: now },
              product: { status: "ACTIVE", deletedAt: null },
            },
            orderBy: { endsAt: "asc" },
            select: { endsAt: true, product: { select: { title: true, slug: true } } },
          }),
        ]);

      const toItem = (p: {
        id: string;
        slug: string;
        title: string;
        division: string;
        teamPower: number;
        coins: number;
        basePrice: number;
        featuredPriceOverride: number | null;
        paymentMode: "ONE_TIME" | "INSTALLMENTS";
        installmentMonths: number | null;
        installmentDownPayment: number | null;
        promotions: ReadonlyArray<{ id: string; promoPrice: number | null; discountPercent: number | null }>;
        images: ReadonlyArray<{ objectKey: string }>;
      }) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        division: p.division,
        teamPower: p.teamPower,
        coins: p.coins,
        basePrice: p.basePrice,
        promoPrice: resolvePrice(p).promoPrice,
        paymentMode: p.paymentMode,
        installmentMonths: p.installmentMonths,
        installmentDownPayment: p.installmentDownPayment,
        canSplit: p.installmentMonths !== null,
        coverUrl: p.images[0] ? publicUrl(p.images[0].objectKey) : null,
      });

      const home = products.map(toItem);

      const first = home[0];
      const effectiveTotal = first?.promoPrice ?? first?.basePrice ?? 0;
      const sample = effectiveTotal > 0 ? installmentPlan(effectiveTotal, pricing.maxInstallments) : null;

      const data = {
        stats: {
          productsInStock: inStock,
          productsSold: soldAgg._sum.quantity ?? 0,
          avgRating: ratingAgg._avg.rating !== null ? Math.round(ratingAgg._avg.rating * 10) / 10 : 0,
        },
        home,
        featured: home,
        pricing: {
          currency: pricing.currency,
          maxInstallments: pricing.maxInstallments,
          sample,
        },
        promo: activePromo
          ? {
              title: activePromo.product.title,
              endsAt: activePromo.endsAt.toISOString(),
              productSlug: activePromo.product.slug,
            }
          : null,
      };

      // Cache navigateur/CDN 60 s + revalidation différée, ETag fort.
      // Le hook global remet `no-store` si la requête porte une session.
      reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
      return sendPublicOk(request, reply, data);
    },
  });
}