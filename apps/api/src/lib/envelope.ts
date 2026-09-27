import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiEnvelope, ApiErrorCode } from "@misterdou/shared";

// Enveloppe uniforme de réponse : { ok, data, meta?, error? }
// 200 OK      : { ok: true, data, meta? }
// Erreurs     : { ok: false, error: { code, message, details? } }

export function sendOk<T>(reply: FastifyReply, data: T, meta?: Record<string, unknown>): FastifyReply {
  const body: ApiEnvelope<T, typeof meta> = {
    ok: true,
    data,
    ...(meta ? { meta } : {}),
  };
  return reply.send(body);
}

// Politique de cache commune aux routes PUBLIQUES idempotentes (landing,
// catalogue, méta) : réutilisable par le navigateur 60 s, rafraîchie en arrière-
// plan pendant encore 300 s. Jamais appliquée à une route authentifiée (le hook
// global de plugins/security.ts force `no-store` dès qu'une session est présente).
export const PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/**
 * sendOk pour les routes publiques : ajoute un ETag fort (sha1 du corps JSON)
 * et répond 304 quand le client renvoie If-None-Match.
 *
 * Le corps est sérialisé ici (JSON.stringify) pour que l'empreinte soit
 * calculée sur des octets EXACTEMENT identiques à ceux envoyés — Fastify
 * sérialise de la même façon en l'absence de schema.response.
 */
export function sendPublicOk<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  data: T,
  meta?: Record<string, unknown>,
): FastifyReply {
  const body: ApiEnvelope<T, typeof meta> = {
    ok: true,
    data,
    ...(meta ? { meta } : {}),
  };
  const json = JSON.stringify(body);
  const etag = `"${createHash("sha1").update(json).digest("base64url")}"`;
  reply.header("ETag", etag);

  const rawIfNoneMatch: unknown = request.headers["if-none-match"];
  const candidates: string[] = Array.isArray(rawIfNoneMatch)
    ? rawIfNoneMatch.filter((value): value is string => typeof value === "string")
    : typeof rawIfNoneMatch === "string"
      ? [rawIfNoneMatch]
      : [];
  const matched = candidates.some((value: string) =>
    value
      .split(",")
      .map((part: string) => part.trim().replace(/^W\//, ""))
      .some((tag: string) => tag === etag || tag === "*"),
  );
  if (matched && request.method === "GET") {
    reply.status(304);
    return reply.send();
  }

  reply.type("application/json; charset=utf-8");
  return reply.send(json);
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply.status(statusCode).send({
    ok: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  } satisfies ApiEnvelope);
}