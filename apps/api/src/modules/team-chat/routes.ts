import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, type AuthContext } from "../../lib/auth-context.js";
import { badRequest, forbidden } from "../../lib/errors.js";
import { publicUrl } from "../../lib/media.js";
import { notifyMany, wholeTeamOnDuty } from "../../lib/notify.js";
import { isOnShift, scheduleLabel } from "../../lib/shifts.js";
import { displayName, openTeamConversation } from "../messaging/service.js";

// ---------------------------------------------------------------------------
// Discussion d'équipe (console) : administrateurs et managers, quelle que
// soit leur permission. Hors créneau, un manager est arrêté avant d'arriver
// ici (console fermée, plugins/hooks.ts).
// GET  /admin/team-chat                 membres, salon, non lus
// GET  /admin/team-chat/unread          total non lu (pastille du menu)
// POST /admin/team-chat/direct          ouvre l'échange privé avec un membre
// GET  /admin/team-chat/room/messages   salon « Toute l'équipe » (marqué lu)
// POST /admin/team-chat/room/messages   écrire dans le salon
// Les échanges privés passent ensuite par /conversations/:id/messages (kind TEAM).
// ---------------------------------------------------------------------------

const TAG = "Discussion d'équipe";

const directSchema = z.object({ userId: z.string().uuid() });
const postSchema = z.object({ content: z.string().trim().min(1).max(4000) });
const roomQuery = z.object({
  before: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function requireTeam(request: FastifyRequest): AuthContext {
  const auth = requireAuth(request);
  const role = auth.user.role?.name;
  if (role === "ADMIN" && auth.isAdminSession) return auth;
  if (role === "STAFF") return auth;
  throw forbidden("Réservé à l'équipe.");
}

const avatar = (key: string | null) => (key ? publicUrl(key) : null);

/** Messages du salon non lus par ce membre (hors les siens). */
async function roomUnread(userId: string): Promise<number> {
  const read = await prisma.teamRoomRead.findUnique({ where: { userId }, select: { lastReadAt: true } });
  return prisma.teamPost.count({
    where: { senderId: { not: userId }, ...(read ? { createdAt: { gt: read.lastReadAt } } : {}) },
  });
}

/** Messages privés d'équipe non lus par ce membre. */
async function directUnread(userId: string): Promise<number> {
  return prisma.message.count({
    where: {
      readAt: null,
      senderId: { not: userId },
      conversation: { kind: "TEAM", OR: [{ participantAUserId: userId }, { participantBUserId: userId }] },
    },
  });
}

export async function registerTeamChatRoutes(app: FastifyInstance) {
  const rate = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

  app.get("/admin/team-chat", { schema: { tags: [TAG], summary: "Membres de l'équipe, salon et non lus", security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const auth = requireTeam(request);
    const me = auth.user.id;
    const [members, convos, lastPost, unreadRoom] = await Promise.all([
      prisma.user.findMany({
        where: { status: "ACTIVE", deletedAt: null, role: { name: { in: ["ADMIN", "STAFF"] } }, id: { not: me } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarKey: true,
          role: { select: { name: true } },
          managerProfile: { select: { title: true, managerShift: { select: { day: true, startMinute: true, endMinute: true } } } },
        },
      }),
      prisma.conversation.findMany({
        where: { kind: "TEAM", OR: [{ participantAUserId: me }, { participantBUserId: me }] },
        select: {
          id: true,
          participantAUserId: true,
          participantBUserId: true,
          message: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true, senderId: true } },
          _count: { select: { message: { where: { senderId: { not: me }, readAt: null } } } },
        },
      }),
      prisma.teamPost.findFirst({
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true, senderId: true, sender: { select: { firstName: true, lastName: true } } },
      }),
      roomUnread(me),
    ]);

    const byPeer = new Map(convos.map((c) => [c.participantAUserId === me ? c.participantBUserId : c.participantAUserId, c]));
    const rows = members.map((m) => {
      const convo = byPeer.get(m.id);
      const last = convo?.message[0] ?? null;
      const shifts = (m.managerProfile?.managerShift ?? []) as Parameters<typeof isOnShift>[0];
      return {
        id: m.id,
        name: displayName(m) || "Membre de l'équipe",
        avatarUrl: avatar(m.avatarKey),
        role: m.role.name,
        title: m.role.name === "ADMIN" ? "Administrateur" : (m.managerProfile?.title ?? "Manager"),
        onDuty: m.role.name === "ADMIN" || isOnShift(shifts),
        schedule: m.role.name === "STAFF" && shifts.length > 0 ? scheduleLabel(shifts) : null,
        conversationId: convo?.id ?? null,
        unread: convo?._count.message ?? 0,
        lastMessage: last ? { content: last.content.slice(0, 120), createdAt: last.createdAt, mine: last.senderId === me } : null,
      };
    });
    // Échanges récents d'abord, puis par nom.
    rows.sort((a, b) => (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0));

    return sendOk(reply, {
      me,
      room: {
        unread: unreadRoom,
        lastMessage: lastPost
          ? { content: lastPost.content.slice(0, 120), createdAt: lastPost.createdAt, mine: lastPost.senderId === me, senderName: displayName(lastPost.sender) }
          : null,
      },
      members: rows,
    });
  });

  app.get("/admin/team-chat/unread", { schema: { tags: [TAG], summary: "Total des messages d'équipe non lus", security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const auth = requireTeam(request);
    const [room, direct] = await Promise.all([roomUnread(auth.user.id), directUnread(auth.user.id)]);
    return sendOk(reply, { total: room + direct, room, direct });
  });

  app.post("/admin/team-chat/direct", { schema: { tags: [TAG], summary: "Ouvrir l'échange privé avec un membre de l'équipe", security: [{ bearerAuth: [] }] }, config: rate(30) }, async (request, reply) => {
    const auth = requireTeam(request);
    const { userId } = directSchema.parse(request.body);
    if (userId === auth.user.id) throw badRequest("VALIDATION_ERROR", "Choisissez un autre membre de l'équipe.");
    const convo = await openTeamConversation(auth.user.id, userId);
    return sendOk(reply, { conversationId: convo.id });
  });

  app.get("/admin/team-chat/room/messages", { schema: { tags: [TAG], summary: "Messages du salon « Toute l'équipe »", security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const auth = requireTeam(request);
    const args = roomQuery.parse(request.query);
    let before: Date | undefined;
    if (args.before) {
      before = new Date(args.before);
      if (Number.isNaN(before.getTime())) throw badRequest("VALIDATION_ERROR", "Curseur de messages invalide.");
    }
    const rows = await prisma.teamPost.findMany({
      where: before ? { createdAt: { lt: before } } : {},
      orderBy: { createdAt: "desc" },
      take: args.limit + 1,
      select: { id: true, content: true, senderId: true, createdAt: true, sender: { select: { firstName: true, lastName: true, avatarKey: true } } },
    });
    // Lu : jusqu'au dernier message affiché.
    if (!before) {
      const now = new Date();
      await prisma.teamRoomRead.upsert({ where: { userId: auth.user.id }, create: { userId: auth.user.id, lastReadAt: now }, update: { lastReadAt: now } });
    }
    const hasMore = rows.length > args.limit;
    const window = (hasMore ? rows.slice(0, args.limit) : rows).reverse();
    return sendOk(reply, {
      items: window.map((m) => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        senderName: displayName(m.sender) || "Membre de l'équipe",
        senderAvatarUrl: avatar(m.sender.avatarKey),
        isSystem: false,
        attachmentKey: null,
        createdAt: m.createdAt,
        readAt: null,
      })),
      nextBefore: hasMore && window[0] ? window[0].createdAt.toISOString() : null,
    });
  });

  app.post("/admin/team-chat/room/messages", { schema: { tags: [TAG], summary: "Écrire dans le salon « Toute l'équipe »", security: [{ bearerAuth: [] }] }, config: rate(30) }, async (request, reply) => {
    const auth = requireTeam(request);
    const { content } = postSchema.parse(request.body);
    const post = await prisma.teamPost.create({
      data: { senderId: auth.user.id, content },
      select: { id: true, content: true, senderId: true, createdAt: true },
    });
    await prisma.teamRoomRead.upsert({ where: { userId: auth.user.id }, create: { userId: auth.user.id, lastReadAt: post.createdAt }, update: { lastReadAt: post.createdAt } });

    // L'équipe en service est prévenue sur son téléphone (sans remplir la cloche).
    const senderName = displayName(auth.user) || "Un membre de l'équipe";
    const recipients = (await wholeTeamOnDuty()).filter((id) => id !== auth.user.id);
    await notifyMany(
      "NEW_MESSAGE",
      recipients.map((userId) => ({ userId, params: { title: `${senderName} · Toute l'équipe`, message: content.slice(0, 120), actionUrl: "/admin/chat", priority: "NORMAL" as const } })),
      { push: { tag: "team-room" }, bell: false },
    );

    const me = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { avatarKey: true } });
    return sendOk(reply, {
      id: post.id,
      content: post.content,
      senderId: post.senderId,
      senderName,
      senderAvatarUrl: avatar(me?.avatarKey ?? null),
      isSystem: false,
      attachmentKey: null,
      createdAt: post.createdAt,
      readAt: null,
    });
  });
}
