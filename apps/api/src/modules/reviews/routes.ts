import type { FastifyInstance } from "fastify";
import type { RoleName } from "@misterdou/db";
import { sendOk, sendPublicOk, PUBLIC_CACHE_CONTROL } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { badRequest } from "../../lib/errors.js";
import { PLATFORM_PROFILE_ID, platformPublicProfile, reviewSchema, sellerPublicProfile, submitReview } from "./service.js";

export async function registerReviewRoutes(app: FastifyInstance) {
  // --- L'acheteur note sa commande après « Reçu » (une seule fois) ---
  app.post(
    "/orders/:id/review",
    {
      schema: { tags: ["Orders"], summary: "Noter une commande reçue (1 à 5, commentaire facultatif)", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const input = reviewSchema.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", input.error.issues[0]?.message ?? "Avis invalide.");
      return sendOk(
        reply,
        await submitReview(id, input.data, { actorId: auth.user.id, actorRole: auth.user.role?.name as RoleName | undefined, ip: request.ip }),
      );
    },
  );

  // --- Profil public d'un vendeur (réputation, avis ; jamais son identité) ---
  app.get(
    "/sellers/:id/profile",
    { schema: { tags: ["Public"], summary: "Profil public d'un vendeur (ou « misterdou ») : note, ventes, avis, comptes vendus" } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      // « misterdou » : la boutique officielle (offres sans vendeur).
      if (id !== PLATFORM_PROFILE_ID && !/^[0-9a-f-]{36}$/i.test(id)) throw badRequest("VALIDATION_ERROR", "Vendeur introuvable.");
      reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
      return sendPublicOk(request, reply, id === PLATFORM_PROFILE_ID ? await platformPublicProfile() : await sellerPublicProfile(id));
    },
  );
}
