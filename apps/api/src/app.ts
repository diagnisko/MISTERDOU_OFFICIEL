import Fastify, { type FastifyInstance } from "fastify";
import { constants as zlibConstants } from "node:zlib";
import { registerSecurityPlugin } from "./plugins/security.js";
import { attachRequestHooks } from "./plugins/hooks.js";
import { registerErrorHandler } from "./lib/error-handler.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";
import { registerSeedRoutes } from "./modules/seed/routes.js";
import { registerCatalogueRoutes } from "./modules/catalogue/routes.js";
import { registerPaymentRoutes } from "./modules/payments/routes.js";
import { registerReviewRoutes } from "./modules/reviews/routes.js";
import { registerOrderRoutes } from "./modules/orders/routes.js";
import { registerInstallmentRoutes } from "./modules/installments/routes.js";
import { registerIdentityVerificationRoutes } from "./modules/identity-verification/routes.js";
import { registerAdminConsoleRoutes } from "./modules/admin-console/routes.js";
import { registerAdminOpsRoutes } from "./modules/admin-ops/routes.js";
import { registerPromotionRoutes } from "./modules/promotions/routes.js";
import { registerSellerRoutes } from "./modules/seller/routes.js";
import { registerOfferRoutes } from "./modules/offers/routes.js";
import { registerSupportRoutes } from "./modules/support/routes.js";
import { registerMessagingRoutes } from "./modules/messaging/routes.js";
import { registerNotificationRoutes } from "./modules/notifications/routes.js";
import { registerMediaRoutes } from "./modules/media/routes.js";
import { registerAccountRoutes } from "./modules/account/routes.js";
import { registerVerificationCodeRoutes } from "./modules/verification-codes/routes.js";
import { registerProductChatRoutes } from "./modules/product-chat/routes.js";
import { env } from "./env.js";
import { isDev, REDACT_PATHS } from "./lib/logger.js";

export interface BuildAppOptions {
  logger?: boolean;
}

const API_PREFIX = "/api/v1";

export async function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    // Config logger en LITTÉRAL (typage contextuel) : éviter que le factory Fastify ne
    // se perde dans l'inférence pino (generics Logger<never> vs Logger<string>).
    // On ressort toujours une FastifyInstance classique (serveur http1).
    logger:
      opts.logger === false
        ? false
        : {
            level: env.NODE_ENV === "production" ? "info" : "debug",
            redact: { paths: REDACT_PATHS as unknown as string[], censor: "[REDACTED]" },
            transport: isDev
              ? {
                  target: "pino-pretty",
                  options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
                }
              : undefined,
          },
    trustProxy: env.NODE_ENV === "production", // X-Forwarded-For accepté en prod uniquement
    bodyLimit: 2 * 1024 * 1024, // 2 Mo (captures écran envoyées hors API en phases 2/3)
    maxParamLength: 512, // tickets d'accès fichiers signés (longs) dans les segments de route
  });

  // Corps JSON : un corps vide est accepté (undefined) et une erreur de parsing
  // ne recopie jamais le corps reçu.
  app.addContentTypeParser<string>(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const raw = typeof body === "string" ? body : String(body);
      if (raw.trim().length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch {
        // Erreur neutralisée : on ne recopie JAMAIS le message brut du parser
        // (il reflète un fragment du corps envoyé). statusCode 400 + code Fastify
        // → le handler global répond 400 VALIDATION_ERROR, pas un 500.
        const parseError = Object.assign(new Error("JSON invalide"), {
          statusCode: 400,
          code: "FST_ERR_CTP_INVALID_JSON",
        });
        done(parseError, undefined);
      }
    },
  );

  // Protections serveur : helmet, cors, rate-limit, cookies
  await registerSecurityPlugin(app);

  // Compression des réponses (JSON ~5× plus léger) : enregistrée AVANT les
  // routes pour couvrir tout le routeur. Seuil bas (512 o) pour ne pas payer
  // du gzip sur des corps déjà minuscules ; niveau zlib 6 = compromis
  // cpu/rapport. Les petits corps compressés restent lisibles via `curl --compressed`.
  await app.register(import("@fastify/compress"), {
    global: true,
    encodings: ["br", "gzip", "deflate"],
    threshold: 512,
    zlibOptions: { level: 6 },
    brotliOptions: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } },
  });

  // Extension de requête (auth + CSRF)
  await attachRequestHooks(app);

  // Enveloppe d'erreur UNIFORME — enregistrée AVANT les routes :
  // Fastify fige le errorHandler des scopes encapsulés au moment de l'enregistrement.
  await registerErrorHandler(app);

  // Swagger / OpenAPI — A05 : le plan d'API n'est exposé qu'en dev/test, ou
  // explicitement en prod via SWAGGER_ENABLED=true (défaut sûr : fermé en prod).
  const swaggerEnabled = env.SWAGGER_ENABLED
    ? env.SWAGGER_ENABLED === "true"
    : env.NODE_ENV !== "production";
  if (swaggerEnabled) {
    await app.register(import("@fastify/swagger"), {
      openapi: {
        info: {
          title: "MISTERDOU API",
          description: "API sécurisée v1 — plateforme eFootball (docs/02, docs/05, docs/06)",
          version: "0.1.0",
        },
        servers: [{ url: env.API_PUBLIC_URL }],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", description: "Session sid (cookie ou bearer)" },
          },
        },
      },
    });
    await app.register(import("@fastify/swagger-ui"), {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list" },
    });
  }

  // Routeur API
  await app.register(
    async (api) => {
      await registerHealthRoutes(api);
      await registerAuthRoutes(api);
      await registerSettingsRoutes(api);
      await registerPaymentRoutes(api);
      await registerOrderRoutes(api);
      await registerInstallmentRoutes(api);
      await registerIdentityVerificationRoutes(api);
      await registerAdminConsoleRoutes(api);
      await registerAdminOpsRoutes(api);
      await registerPromotionRoutes(api);
      await registerSellerRoutes(api);
      await registerOfferRoutes(api);
      await registerSupportRoutes(api);
      await registerMessagingRoutes(api);
      await registerNotificationRoutes(api);
      await registerMediaRoutes(api);
      await registerAccountRoutes(api);
      await registerVerificationCodeRoutes(api);
      await registerProductChatRoutes(api);
      await registerReviewRoutes(api);
    },
    { prefix: API_PREFIX },
  );

  // Aucun exposé de stack interne
  app.get("/", async (_request, reply) => {
    reply.status(200).send({
      name: "MISTERDOU API",
      ...(swaggerEnabled ? { docs: `${env.API_PUBLIC_URL}/docs` } : {}),
      health: `${env.API_PUBLIC_URL}/api/v1/health`,
    });
  });

  // Landing : une seule requête publique (hors préfixe v1, cache court).
  await app.register(
    async (api) => {
      await registerSeedRoutes(api);
      await registerCatalogueRoutes(api);
    },
    { prefix: "/api" },
  );

  return app;
}

export { API_PREFIX };