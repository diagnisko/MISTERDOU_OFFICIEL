import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RoleName } from "@misterdou/db";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { logAudit } from "../../lib/audit.js";
import { createNextInstallmentPayment, getSchedule } from "./service.js";

function authCtx(request: FastifyRequest): { actorId: string; actorRole?: RoleName; ip?: string } {
  const auth = requireAuth(request);
  return { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip };
}

function authGuard(req: FastifyRequest, _reply: unknown, done: (err?: Error) => void) {
  try {
    requireAuth(req);
    done();
  } catch (err) {
    done(err as Error);
  }
}

const paramsSchema = z.object({ id: z.string().uuid() });
// 0 mois = l'apport seul (tant qu'il n'est pas payé).
const payBody = z.object({ months: z.number().int().min(0).max(24).default(1) });

export async function registerInstallmentRoutes(app: FastifyInstance) {
  // --- Échéancier d'une commande (le client, propriétaire de la commande) ---
  app.get(
    "/orders/:id/installments",
    {
      preHandler: authGuard,
      schema: {
        tags: ["Installments"],
        summary: "Voir l'échéancier de sa commande (échéances, reste dû, prochaine échéance)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { actorId } = authCtx(request);
      const { id } = paramsSchema.parse(request.params);
      const schedule = await getSchedule(id);
      // getSchedule ne filtre pas par propriétaire : null = pas de plan, donc
      // 404 indistinguable d'une commande qui n'est pas la sienne.
      if (!schedule) {
        return sendOk(reply, { orderId: id, schedule: null });
      }
      // Contrôle d'appartenance : une commande d'autrui ne doit pas révéler
      // un échéancier (montants, dates) à un tiers.
      const order = await prisma.order.findUnique({
        where: { id },
        select: { buyerId: true },
      });
      if (!order || order.buyerId !== actorId) {
        return sendOk(reply, { orderId: id, schedule: null });
      }
      return sendOk(reply, { orderId: id, schedule });
    },
  );

  // --- Régler la prochaine mensualité : crée le paiement cible du checkout ---
  app.post(
    "/orders/:id/installments/pay",
    {
      preHandler: authGuard,
      schema: {
        tags: ["Installments"],
        summary: "Régler une ou plusieurs mensualités d'avance (retourne le token de paiement)",
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const ctx = authCtx(request);
      const { id } = paramsSchema.parse(request.params);
      const { months } = payBody.parse(request.body ?? {});
      const next = await createNextInstallmentPayment(id, ctx, months);
      await logAudit({
        actorId: ctx.actorId,
        actorRole: ctx.actorRole,
        ip: ctx.ip,
        action: "INSTALLMENT_PAY_REQUESTED",
        resourceType: "Order",
        resourceId: id,
        metadata: { orderNumber: next.orderNumber, amount: next.amount, already: next.already },
      });
      return sendOk(reply, {
        orderId: next.orderId,
        orderNumber: next.orderNumber,
        amount: next.amount,
        alreadyPending: next.already,
        checkoutToken: next.token,
        checkoutUrl: `/checkout/${next.token}`,
      });
    },
  );
}

