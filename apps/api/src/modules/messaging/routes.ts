import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { ConversationKind } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission, type AuthContext } from "../../lib/auth-context.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyActiveAdmins, notifyUser } from "../../lib/notify.js";
import {
  assertKindParticipants,
  displayName,
  loadParticipant,
  pickDefaultAdminId,
  sideOf,
  toUserDto,
  USER_NAME_SELECT,
  type NamedUser,
} from "./service.js";

const TAG = "Messagerie";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(10).max(100).default(25),
});

const createConversationSchema = z.object({
  kind: z.enum(["CLIENT_TO_ADMIN", "VENDOR_TO_ADMIN"]),
  withUserId: z.string().uuid().optional(),
});

const postMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  attachmentKey: z.string().trim().max(300).optional(),
});

const messagesQuery = z.object({
  before: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type ConversationRow = {
  id: string;
  kind: ConversationKind;
  participantAUserId: string;
  participantBUserId: string;
  createdAt: Date;
  updatedAt: Date;
  User_Conversation_participantAUserIdToUser: NamedUser;
  User_Conversation_participantBUserIdToUser: NamedUser;
  message: Array<{ content: string; createdAt: Date; senderId: string }>;
  _count: { message: number };
};

// Retour typé précisément (sans annotation large) : Prisma doit inférer les
// `select` imbriqués pour typer correctement les lignes lues.
function conversationInclude(viewerId: string) {
  return {
    User_Conversation_participantAUserIdToUser: { select: USER_NAME_SELECT },
    User_Conversation_participantBUserIdToUser: { select: USER_NAME_SELECT },
    message: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { content: true, createdAt: true, senderId: true },
    },
    _count: { select: { message: { where: { senderId: { not: viewerId }, readAt: null } } } },
  };
}

function toDto(convo: ConversationRow, viewerId: string) {
  const a = toUserDto(convo.User_Conversation_participantAUserIdToUser);
  const b = toUserDto(convo.User_Conversation_participantBUserIdToUser);
  const last = convo.message[0] ?? null;
  return {
    id: convo.id,
    kind: convo.kind,
    participants: [a, b],
    peer:
      convo.participantAUserId === viewerId
        ? b
        : convo.participantBUserId === viewerId
          ? a
          : null,
    lastMessage: last ? { content: last.content, createdAt: last.createdAt, senderId: last.senderId } : null,
    unread: convo._count.message,
    createdAt: convo.createdAt,
    updatedAt: convo.updatedAt,
  };
}

// Modération : ADMIN, ou STAFF avec la permission SUPPORT (§43).
async function canModerate(auth: AuthContext): Promise<boolean> {
  const role = auth.user.role?.name;
  if (role === "ADMIN") return true;
  if (role !== "STAFF") return false;
  const profile = await prisma.managerProfile.findUnique({
    where: { userId: auth.user.id },
    select: { permissions: true },
  });
  return profile?.permissions.includes("SUPPORT") ?? false;
}

async function findConversation(id: string, viewerId: string) {
  return prisma.conversation.findUnique({ where: { id }, include: conversationInclude(viewerId) });
}

async function audit(
  request: FastifyRequest,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: unknown,
) {
  const auth = requireAuth(request);
  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role?.name,
    sessionId: auth.id,
    ip: request.ip,
    userAgent: request.headers["user-agent"],
    action,
    resourceType,
    resourceId,
    metadata,
  });
}

