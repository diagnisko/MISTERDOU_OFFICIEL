import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE_NAME } from "@misterdou/shared";
import { env } from "../env.js";
import { ApiError } from "../lib/errors.js";

// Regroupe les protections serveur : helmet, cors, rate-limit, cookies.
export async function registerSecurityPlugin(app: FastifyInstance) {
  await app.register(import("@fastify/helmet"), {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  await app.register(import("@fastify/cors"), {
    origin: (origin, cb) => {
      // Origine absente (mobile/natif) → autorisée
      if (!origin) return cb(null, true);
      if (env.WEB_ORIGIN.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token", "x-request-id"],
  });

  await app.register(import("@fastify/cookie"), {
    secret: env.COOKIE_SECRET,
  });

  // Rate-limit global (progressif en prod) ; borné précisément sur les routes auth.
  await app.register(import("@fastify/rate-limit"), {
    global: true,
    max: env.NODE_ENV === "production" ? 250 : 1000,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      // Derrière proxy : on s'appuie sur X-Forwarded-For SEULEMENT en prod (typeForwarder configuré)
      const forwarded = request.headers["x-forwarded-for"];
      const ip =
        env.NODE_ENV === "production" && typeof forwarded === "string"
          ? forwarded.split(",")[0]?.trim()
          : request.ip;
      return ip ?? "unknown";
    },
    errorResponseBuilder: (_req, ctx) =>
      new ApiError(
        "RATE_LIMITED",
        429,
        "Trop de requêtes. Réessayez bientôt.",
        ctx.after ? { retryAfter: ctx.after } : undefined,
      ),
  });

  // Caching : aucune réutilisation de réponse par défaut (données comptables,
  // session par cookie). Seules les routes PUBLIQUES posent eux-mêmes une
  // politique `Cache-Control: public …` (lib/envelope.ts → sendPublicOk) :
  // ces en-têtes sont alors conservés. Dès qu'une session est présente
  // (cookie md_sid ou Authorization), la réponse reste `no-store` — jamais de
  // cache partagé (CDN/proxy) pour un utilisateur connecté.
  app.addHook("onSend", async (request, reply) => {
    const current = reply.getHeader("Cache-Control");
    const explicitlyPublic = typeof current === "string" && /(^|,)\s*public\s*(,|$)/.test(current);
    const hasSession = Boolean(request.headers.authorization) || Boolean(request.cookies?.[SESSION_COOKIE_NAME]);
    if (!explicitlyPublic || hasSession) {
      reply.header("Cache-Control", "no-store");
    }
  });
}