import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { requirePermission, requireAuth } from "../../lib/auth-context.js";
import {
  FEATURED_MAX_DAYS,
  adminFeature,
  cancelPromotion,
  createPromotion,
  featuredDailyRate,
  listFeaturedPurchases,
  listPromotions,
  requestFeatured,
} from "./service.js";

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
});

const createPromotionBody = z
  .object({
    productId: z.string().uuid(),
    title: z.string().trim().min(3).max(120).optional(),
    promoPrice: z.coerce.number().int().min(1).optional(),
    discountPercent: z.coerce.number().int().min(1).max(99).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((b) => b.promoPrice != null || b.discountPercent != null, {
    message: "Indiquez un prix promo ou un pourcentage de remise.",
  });

const featuredBody = z.object({
  days: z.coerce.number().int().min(1).max(FEATURED_MAX_DAYS),
  // R10 : solde d'abord (AUTO), Wave en secours ; BALANCE = strict.
  paymentMethod: z.enum(["AUTO", "BALANCE", "WAVE"]).default("AUTO"),
});

// ---------------------------------------------------------------------------
// Promotions (prix à fenêtre de dates) + mises en avant (visibilité payante).
// ---------------------------------------------------------------------------

export async function registerPromotionRoutes(app: FastifyInstance) {
  // --- Historique des mises en avant (admin) ---
  app.get(
    "/admin/featured",
    { schema: { tags: ["Admin"], summary: "Historique des mises en avant", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "PRODUCTS");
      const { page, perPage } = pageQuery.parse(request.query);
      const { items, total } = await listFeaturedPurchases({ page, perPage });
      return sendOk(reply, items, { page, perPage, total });
    },
  );

  // --- Mise en avant offerte (admin, sans paiement) ---
  app.post(
    "/admin/products/:id/featured",
    { schema: { tags: ["Admin"], summary: "Activer gratuitement la mise en avant d'une offre", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = await requirePermission(request, "PRODUCTS");
      const { id } = request.params as { id: string };
      const parsed = featuredBody.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", `Durée invalide (1 à ${FEATURED_MAX_DAYS} jours).`);
      const result = await adminFeature(id, parsed.data.days, { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip });
      return sendOk(reply, result);
    },
  );

  // --- Liste des promotions (admin) ---
  app.get(
    "/admin/promotions",
    { schema: { tags: ["Admin"], summary: "Liste des promotions (paginée)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "PRODUCTS");
      const { page, perPage, q } = pageQuery.parse(request.query);
      const { items, total } = await listPromotions({ page, perPage, q });
      return sendOk(reply, items, { page, perPage, total });
    },
  );

  // --- Création d'une promotion (admin) ---
  app.post(
    "/admin/promotions",
    { schema: { tags: ["Admin"], summary: "Créer une promotion à fenêtre de dates", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = await requirePermission(request, "PRODUCTS");
      const parsed = createPromotionBody.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Champs de promotion invalides (prix, début, fin).");
      const result = await createPromotion(parsed.data, { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip });
      return reply.status(201).send({ ok: true, data: result });
    },
  );

  // --- Annulation d'une promotion (admin) ---
  app.post(
    "/admin/promotions/:id/cancel",
    { schema: { tags: ["Admin"], summary: "Annuler une promotion", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = await requirePermission(request, "PRODUCTS");
      const { id } = request.params as { id: string };
      const result = await cancelPromotion(id, { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip });
      return sendOk(reply, result);
    },
  );

  // --- Éligibilité (connecté) : prix du jour + état de mon offre ---
  app.get(
    "/products/:id/featured",
    { schema: { tags: ["Products"], summary: "Conditions de mise en avant d'une offre", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const product = await prisma.product.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, featuredUntil: true, status: true, seller: { select: { userId: true } } },
      });
      if (!product) throw notFound("Offre introuvable.");
      const isOwner = auth.user.role?.name === "ADMIN" || product.seller?.userId === auth.user.id;
      return sendOk(reply, {
        dailyRate: await featuredDailyRate(),
        maxDays: FEATURED_MAX_DAYS,
        featuredUntil: product.featuredUntil?.toISOString() ?? null,
        isOwner,
      });
    },
  );

  // --- Demande de mise en avant payante (connecté, propriétaire) ---
  app.post(
    "/products/:id/featured",
    { schema: { tags: ["Products"], summary: "Mettre en avant une offre (paiement)", security: [{ bearerAuth: [] }] }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const parsed = featuredBody.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", `Durée invalide (1 à ${FEATURED_MAX_DAYS} jours).`);
      const result = await requestFeatured(id, parsed.data.days, {
        actorId: auth.user.id,
        actorRole: auth.user.role?.name,
        ip: request.ip,
      }, { paymentMethod: parsed.data.paymentMethod });
      return reply.status(201).send({
        ok: true,
        data: {
          ...result,
          checkoutUrl: result.token ? `/checkout/${result.token}` : null,
        },
      });
    },
  );
}
