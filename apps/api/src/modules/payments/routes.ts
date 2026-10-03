import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission } from "../../lib/auth-context.js";
import { badRequest } from "../../lib/errors.js";
import { getCheckoutState, listMyPayments, type PaymentContext } from "./service.js";
import {
  approvePaymentProof,
  getPaymentProofFile,
  listPaymentProofs,
  paymentProofSchema,
  proofListQuery,
  rejectPaymentProof,
  submitPaymentProof,
} from "./proofs.js";

function ctx(request: FastifyRequest): PaymentContext {
  const auth = requireAuth(request);
  return {
    actorId: auth.user.id,
    actorRole: auth.user.role?.name ?? undefined,
    ip: request.ip,
  };
}

const proofRejectSchema = z.object({ reason: z.string().trim().min(5).max(300) });

// ---------------------------------------------------------------------------
// Paiements : uniquement par lien Wave Business. Le client paie le montant
// écrit dans le lien, envoie sa preuve, et l'équipe valide (voir proofs.ts).
// ---------------------------------------------------------------------------

export async function registerPaymentRoutes(app: FastifyInstance) {
  // --- Historique de mes paiements (connecté) ---
  app.get(
    "/payments",
    { schema: { tags: ["Payments"], summary: "Historique de mes paiements", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      return sendOk(reply, { items: await listMyPayments(auth.user.id) });
    },
  );

  // --- État d'un paiement — le token fait office de capacité ---
  app.get(
    "/payments/:token",
    {
      schema: { tags: ["Payments"], summary: "État d'un paiement (montant, lien Wave, preuve envoyée)" },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      return sendOk(reply, await getCheckoutState(token));
    },
  );

  // --- Paiement par lien Wave : le client envoie sa preuve (capture + numéro) ---
  app.post(
    "/payments/:token/proof",
    {
      schema: { tags: ["Payments"], summary: "Envoyer la preuve d'un paiement Wave (vérifiée par l'équipe)", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const parsed = paymentProofSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Preuve de paiement invalide.");
      const c = ctx(request);
      return sendOk(reply, await submitPaymentProof(token, parsed.data, { ...c, actorId: c.actorId! }));
    },
  );

  // --- Équipe : preuves Wave à vérifier (admin ou manager PAYMENTS) ---
  app.get(
    "/admin/payment-proofs",
    { schema: { tags: ["Payments"], summary: "Preuves de paiement Wave (à vérifier, validées, refusées)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "PAYMENTS");
      const { status } = proofListQuery.parse(request.query);
      return sendOk(reply, await listPaymentProofs(status));
    },
  );

  app.get(
    "/admin/payment-proofs/:id/file",
    { schema: { tags: ["Payments"], summary: "Capture d'une preuve de paiement", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "PAYMENTS");
      const { id } = request.params as { id: string };
      const file = await getPaymentProofFile(id);
      reply
        .header("Content-Type", file.mime)
        .header("Content-Length", file.size)
        .header("Content-Disposition", "inline")
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff");
      return reply.send(file.buffer);
    },
  );

  app.post(
    "/admin/payment-proofs/:id/approve",
    { schema: { tags: ["Payments"], summary: "Valider un paiement Wave (livre la commande)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "PAYMENTS");
      const { id } = request.params as { id: string };
      const c = ctx(request);
      return sendOk(reply, await approvePaymentProof(id, { ...c, actorId: c.actorId! }));
    },
  );

  app.post(
    "/admin/payment-proofs/:id/reject",
    { schema: { tags: ["Payments"], summary: "Refuser une preuve de paiement Wave (motif transmis au client)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "PAYMENTS");
      const { id } = request.params as { id: string };
      const parsed = proofRejectSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Motif du refus : 5 caractères minimum.");
      const c = ctx(request);
      return sendOk(reply, await rejectPaymentProof(id, parsed.data.reason, { ...c, actorId: c.actorId! }));
    },
  );
}
