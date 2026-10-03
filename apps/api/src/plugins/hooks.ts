import type { FastifyInstance } from "fastify";
import { CSRF_COOKIE_NAME } from "@misterdou/shared";
import { readSessionFromRequest } from "../lib/auth-context.js";
import { forbidden } from "../lib/errors.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Chemins exemptés de la vérification CSRF (points d'échange de cookies)
const CSRF_EXEMPT = new Set<string>([
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/google",
  "/api/v1/auth/admin/login",
  "/api/v1/auth/password/forgot",
  "/api/v1/auth/password/reset",
  "/api/v1/auth/email/verify",
]);

export function attachRequestHooks(app: FastifyInstance) {
  // 1) Authentification : résout la session pour TOUTES les routes API.
  app.addHook("preValidation", async (request) => {
    if (!request.url.includes("/api/v1")) return;
    request.auth = await readSessionFromRequest(request);
  });

  // 2) CSRF — double-submit : le header x-csrf-token doit être égal à la valeur du cookie md_csrf.
  app.addHook("preHandler", async (request) => {
    const url = request.url.split("?")[0] ?? "";
    if (!MUTATING_METHODS.has(request.method)) return;
    if (!url.includes("/api/v1")) return;
    if (CSRF_EXEMPT.has(url)) return;
    // Sans session, il n'y a rien à protéger : la route répond elle-même 401
    // si elle exige une connexion (V-09 : plus de 403 trompeur avant le 401).
    if (!request.auth) return;

    const cookieToken = request.cookies[CSRF_COOKIE_NAME];
    const headerToken = request.headers["x-csrf-token"];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw forbidden("Jeton CSRF invalide ou absent");
    }
  });
}