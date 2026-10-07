import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, type AuthContext } from "../../lib/auth-context.js";
import { forbidden } from "../../lib/errors.js";
import { vapidKeys } from "../../lib/push.js";

// ---------------------------------------------------------------------------
// Notifications sur le téléphone de l'équipe (centre de notifications).
// GET  /push/key        clé publique pour l'abonnement du navigateur
// POST /push/subscribe  enregistre cet appareil   DELETE : l'oublie
// ---------------------------------------------------------------------------

const TAG = "Notifications";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

const endpointSchema = z.object({ endpoint: z.string().url().max(1000) });

/** Réservé à l'équipe (les alertes ne concernent qu'elle pour l'instant). */
function requireTeam(auth: AuthContext): void {
  const role = auth.user.role?.name;
  if (role !== "ADMIN" && role !== "STAFF") throw forbidden("Réservé à l'équipe.");
}

export async function registerPushRoutes(app: FastifyInstance) {
  const rate = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

  app.get("/push/key", { schema: { tags: [TAG], summary: "Clé publique des notifications" } }, async (_request, reply) =>
    sendOk(reply, { publicKey: vapidKeys().publicKey }),
  );

  app.post(
    "/push/subscribe",
    { schema: { tags: [TAG], summary: "Recevoir les notifications sur cet appareil", security: [{ bearerAuth: [] }] }, config: rate(10) },
    async (request, reply) => {
      const auth = requireAuth(request);
      requireTeam(auth);
      const input = subscriptionSchema.parse(request.body);
      const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 300) || null;
      // Un même appareil peut changer de compte : l'abonnement suit le compte connecté.
      await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { userId: auth.user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent },
        update: { userId: auth.user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent },
      });
      const devices = await prisma.pushSubscription.count({ where: { userId: auth.user.id } });
      return sendOk(reply, { subscribed: true, devices });
    },
  );

  app.delete(
    "/push/subscribe",
    { schema: { tags: [TAG], summary: "Ne plus recevoir les notifications sur cet appareil", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { endpoint } = endpointSchema.parse(request.body);
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: auth.user.id } });
      return sendOk(reply, { subscribed: false });
    },
  );
}
