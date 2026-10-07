import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { badRequest } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { confirmUpload, createUpload, deleteMedia, publicUrl } from "../../lib/media.js";
import { forgetHouseAvatar } from "../../lib/house.js";

// ---------------------------------------------------------------------------
// Compte du membre : profil, mot de passe, photo. L'e-mail n'est jamais
// modifiable ici (identifiant de connexion, et fourni par Google le cas échéant).
// ---------------------------------------------------------------------------

const AVATAR_RULES = { kinds: ["image" as const], maxBytes: 2 * 1024 * 1024 };

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const profileBody = z.object({
  firstName: z.string().trim().min(1, "Prénom requis").max(100),
  lastName: text(100).nullable().optional(),
  country: text(100).nullable().optional(),
  city: text(100).nullable().optional(),
});

const passwordBody = z.object({
  currentPassword: z.string().max(72).optional(),
  newPassword: z.string().min(8, "8 caractères minimum").max(72),
});

const avatarUploadBody = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive(),
});
const avatarConfirmBody = z.object({
  key: z.string().min(10).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

function ctx(request: FastifyRequest) {
  const auth = requireAuth(request);
  return {
    auth,
    audit: {
      actorId: auth.user.id,
      actorRole: auth.user.role?.name as RoleName | undefined,
      sessionId: auth.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      resourceType: "User",
      resourceId: auth.user.id,
    },
  };
}

export async function registerAccountRoutes(app: FastifyInstance) {
  app.patch("/account/profile", async (request, reply) => {
    const { auth, audit } = ctx(request);
    const input = profileBody.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", input.error.issues[0]?.message ?? "Profil invalide.");
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { firstName: true, lastName: true, country: true, city: true },
    });
    const data = {
      firstName: input.data.firstName,
      ...(input.data.lastName !== undefined ? { lastName: input.data.lastName } : {}),
      ...(input.data.country !== undefined ? { country: input.data.country } : {}),
      ...(input.data.city !== undefined ? { city: input.data.city } : {}),
    };
    const user = await prisma.user.update({
      where: { id: auth.user.id },
      data,
      select: { firstName: true, lastName: true, country: true, city: true },
    });
    await logAudit({ ...audit, action: "PROFILE_UPDATED", metadata: { before, after: user } });
    return sendOk(reply, user);
  });

  app.post(
    "/account/password",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { auth, audit } = ctx(request);
      const input = passwordBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", input.error.issues[0]?.message ?? "Mot de passe invalide.");
      const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { passwordHash: true } });
      const hadPassword = Boolean(user.passwordHash);
      if (hadPassword) {
        const ok = input.data.currentPassword ? await verifyPassword(input.data.currentPassword, user.passwordHash!) : false;
        if (!ok) throw badRequest("INVALID_CREDENTIALS", "Mot de passe actuel incorrect.");
      }
      await prisma.user.update({ where: { id: auth.user.id }, data: { passwordHash: await hashPassword(input.data.newPassword) } });
      // Un mot de passe changé ferme les sessions ouvertes ailleurs.
      const revoked = await prisma.session.updateMany({
        where: { userId: auth.user.id, id: { not: auth.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await logAudit({
        ...audit,
        action: hadPassword ? "PASSWORD_CHANGED" : "PASSWORD_SET",
        metadata: { otherSessionsClosed: revoked.count },
        severity: "WARNING",
      });
      await notifyUser(auth.user.id, "SECURITY_ALERT", {
        title: hadPassword ? "Mot de passe modifié" : "Mot de passe ajouté",
        message: hadPassword
          ? "Votre mot de passe vient d’être changé. Si ce n’était pas vous, contactez le support immédiatement."
          : "Vous pouvez désormais vous connecter avec votre e-mail et ce mot de passe, sans passer par Google.",
        actionUrl: "/account/settings",
        priority: "CRITICAL",
      });
      return sendOk(reply, { hasPassword: true, otherSessionsClosed: revoked.count });
    },
  );

  app.post(
    "/account/avatar/upload-url",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { auth } = ctx(request);
      const input = avatarUploadBody.safeParse(request.body);
      if (!input.success) throw badRequest("FILE_TYPE_INVALID", "Formats acceptés : JPEG, PNG, WebP.");
      return sendOk(reply, await createUpload(`avatars/${auth.user.id}`, input.data.mimeType, input.data.sizeBytes, AVATAR_RULES));
    },
  );

  app.post("/account/avatar", async (request, reply) => {
    const { auth, audit } = ctx(request);
    const input = avatarConfirmBody.safeParse(request.body);
    if (!input.success || !input.data.key.startsWith(`avatars/${auth.user.id}/`)) {
      throw badRequest("VALIDATION_ERROR", "Référence de fichier invalide.");
    }
    await confirmUpload(input.data.key, input.data.mimeType, AVATAR_RULES);
    const previous = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { avatarKey: true } });
    await prisma.user.update({ where: { id: auth.user.id }, data: { avatarKey: input.data.key } });
    if (previous.avatarKey && previous.avatarKey !== input.data.key) await deleteMedia(previous.avatarKey).catch(() => undefined);
    await logAudit({ ...audit, action: "AVATAR_UPDATED" });
    forgetHouseAvatar();
    return sendOk(reply, { avatarUrl: publicUrl(input.data.key) });
  });

  app.delete("/account/avatar", async (request, reply) => {
    const { auth, audit } = ctx(request);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { avatarKey: true } });
    if (user.avatarKey) {
      await prisma.user.update({ where: { id: auth.user.id }, data: { avatarKey: null } });
      await deleteMedia(user.avatarKey).catch(() => undefined);
      await logAudit({ ...audit, action: "AVATAR_REMOVED" });
      forgetHouseAvatar();
    }
    return sendOk(reply, { avatarUrl: null });
  });
}
