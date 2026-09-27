import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { logAudit } from "../../lib/audit.js";
import { env } from "../../env.js";
import {
  CHECKOUT_METHODS,
  isAllowedWebhookIp,
  verifyWebhookSignature,
  verifyWebhookTimestamp,
} from "./paytech.js";
import {
  getCheckoutState,
  initiateCheckout,
  listMyPayments,
  settlePayment,
  type PaymentContext,
} from "./service.js";

function ctx(request: FastifyRequest): PaymentContext {
  const auth = requireAuth(request);
  return {
    actorId: auth.user.id,
    actorRole: auth.user.role?.name ?? undefined,
    ip: request.ip,
  };
}

const checkoutSchema = z.object({
  method: z.enum(CHECKOUT_METHODS as [string, ...string[]]),
});

const webhookSchema = z.object({
  reference: z.string().trim().min(3).max(120),
  amount: z.number().int().nonnegative(),
  status: z.enum(["SUCCESS", "FAILED", "CANCELLED"]),
  failure_reason: z.string().trim().max(500).optional(),
});

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export async function registerPaymentRoutes(app: FastifyInstance) {
  // PAYTECH_WEBHOOK_PATH est un chemin PUBLIC complet (ex. /api/v1/webhooks/paytech) ;
  // ici on est déjà sous le préfixe /api/v1 → on retire le préfixe éventuel.
  const webhookPath = env.PAYTECH_WEBHOOK_PATH.replace(/^\/api\/v1(?=\/|$)/, "") || "/webhooks/paytech";

  // --- Historique de mes paiements (connecté) ---
  app.get(
    "/payments",
    { schema: { tags: ["Payments"], summary: "Historique de mes paiements", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      return sendOk(reply, { items: await listMyPayments(auth.user.id) });
    },
  );

  // --- État du checkout (poll) — le token fait office de capacité ---
  app.get(
    "/payments/:token",
    {
      schema: { tags: ["Payments"], summary: "État d'un paiement (checkout / vérification serveur)" },
      // Route PUBLIQUE qui peut déclencher settlePayment (écriture monétaire) :
      // on borne fortement les interrogations par token.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      return sendOk(reply, await getCheckoutState(token));
    },
  );

  // --- Initier le checkout (Wave / Orange Money) ---
  app.post(
    "/payments/:token/checkout",
    {
      schema: { tags: ["Payments"], summary: "Initier le paiement (Wave / Orange Money)", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const parsed = checkoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Canal de paiement invalide (wave ou orange_money)" },
        });
      }
      const result = await initiateCheckout(token, parsed.data.method as "wave" | "orange_money", ctx(request));
      return sendOk(reply, result);
    },
  );

  // --- Webhook fournisseur (public, hors CSRF — signature HMAC obligatoire) ---
  app.post(
    webhookPath,
    {
      schema: { tags: ["Payments"], summary: "Webhook fournisseur (HMAC-SHA256)" },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const raw = (request as RawBodyRequest).rawBody;
      if (typeof raw !== "string" || raw.length === 0) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "Corps vide" } });
      }
      if (!env.PAYTECH_WEBHOOK_SECRET) {
        return reply.status(503).send({ ok: false, error: { code: "INTERNAL_ERROR", message: "Webhook non configuré" } });
      }

      const signature = request.headers["x-paytech-signature"];
      const timestamp = request.headers["x-paytech-timestamp"];
      if (!verifyWebhookSignature(raw, typeof signature === "string" ? signature : undefined)) {
        await logAudit({
          action: "WEBHOOK_REJECTED",
          resourceType: "Payment",
          ip: request.ip,
          metadata: { reason: "signature" },
          severity: "CRITICAL",
        });
        return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Signature invalide" } });
      }
      if (!verifyWebhookTimestamp(typeof timestamp === "string" ? timestamp : undefined)) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "Horodatage hors fenêtre" } });
      }
      if (!isAllowedWebhookIp(request.ip)) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "IP non autorisée" } });
      }

      const parsed = webhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "Payload webhook invalide" } });
      }
      const payload = parsed.data;

      const found =
        (await prisma.payment.findUnique({ where: { providerReference: payload.reference } })) ??
        (await prisma.payment.findUnique({ where: { paymentNumber: payload.reference } }));
      if (!found) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Référence inconnue" } });
      }

      // Jamais d'ACK succès sur un montant divergent (docs/06 §1.3.4).
      if (payload.amount !== found.amount) {
        await logAudit({
          action: "WEBHOOK_AMOUNT_MISMATCH",
          resourceType: "Payment",
          resourceId: found.id,
          ip: request.ip,
          metadata: { expected: found.amount, received: payload.amount, reference: payload.reference },
          severity: "CRITICAL",
        });
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "Montant divergent" } });
      }

      const result = await settlePayment({ id: found.id }, payload.status, {
        source: "WEBHOOK",
        providerReference: found.providerReference ?? payload.reference,
        failureReason: payload.failure_reason ?? null,
        ctx: { ip: request.ip },
      });
      // 200 dans tous les cas (idempotent) : le fournisseur ne doit pas rejouer.
      return sendOk(reply, { received: true, idempotent: result.already, status: result.status });
    },
  );

}
