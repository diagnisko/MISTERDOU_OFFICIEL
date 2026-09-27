import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@misterdou/db";
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, MANAGER_PERMISSION_LABELS } from "@misterdou/shared";
import type { ManagerPermission, RoleName } from "@misterdou/shared";
import { ActiveSession, findActiveSession } from "./sessions.js";
import { env } from "../env.js";
import { unauthorized, forbidden } from "./errors.js";

// Contexte d'authentification attaché à la requête (voir types/fastify.d.ts).
// NonNullable : une AuthContext n'est JAMAIS null (null ⇔ non authentifié).
export type AuthContext = NonNullable<ActiveSession>;

export type { ActiveSession };

export async function readSessionFromRequest(
  request: FastifyRequest,
): Promise<AuthContext | null> {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  const sid = unsigned.valid ? unsigned.value : undefined;
  if (!sid) return null;
  return findActiveSession(sid);
}

export function requireAuth(request: FastifyRequest): AuthContext {
  const auth = request.auth;
  if (!auth) throw unauthorized();
  return auth;
}

export function requireRoles(request: FastifyRequest, roles: readonly RoleName[]): AuthContext {
  const auth = requireAuth(request);
  if (!auth.user.role?.name || !roles.includes(auth.user.role.name)) throw forbidden();
  return auth;
}

export function requireAdminSession(request: FastifyRequest): AuthContext {
  const auth = requireRoles(request, ["ADMIN"]);
  if (!auth.isAdminSession || !auth.user.twoFactorEnabled) throw forbidden("Authentification renforcée requise.");
  return auth;
}

export function requireAdminSetupSession(request: FastifyRequest): AuthContext {
  const auth = requireRoles(request, ["ADMIN"]);
  if (auth.isAdminSession || auth.user.twoFactorEnabled) throw forbidden();
  return auth;
}

// Garde à permission : ADMIN = session renforcée (2FA, cf. requireAdminSession),
// STAFF = profil manager dont les permissions sont la source de vérité.
export async function requirePermission(
  request: FastifyRequest,
  perm: ManagerPermission,
): Promise<AuthContext> {
  const auth = requireAuth(request);
  const roleName = auth.user.role?.name;
  if (roleName === "ADMIN") {
    if (!auth.isAdminSession || !auth.user.twoFactorEnabled) {
      throw forbidden("Authentification renforcée requise.");
    }
    return auth;
  }
  if (roleName === "STAFF") {
    const profile = await prisma.managerProfile.findUnique({
      where: { userId: auth.user.id },
      select: { permissions: true },
    });
    if (!profile || !profile.permissions.includes(perm)) {
      throw forbidden("Permission requise : " + MANAGER_PERMISSION_LABELS[perm]);
    }
    return auth;
  }
  throw forbidden();
}

// ---- cookies ----

export function sessionCookieOptions(maxAgeSeconds: number, admin = false) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production", // local http → sécurité désactivée en dev
    sameSite: "lax" as const,
    path: "/",
    signed: true,
    maxAge: maxAgeSeconds,
    ...(admin ? { priority: "high" as const } : {}),
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  sid: string,
  ttlSeconds: number,
  admin = false,
) {
  return reply.setCookie(SESSION_COOKIE_NAME, sid, sessionCookieOptions(ttlSeconds, admin));
}

export function clearSessionCookie(reply: FastifyReply) {
  return reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function setCsrfCookie(reply: FastifyReply, token: string) {
  // Cookie sans HttpOnly : le JS du client le relit pour l'envoyer en header (double submit).
  return reply.setCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}