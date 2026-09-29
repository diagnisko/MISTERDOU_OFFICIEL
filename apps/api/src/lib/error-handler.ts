import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "@misterdou/db";
import { ApiError } from "./errors.js";
import { env } from "../env.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    // Erreurs "Attendues"
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    if (error instanceof ZodError) {
      const details = error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Données invalides", details },
      });
    }

    // Base injoignable ou connexion coupée (réveil de Neon, réseau) : erreur
    // passagère, on invite à réessayer plutôt qu'afficher une panne.
    const connectionLost =
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1008", "P1017"].includes(error.code));
    if (connectionLost) {
      request.log.warn({ err: error }, "[db] connexion indisponible");
      return reply
        .status(503)
        .header("Retry-After", "5")
        .send({
          ok: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "Connexion momentanément interrompue. Réessayez dans quelques secondes." },
        });
    }

    // Erreurs Prisma / DB
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.status(409).send({
          ok: false,
          error: { code: "CONFLICT", message: "Cette valeur existe déjà" },
        });
      }
      if (error.code === "P2025") {
        return reply.status(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "Ressource introuvable" },
        });
      }
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Requête invalide" },
      });
    }

    // Erreurs "internes" Fastify : validation de schéma (query/params/body),
    // parsing du corps, corps trop volumineux, rate-limit… Elles portent déjà un
    // statusCode 4xx/429 (ou un code FST_ERR_CTP_* sans statusCode) : sans cette
    // branche elles retomberaient en 500 INTERNAL_ERROR.
    const fastifyErr = error as { statusCode?: number; code?: string; validation?: unknown };
    const FST_CLIENT_CODES = /^(FST_ERR_VALIDATION|FST_ERR_CTP_|FST_ERR_REQ_FILE_TOO_LARGE|FST_ERR_RATE)/;
    const byStatus =
      typeof fastifyErr.statusCode === "number" && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500;
    const byCode = typeof fastifyErr.code === "string" && FST_CLIENT_CODES.test(fastifyErr.code);
    if (byStatus || byCode) {
      const status = byStatus
        ? (fastifyErr.statusCode as number)
        : fastifyErr.code?.includes("BODY_TOO_LARGE") || fastifyErr.code?.includes("FILE_TOO_LARGE")
          ? 413
          : fastifyErr.code?.startsWith("FST_ERR_RATE")
            ? 429
            : 400;
      const code =
        status === 429 ? "RATE_LIMITED"
        : status === 413 ? "PAYLOAD_TOO_LARGE"
        : status === 401 ? "UNAUTHORIZED"
        : status === 403 ? "FORBIDDEN"
        : status === 404 ? "NOT_FOUND"
        : status === 409 ? "CONFLICT"
        : "VALIDATION_ERROR";
      const message =
        status === 429 ? "Trop de requêtes. Réessayez dans un instant."
        : status === 413 ? "Corps de requête trop volumineux."
        : status === 401 ? "Non authentifié"
        : status === 403 ? "Accès refusé"
        : status === 404 ? "Ressource introuvable"
        : status === 409 ? "Conflit d'état"
        : "Requête invalide";
      return reply.status(status).send({
        ok: false,
        error: {
          code,
          message,
          ...(env.NODE_ENV === "development" && fastifyErr.validation !== undefined
            ? { details: fastifyErr.validation }
            : {}),
        },
      });
    }

    if (request.url.includes("/api/v1")) {
      request.log.error({ err: error, url: request.url }, "Erreur non gérée");
      return reply.status(500).send({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Erreur interne du serveur",
          ...(env.NODE_ENV === "development" ? { details: (error as Error)?.message ?? String(error) } : {}),
        },
      });
    }

    return reply.status(500).send({ ok: false, error: { code: "INTERNAL_ERROR", message: "Erreur interne" } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.includes("/api/v1")) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `Route introuvable : ${request.method} ${request.url}` },
      });
    }
    return reply.status(404).send("Not Found");
  });
}