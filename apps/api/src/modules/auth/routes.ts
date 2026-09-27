import type { FastifyInstance, FastifyReply } from "fastify";
import {
  registerSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  googleOAuthSchema,
  SESSION_COOKIE_NAME,
} from "@misterdou/shared";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { register, login, requestOtp, verifyOtp, loginWithGoogle, setPhone, toMeDto } from "./service.js";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requireAdminSetupSession, requireAdminSession, setSessionCookie, clearSessionCookie, setCsrfCookie } from "../../lib/auth-context.js";
import { revokeSession } from "../../lib/sessions.js";
import { logAudit, randomCsrfToken } from "../../lib/audit.js";
import { env } from "../../env.js";
import { confirmAdminTotp, loginAdmin, startAdminTotpSetup } from "../admin-console/auth.js";

const setPhoneSchema = z.object({
  countryCode: z.string().regex(/^\+[0-9]{1,4}$/),
  phoneNumber: z.string().regex(/^[0-9]{6,15}$/),
});

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
      phoneVerified: result.phoneVerified,
      requiresOtp: result.requiresOtp,
    });
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
    return sendOk(reply, { user: result.user });
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
    return sendOk(reply, { user: result.user, phoneRequired: result.phoneRequired });
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

  app.post("/auth/otp/request", { schema: { tags: ["Auth"], summary: "Demander un code OTP (vérification téléphone)" }, config: rate(5) }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = otpRequestSchema.parse(request.body);
    const result = await requestOtp(input, { actorId: auth.user.id, ip: request.ip });
    await logAudit({ action: "OTP_SENT", ip: request.ip, resourceType: "PhoneVerification" });
    return sendOk(reply, result);
  });

  app.post("/auth/otp/verify", { schema: { tags: ["Auth"], summary: "Vérifier le code OTP" }, config: rate(5) }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = otpVerifySchema.parse(request.body);
    const result = await verifyOtp(input, { actorId: auth.user.id, ip: request.ip });
    await logAudit({ action: "OTP_VERIFIED", ip: request.ip, resourceType: "PhoneVerification" });
    return sendOk(reply, result);
  });

  // --- routes authentifiées ---

  app.get("/auth/me", { schema: { tags: ["Auth"], summary: "Compte courant" } }, async (request, reply) => {
    const auth = requireAuth(request);
    const pv = await prisma.phoneVerification.findFirst({
      where: { userId: auth.user.id, status: "VERIFIED" },
      select: { id: true },
    });
    const verification = await prisma.identityVerification.findFirst({
      where: { userId: auth.user.id },
      orderBy: { submittedAt: "desc" },
      select: { status: true },
    });
    return sendOk(reply, {
      user: { ...toMeDto(auth.user, Boolean(pv), auth.user.role?.name ?? "CLIENT"), kycStatus: verification?.status ?? "NOT_SUBMITTED" },
    });
  });

  app.post("/auth/phone", { schema: { tags: ["Auth"], summary: "(Ré)attribuer un téléphone (première connexion Google)" }, config: rate(5) }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = setPhoneSchema.parse(request.body);
    await setPhone(auth.user.id, input);
    await logAudit({
      actorId: auth.user.id,
      action: "PHONE_SET",
      ip: request.ip,
      resourceType: "User",
      resourceId: auth.user.id,
    });
    return sendOk(reply, { ok: true });
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