export async function registerMessagingRoutes(app: FastifyInstance) {
  const rate = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

  // --- Liste de mes conversations (dernier message + non lus) ---
  app.get(
    "/conversations",
    { schema: { tags: [TAG], summary: "Mes conversations (paginé, non lus inclus)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { page, perPage } = pageQuery.parse(request.query);
      const where = {
        OR: [{ participantAUserId: auth.user.id }, { participantBUserId: auth.user.id }],
      };
      const [convos, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * perPage,
          take: perPage,
          include: conversationInclude(auth.user.id),
        }),
        prisma.conversation.count({ where }),
      ]);
      return sendOk(reply, convos.map((c) => toDto(c, auth.user.id)), { page, perPage, total });
    },
  );

  // --- Ouvrir une conversation (§43 : jamais client ↔ vendeur) ---
  app.post(
    "/conversations",
    { schema: { tags: [TAG], summary: "Ouvrir une conversation (client↔admin ou vendeur↔admin)", security: [{ bearerAuth: [] }] }, config: rate(10) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = createConversationSchema.parse(request.body);
      const me = await loadParticipant(auth.user.id);
      if (!me) throw unauthorized();
      const mySide = sideOf(me);

      if (input.kind === "VENDOR_TO_ADMIN" && mySide !== "VENDOR" && mySide !== "ADMIN") {
        throw forbidden("Réservé aux vendeurs.");
      }
      if (input.kind === "CLIENT_TO_ADMIN" && mySide === "VENDOR") {
        throw badRequest("VALIDATION_ERROR", "Conversation client↔vendeur interdite.");
      }

      let targetId = input.withUserId;
      if (!targetId) {
        if (mySide === "ADMIN") throw badRequest("VALIDATION_ERROR", "Destinataire obligatoire.");
        const adminId = await pickDefaultAdminId();
        if (!adminId) throw conflict("FEATURE_DISABLED", "Aucun administrateur disponible.");
        targetId = adminId;
      }

      const target = await loadParticipant(targetId);
      if (!target) throw badRequest("VALIDATION_ERROR", "Destinataire introuvable.");
      const targetSide = sideOf(target);

      if (mySide !== "ADMIN") {
        // Appelant non-admin : uniquement un administrateur actif en vis-à-vis.
        if (targetSide !== "ADMIN") {
          const clientVendor =
            (mySide === "CLIENT" && targetSide === "VENDOR") ||
            (mySide === "VENDOR" && targetSide === "CLIENT");
          throw badRequest(
            "VALIDATION_ERROR",
            clientVendor
              ? "Conversation client↔vendeur interdite."
              : "Seul un administrateur peut être destinataire.",
          );
        }
        if (target.status !== "ACTIVE") throw badRequest("VALIDATION_ERROR", "Destinataire indisponible.");
      } else if (targetSide !== (input.kind === "CLIENT_TO_ADMIN" ? "CLIENT" : "VENDOR")) {
        throw badRequest("VALIDATION_ERROR", "Type de conversation incompatible avec les participants.");
      }
      assertKindParticipants(input.kind, me, target);

      // Paire normalisée (tri ascendant) : une seule conversation par (A, B, kind).
      const pair = [me.id, target.id].sort();
      const first = pair[0] ?? me.id;
      const second = pair[1] ?? target.id;
      const existing = await prisma.conversation.findFirst({
        where: {
          kind: input.kind,
          OR: [
            { participantAUserId: first, participantBUserId: second },
            { participantAUserId: second, participantBUserId: first },
          ],
        },
      });
      let conversation = existing;
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { kind: input.kind, participantAUserId: first, participantBUserId: second },
        });
        await audit(request, "CONVERSATION_CREATED", "Conversation", conversation.id, { kind: input.kind });
        if (mySide !== "ADMIN") {
          await notifyActiveAdmins("ADMIN_ALERT", {
            title: "Nouvelle conversation",
            message: `${displayName(me)} vous a ouvert une conversation.`,
            actionUrl: "/admin/messages",
            priority: "CRITICAL",
          });
        }
      }
      const detail = await findConversation(conversation.id, me.id);
      if (!detail) throw notFound("Conversation introuvable.");
      return sendOk(reply, toDto(detail, me.id));
    },
  );

  // --- Détail d'une conversation (participant ou modération) ---
  app.get(
    "/conversations/:id",
    { schema: { tags: [TAG], summary: "Détail d'une conversation (participants, modérateurs)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const convo = await findConversation(id, auth.user.id);
      if (!convo) throw notFound("Conversation introuvable.");
      const isParticipant =
        convo.participantAUserId === auth.user.id || convo.participantBUserId === auth.user.id;
      if (!isParticipant && !(await canModerate(auth))) throw notFound("Conversation introuvable.");
      return sendOk(reply, toDto(convo, auth.user.id));
    },
  );

  // --- Messages (fenêtre glissante par curseur + accusé de lecture) ---
  app.get(
    "/conversations/:id/messages",
    { schema: { tags: [TAG], summary: "Messages d'une conversation (avant, limité, marqués lus)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const args = messagesQuery.parse(request.query);
      const convo = await prisma.conversation.findUnique({
        where: { id },
        select: { participantAUserId: true, participantBUserId: true },
      });
      if (!convo) throw notFound("Conversation introuvable.");
      const isParticipant =
        convo.participantAUserId === auth.user.id || convo.participantBUserId === auth.user.id;
      if (!isParticipant && !(await canModerate(auth))) throw notFound("Conversation introuvable.");

      // Côté reçu → lu (seulement pour l'expéditeur réel de la fenêtre).
      await prisma.message.updateMany({
        where: { conversationId: id, senderId: { not: auth.user.id }, readAt: null },
        data: { readAt: new Date() },
      });

      let beforeDate: Date | undefined;
      if (args.before) {
        if (UUID_RE.test(args.before)) {
          const anchor = await prisma.message.findUnique({
            where: { id: args.before },
            select: { createdAt: true },
          });
          if (!anchor) throw badRequest("VALIDATION_ERROR", "Curseur de messages invalide.");
          beforeDate = anchor.createdAt;
        } else {
          const parsed = new Date(args.before);
          if (Number.isNaN(parsed.getTime())) throw badRequest("VALIDATION_ERROR", "Curseur de messages invalide.");
          beforeDate = parsed;
        }
      }

      const rows = await prisma.message.findMany({
        where: { conversationId: id, ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}) },
        orderBy: { createdAt: "desc" },
        take: args.limit + 1,
        select: {
          id: true,
          content: true,
          senderId: true,
          isSystem: true,
          attachmentKey: true,
          createdAt: true,
          readAt: true,
          user: { select: { firstName: true, lastName: true } },
        },
      });
      const hasMore = rows.length > args.limit;
      const window = (hasMore ? rows.slice(0, args.limit) : rows).reverse();
      return sendOk(reply, {
        items: window.map((m) => ({
          id: m.id,
          content: m.content,
          senderId: m.senderId,
          senderName: m.isSystem ? "Système" : displayName(m.user) || "Utilisateur",
          isSystem: m.isSystem,
          attachmentKey: m.attachmentKey,
          createdAt: m.createdAt,
          readAt: m.readAt,
        })),
        nextBefore: hasMore && window[0] ? window[0].createdAt.toISOString() : null,
      });
    },
  );

  // --- Envoi d'un message (participants ou modérateurs, 20/min) ---
  app.post(
    "/conversations/:id/messages",
    {
      schema: { tags: [TAG], summary: "Envoyer un message dans une conversation", security: [{ bearerAuth: [] }] },
      config: rate(20),
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const input = postMessageSchema.parse(request.body);
      const convo = await prisma.conversation.findUnique({
        where: { id },
        select: { participantAUserId: true, participantBUserId: true },
      });
      if (!convo) throw notFound("Conversation introuvable.");
      const isParticipant =
        convo.participantAUserId === auth.user.id || convo.participantBUserId === auth.user.id;
      if (!isParticipant && !(await canModerate(auth))) throw notFound("Conversation introuvable.");

      const message = await prisma.message.create({
        data: { conversationId: id, senderId: auth.user.id, content: input.content, attachmentKey: input.attachmentKey },
        select: {
          id: true,
          content: true,
          senderId: true,
          isSystem: true,
          attachmentKey: true,
          createdAt: true,
          readAt: true,
        },
      });
      await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });

      // Destinataire direct : l'autre participant (ou le participant non-admin
      // si l'expéditeur est un modérateur hors conversation).
      let peerId: string | null = null;
      if (isParticipant) {
        peerId =
          convo.participantAUserId === auth.user.id ? convo.participantBUserId : convo.participantAUserId;
      } else {
        const a = await loadParticipant(convo.participantAUserId);
        const b = await loadParticipant(convo.participantBUserId);
        peerId = a && sideOf(a) !== "ADMIN" ? a.id : b && sideOf(b) !== "ADMIN" ? b.id : null;
      }
      const senderName = displayName(auth.user) || "Nouveau message";
      if (peerId && peerId !== auth.user.id) {
        await notifyUser(peerId, "NEW_MESSAGE", {
          title: senderName,
          message: input.content.slice(0, 120),
          actionUrl: "/messages",
          priority: "NORMAL",
        });
      }

      // Côté non-admin d'une conversation *_TO_ADMIN → tous les admin à la rescousse.
      const sender = await loadParticipant(auth.user.id);
      if (sender && sideOf(sender) !== "ADMIN") {
        await notifyActiveAdmins("ADMIN_ALERT", {
          title: "Nouveau message à répondre",
          message: input.content.slice(0, 120),
          actionUrl: "/admin/messages",
          priority: "NORMAL",
        });
      }

      await audit(request, "MESSAGE_SENT", "Conversation", id, { conversationId: id });
      return sendOk(reply, {
        id: message.id,
        conversationId: id,
        content: message.content,
        senderId: message.senderId,
        senderName,
        isSystem: message.isSystem,
        attachmentKey: message.attachmentKey,
        createdAt: message.createdAt,
        readAt: message.readAt,
      });
    },
  );

  // --- Vue modération (permission SUPPORT) ---
  app.get(
    "/admin/conversations",
    { schema: { tags: [TAG], summary: "Toutes les conversations (admin, paginé)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = await requirePermission(request, "SUPPORT");
      const { page, perPage } = pageQuery.parse(request.query);
      const [convos, total] = await Promise.all([
        prisma.conversation.findMany({
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * perPage,
          take: perPage,
          include: conversationInclude(auth.user.id),
        }),
        prisma.conversation.count(),
      ]);
      return sendOk(reply, convos.map((c) => toDto(c, auth.user.id)), { page, perPage, total });
    },
  );
}
