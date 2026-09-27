import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RoleName } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import {
  createOrder,
  createOrderSchema,
  getMyOrder,
  listMyOrders,
  revealCredentials,
} from "./service.js";

function authCtx(request: FastifyRequest): { actorId: string; actorRole?: RoleName; ip?: string } {
  const auth = requireAuth(request);
  return {
    actorId: auth.user.id,
    actorRole: auth.user.role?.name,
    ip: request.ip,
  };
}

export async function registerOrderRoutes(app: FastifyInstance) {
  // --- Créer une commande (montant TOUJOURS recalculé serveur) ---
  app.post(
    "/orders",
    {
      schema: {
        tags: ["Orders"],
        summary: "Créer une commande (achat d'un compte) — KYC vérifié, montant serveur",
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const parsed = createOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Paramètres de commande invalides" },
        });
      }
      const result = await createOrder(parsed.data, { actorId: auth.user.id });
      return sendOk(reply, result);
    },
  );

  // --- Historique des commandes du client (§15) ---
  app.get(
    "/orders/mine",
    { schema: { tags: ["Orders"], summary: "Mes commandes (jamais de credentials)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      return sendOk(reply, await listMyOrders(auth.user.id));
    },
  );

  // --- Détail d'une commande (propriétaire) ---
  app.get(
    "/orders/:id",
    { schema: { tags: ["Orders"], summary: "Détail d'une commande (propriétaire)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const order = await getMyOrder(id, auth.user.id);
      return sendOk(reply, order);
    },
  );

  // --- Révélation des credentials (après livraison, propriétaire, tracée) ---
  app.get(
    "/orders/:id/reveal",
    {
      schema: {
        tags: ["Orders"],
        summary: "Révéler les identifiants d'une commande livrée (propriétaire, tracé)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const ctx = authCtx(request);
      const { id } = request.params as { id: string };
      const result = await revealCredentials(id, ctx);
      return sendOk(reply, result);
    },
  );

}
