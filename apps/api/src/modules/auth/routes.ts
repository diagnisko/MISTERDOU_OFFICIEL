import type { FastifyInstance, FastifyReply } from "fastify";
import {
  registerSchema,
  loginSchema,
  googleOAuthSchema,
  SESSION_COOKIE_NAME,
} from "@misterdou/shared";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { register, login, loginWithGoogle, toMeDto } from "./service.js";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requireAdminSetupSession, requireAdminSession, setSessionCookie, clearSessionCookie, setCsrfCookie } from "../../lib/auth-context.js";
import { revokeSession } from "../../lib/sessions.js";
import { logAudit, randomCsrfToken } from "../../lib/audit.js";
import { env } from "../../env.js";
import { publicUrl } from "../../lib/media.js";
import { confirmAdminTotp, loginAdmin, startAdminTotpSetup } from "../admin-console/auth.js";
import { forgotPasswordSchema, requestPasswordReset, resetPassword, resetPasswordSchema } from "./password-reset.js";
import { badRequest } from "../../lib/errors.js";

function csrf(reply: FastifyReply) {
  setCsrfCookie(reply, randomCsrfToken());
}

export async function registerAuthRoutes(app: FastifyInstance) {
  const rate = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

  app.post("/auth/register", { schema: { tags: ["Auth"], summary: "Inscription (e-mail + mot de passe)" }, config: rate(3) }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const result = await register(input, { ip: request.ip, userAgent: request.headers["user-agent"] });
    setSessionCookie(reply, result.sid, env.SESSION_TTL_SECONDS);
    csrf(reply);
    await logAudit({
      actorId: result.user.id,
      action: "REGISTER",
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      resourceType: "User",
      resourceId: result.user.id,
    });
    return sendOk(reply, {
      user: result.user,
    });
  });

  // --- Mot de passe oublié : lien par e-mail, puis nouveau mot de passe ---
  app.post("/auth/password/forgot", { schema: { tags: ["Auth"], summary: "Recevoir un lien de réinitialisation du mot de passe" }, config: rate(3) }, async (request, reply) => {
    const input = forgotPasswordSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", "E-mail invalide.");
    return sendOk(reply, await requestPasswordReset(input.data.email, { ip: request.ip }));
  });

  app.post("/auth/password/reset", { schema: { tags: ["Auth"], summary: "Choisir un nouveau mot de passe avec le lien reçu" }, config: rate(5) }, async (request, reply) => {
    const input = resetPasswordSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", input.error.issues[0]?.message ?? "Lien ou mot de passe invalide.");
    return sendOk(reply, await resetPassword(input.data.token, input.data.password, { ip: request.ip }));
  });

  app.post("/auth/login", { schema: { tags: ["Auth"], summary: "Connexion (e-mail + mot de passe)" }, config: rate(5) }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await login(input, { ip: request.ip, userAgent: request.headers["user-agent"] });
    setSessionCookie(reply, result.sid, env.SESSION_TTL_SECONDS);
    csrf(reply);
    await logAudit({
      actorId: result.user.id,
      action: "LOGIN",
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      resourceType: "User",
      resourceId: result.user.id,
    });
    return sendOk(reply, { user: result.user, previousLoginAt: result.previousLoginAt });
  });

  app.post("/auth/google", { schema: { tags: ["Auth"], summary: "Connexion avec Google (OAuth2 : idToken)" }, config: rate(5) }, async (request, reply) => {
    const input = googleOAuthSchema.parse(request.body);
    const result = await loginWithGoogle(input.idToken, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookie(reply, result.sid, env.SESSION_TTL_SECONDS);
    csrf(reply);
    await logAudit({
      actorId: result.user.id,
      action: "LOGIN_GOOGLE",
      ip: request.ip,
      resourceType: "User",
      resourceId: result.user.id,
    });
    return sendOk(reply, {
      user: result.user,
      created: result.created,
      previousLoginAt: result.previousLoginAt,
    });
  });

  app.post("/auth/admin/login", { schema: { tags: ["Auth"], summary: "Connexion administrateur avec MFA" }, config: rate(5) }, async (request, reply) => {
    const input = z.object({ email: z.email(), password: z.string().min(1).max(72), totpCode: z.string().regex(/^\d{6}$/).optional() }).parse(request.body);
    const result = await loginAdmin(input, { ip: request.ip, userAgent: request.headers["user-agent"] });
    const ttl = result.role === "STAFF" ? env.SESSION_TTL_SECONDS : result.setupRequired ? env.ADMIN_SETUP_SESSION_TTL_SECONDS : env.ADMIN_SESSION_TTL_SECONDS;
    setSessionCookie(reply, result.sid, ttl, result.role !== "STAFF" && !result.setupRequired);
    csrf(reply);
    return sendOk(reply, { user: result.user, setupRequired: result.setupRequired, role: result.role });
  });

  app.post("/auth/admin/totp/setup", { schema: { tags: ["Auth"], summary: "Démarrer la configuration MFA (session admin temporaire)" }, config: rate(5) }, async (request, reply) => {
    const auth = requireAdminSetupSession(request);
    return sendOk(reply, await startAdminTotpSetup(auth.user));
  });

  app.post("/auth/admin/totp/confirm", { schema: { tags: ["Auth"], summary: "Activer la MFA (code TOTP)" }, config: rate(5) }, async (request, reply) => {
    const auth = requireAdminSetupSession(request);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    await confirmAdminTotp(auth.user, auth.id, code);
    const signed = request.unsignCookie(request.cookies[SESSION_COOKIE_NAME] ?? "");
    if (!signed.valid || !signed.value) throw new Error("Session d’administration invalide");
    setSessionCookie(reply, signed.value, env.ADMIN_SESSION_TTL_SECONDS, true);
    csrf(reply);
    return sendOk(reply, { enabled: true });
  });

  app.get("/auth/admin/me", async (request, reply) => {
    const auth = requireAdminSession(request);
    return sendOk(reply, { user: { id: auth.user.id, firstName: auth.user.firstName, lastName: auth.user.lastName, email: auth.user.email, role: auth.user.role?.name } });
  });

  // --- routes authentifiées ---

  app.get("/auth/me", { schema: { tags: ["Auth"], summary: "Compte courant" } }, async (request, reply) => {
    const auth = requireAuth(request);
    const [verification, seller] = await Promise.all([
      prisma.identityVerification.findFirst({
        where: { userId: auth.user.id },
        orderBy: { submittedAt: "desc" },
        select: { status: true },
      }),
      prisma.seller.findUnique({ where: { userId: auth.user.id }, select: { status: true } }),
    ]);
    return sendOk(reply, {
      user: { ...toMeDto(auth.user, auth.user.role?.name ?? "CLIENT"), kycStatus: verification?.status ?? "NOT_SUBMITTED" },
      // Profil affiché dans le menu et la page « Mon profil » (jamais le hash).
      profile: {
        avatarUrl: auth.user.avatarKey ? publicUrl(auth.user.avatarKey) : null,
        hasPassword: Boolean(auth.user.passwordHash),
        googleLinked: Boolean(auth.user.googleSub),
        country: auth.user.country,
        city: auth.user.city,
        isSeller: seller !== null,
        sellerStatus: seller?.status ?? null,
      },
    });
  });

  app.post("/auth/logout", { schema: { tags: ["Auth"], summary: "Déconnexion (révoque la session)" } }, async (request, reply) => {
    const auth = request.auth;
    const unsigned = request.unsignCookie(request.cookies[SESSION_COOKIE_NAME] ?? "");
    const sid = unsigned.valid ? unsigned.value : undefined;
    if (sid) await revokeSession(sid);
    clearSessionCookie(reply);
    await logAudit({
      actorId: auth?.id ?? auth?.user.id,
      action: "LOGOUT",
      ip: request.ip,
    });
    return sendOk(reply, { loggedOut: true });
  });
}