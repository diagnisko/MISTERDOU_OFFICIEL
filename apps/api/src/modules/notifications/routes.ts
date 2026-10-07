import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";

const TAG = "Notifications";

const DEFAULT_PREFERENCES = { inApp: true, push: true, email: true, sms: false } as const;

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.enum(["true", "false", "1", "0"]).optional(),
});

const prefsSchema = z
  .object({
    inApp: z.boolean().optional(),
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Aucune préférence fournie.",
  });

const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(400),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
});

const tokenSchema = z.object({ token: z.string().trim().min(10).max(400) });

// Sélection : des notifications précises, ou toutes (éventuellement les non lues seulement).
const selectionSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    all: z.boolean().optional(),
    unreadOnly: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids?.length ?? 0) > 0, { message: "Aucune notification sélectionnée." });

/** Notifications visibles du membre visées par la sélection. */
function selectionWhere(userId: string, input: z.infer<typeof selectionSchema>) {
  return {
    userId,
    hiddenAt: null,
    ...(input.all ? (input.unreadOnly ? { readAt: null } : {}) : { id: { in: input.ids ?? [] } }),
  };
}

export async function registerNotificationRoutes(app: FastifyInstance) {
  // --- Centre de notifications (§47) ---
  app.get(
    "/notifications",
    { schema: { tags: [TAG], summary: "Mes notifications (paginé, non lues)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const args = listQuery.parse(request.query);
      const unreadOnly = args.unreadOnly === "true" || args.unreadOnly === "1";
      // Les notifications masquées par le membre n'apparaissent plus.
      const where = { userId: auth.user.id, hiddenAt: null, ...(unreadOnly ? { readAt: null } : {}) };
      const [items, total, unread] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (args.page - 1) * args.perPage,
          take: args.perPage,
          select: {
            id: true,
            type: true,
            title: true,
            message: true,
            channel: true,
            priority: true,
            actionUrl: true,
            readAt: true,
            createdAt: true,
          },
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId: auth.user.id, hiddenAt: null, readAt: null } }),
      ]);
      return sendOk(reply, items, { page: args.page, perPage: args.perPage, total, unread });
    },
  );

  // --- Marquer une notification comme lue (idempotent) ---
  app.post(
    "/notifications/:id/read",
    { schema: { tags: [TAG], summary: "Marquer une notification comme lue", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const existing = await prisma.notification.findFirst({
        where: { id, userId: auth.user.id },
        select: { id: true, readAt: true },
      });
      if (!existing) throw notFound("Notification introuvable.");
      if (existing.readAt) return sendOk(reply, { id: existing.id, readAt: existing.readAt });
      const readAt = new Date();
      await prisma.notification.updateMany({ where: { id, userId: auth.user.id, readAt: null }, data: { readAt } });
      return sendOk(reply, { id, readAt });
    },
  );

  // --- Tout marquer comme lu (§47) ---
  app.post(
    "/notifications/read-all",
    { schema: { tags: [TAG], summary: "Marquer toutes mes notifications comme lues", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const result = await prisma.notification.updateMany({
        where: { userId: auth.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return sendOk(reply, { updated: result.count });
    },
  );

  // --- Masquer des notifications (tout membre) : elles quittent sa liste ---
  app.post(
    "/notifications/hide",
    { schema: { tags: [TAG], summary: "Masquer des notifications (sélection ou toutes)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const parsed = selectionSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Aucune notification sélectionnée.");
      const now = new Date();
      const result = await prisma.notification.updateMany({
        where: selectionWhere(auth.user.id, parsed.data),
        data: { hiddenAt: now },
      });
      // Une notification masquée ne compte plus comme non lue.
      await prisma.notification.updateMany({ where: { userId: auth.user.id, hiddenAt: now, readAt: null }, data: { readAt: now } });
      return sendOk(reply, { hidden: result.count });
    },
  );

  // --- Supprimer définitivement (administrateur seulement) ---
  app.post(
    "/notifications/delete",
    { schema: { tags: [TAG], summary: "Supprimer définitivement des notifications (administrateur)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      if (auth.user.role?.name !== "ADMIN") throw forbidden("Seul l'administrateur peut supprimer des notifications : vous pouvez les masquer.");
      const parsed = selectionSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Aucune notification sélectionnée.");
      const result = await prisma.notification.deleteMany({ where: selectionWhere(auth.user.id, parsed.data) });
      return sendOk(reply, { deleted: result.count });
    },
  );

  // --- Préférences (§61) ---
  app.get(
    "/notifications/preferences",
    { schema: { tags: [TAG], summary: "Mes préférences de notifications", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const pref = await prisma.notificationPreference.findUnique({ where: { userId: auth.user.id } });
      if (!pref) return sendOk(reply, { ...DEFAULT_PREFERENCES, isDefault: true });
      return sendOk(reply, {
        inApp: pref.inApp,
        push: pref.push,
        email: pref.email,
        sms: pref.sms,
        updatedAt: pref.updatedAt,
        isDefault: false,
      });
    },
  );

  app.patch(
    "/notifications/preferences",
    {
      schema: {
        tags: [TAG],
        summary: "Modifier mes préférences — les notifications critiques restent toujours affichées",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const parsed = prefsSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Préférences invalides : au moins un champ booléen requis.");
      const changes: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value !== undefined) changes[key] = value;
      }
      const pref = await prisma.notificationPreference.upsert({
        where: { userId: auth.user.id },
        create: {
          userId: auth.user.id,
          inApp: changes.inApp ?? DEFAULT_PREFERENCES.inApp,
          push: changes.push ?? DEFAULT_PREFERENCES.push,
          email: changes.email ?? DEFAULT_PREFERENCES.email,
          sms: changes.sms ?? DEFAULT_PREFERENCES.sms,
        },
        update: changes,
      });
      await logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role?.name,
        sessionId: auth.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        action: "NOTIFICATION_PREFS_UPDATED",
        resourceType: "NotificationPreference",
        resourceId: auth.user.id,
        metadata: { changes },
        severity: "WARNING",
      });
      return sendOk(reply, {
        inApp: pref.inApp,
        push: pref.push,
        email: pref.email,
        sms: pref.sms,
        updatedAt: pref.updatedAt,
        isDefault: false,
      });
    },
  );

  // --- Jetons de notification push (architecture §46) ---
  app.post(
    "/devices/push-token",
    { schema: { tags: [TAG], summary: "Enregistrer un jeton de notification push", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = pushTokenSchema.parse(request.body);
      await prisma.pushToken.upsert({
        where: { token: input.token },
        create: { token: input.token, platform: input.platform, userId: auth.user.id },
        update: { userId: auth.user.id, platform: input.platform, lastSeenAt: new Date() },
      });
      return sendOk(reply, { ok: true });
    },
  );

  app.delete(
    "/devices/push-token",
    { schema: { tags: [TAG], summary: "Supprimer son jeton de notification push", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = tokenSchema.parse(request.body);
      await prisma.pushToken.deleteMany({ where: { token: input.token, userId: auth.user.id } });
      return sendOk(reply, { ok: true });
    },
  );
}
