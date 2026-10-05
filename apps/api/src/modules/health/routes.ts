import type { FastifyInstance } from "fastify";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../env.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.route({
    method: "GET",
    url: "/health",
    schema: {
      tags: ["Système"],
      summary: "État de santé du service (pour probes/load balancer)",
    },
    handler: async (_request, reply) => {
      let db = "down";
      try {
        await prisma.$queryRaw`SELECT 1`;
        db = "up";
      } catch (err) {
        logger.error({ err }, "health: BDD injoignable");
      }
      // email / google : réglages présents (jamais leur valeur), pour vérifier une mise en service.
      const body = {
        status: db === "up" ? "ok" : "degraded",
        uptime: process.uptime(),
        db,
        email: Boolean(env.SMTP_URL),
        google: Boolean(env.GOOGLE_OAUTH_CLIENT_ID),
      };
      const code = db === "up" ? 200 : 503;
      return sendOk(reply.status(code), body);
    },
  });

  app.route({
    method: "GET",
    url: "/healthz",
    schema: { tags: ["Système"], summary: "Liveness" },
    handler: async (_request, reply) =>
      sendOk(reply, { status: "alive" }),
  });
}