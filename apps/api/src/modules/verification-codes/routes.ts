import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import {
  listCodeRequests,
  provideCodeSchema,
  provideVerificationCode,
  requestVerificationCode,
  resolveProviderScope,
  type CodeActor,
} from "./service.js";

const TAG = "Verification codes";
const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({ status: z.enum(["PENDING", "ALL"]).default("PENDING") });

function actorOf(request: FastifyRequest): CodeActor {
  const auth = requireAuth(request);
  return { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip };
}

export async function registerVerificationCodeRoutes(app: FastifyInstance) {
  // --- Client : demander (ou redemander après expiration) un code ---
  app.post(
    "/orders/:id/verification-code",
    {
      schema: { tags: [TAG], summary: "Demander un code de vérification pour un compte acheté", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      return sendOk(reply, await requestVerificationCode(id, actorOf(request)));
    },
  );

  // --- Équipe ou vendeur : file des demandes ---
  app.get(
    "/verification-codes",
    { schema: { tags: [TAG], summary: "Demandes de code (équipe : toutes ; vendeur : ses comptes)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const scope = await resolveProviderScope(requireAuth(request));
      const { status } = listQuery.parse(request.query);
      return sendOk(reply, { scope: scope.kind, items: await listCodeRequests(scope, status) });
    },
  );

  // --- Équipe ou vendeur : fournir le code ---
  app.post(
    "/verification-codes/:id/provide",
    {
      schema: { tags: [TAG], summary: "Fournir le code d'une demande en attente", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { code } = provideCodeSchema.parse(request.body);
      const scope = await resolveProviderScope(requireAuth(request));
      return sendOk(reply, await provideVerificationCode(id, code, scope, actorOf(request)));
    },
  );
}
