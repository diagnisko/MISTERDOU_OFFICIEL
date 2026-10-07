import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { AuditSeverity } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission, type AuthContext } from "../../lib/auth-context.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyActiveAdmins, notifyUser } from "../../lib/notify.js";
import { openStaffConversation, postStaffMessage } from "../messaging/service.js";

const TAG = "Support";

const SUPPORT_STATUS_VALUES = ["CREATED", "PENDING", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const SUPPORT_CATEGORY_VALUES = ["VERIFICATION_CODE", "SELLER_REPORT", "PAYMENT_ISSUE", "DELIVERY", "OTHER"] as const;

const STATUS_LABELS: Record<(typeof SUPPORT_STATUS_VALUES)[number], string> = {
  CREATED: "Créée",
  PENDING: "En attente",
  IN_PROGRESS: "En cours",
  RESOLVED: "Résolue",
  CLOSED: "Fermée",
};

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
});

const createTicketSchema = z.object({
  category: z.enum(SUPPORT_CATEGORY_VALUES),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4000),
  orderId: z.string().uuid().optional(),
});

const clientPatchSchema = z.object({ status: z.enum(["CLOSED", "RESOLVED"] as const) });

const adminListQuery = pageQuery.extend({
  status: z.enum(SUPPORT_STATUS_VALUES).optional(),
  category: z.enum(SUPPORT_CATEGORY_VALUES).optional(),
});

const adminPatchSchema = z.object({
  status: z.enum(SUPPORT_STATUS_VALUES).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

const replySchema = z.object({ message: z.string().trim().min(1).max(4000) });

// « Code d'aide » dérivé de l'id (aucune colonne supplémentaire).
const ticketCode = (id: string) => "MD-" + id.slice(0, 8).toUpperCase();

async function audit(
  request: FastifyRequest,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: unknown,
  severity?: AuditSeverity,
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
    severity,
  });
}

// Accès au détail : propriétaire, ADMIN, ou STAFF avec la permission SUPPORT.
async function canReadTicket(auth: AuthContext, reporterId: string): Promise<boolean> {
  if (reporterId === auth.user.id) return true;
  const role = auth.user.role?.name;
  if (role === "ADMIN") return true;
  if (role !== "STAFF") return false;
  const profile = await prisma.managerProfile.findUnique({
    where: { userId: auth.user.id },
    select: { permissions: true },
  });
  return profile?.permissions.includes("SUPPORT") ?? false;
}

const REPORTER_SELECT = { id: true, email: true, firstName: true, lastName: true } as const;

export async function registerSupportRoutes(app: FastifyInstance) {
  // --- Création d'une demande (§30 « réponse du support », code d'aide) ---
  app.post(
    "/support/tickets",
    { schema: { tags: [TAG], summary: "Ouvrir une demande de support (code d'aide)", security: [{ bearerAuth: [] }] }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = createTicketSchema.parse(request.body);
      if (input.orderId) {
        const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { buyerId: true } });
        if (!order || order.buyerId !== auth.user.id) throw notFound("Commande introuvable.");
      }
      const ticket = await prisma.supportTicket.create({
        data: {
          orderId: input.orderId,
          reporterId: auth.user.id,
          category: input.category,
          subject: input.subject,
          description: input.description,
          status: "CREATED",
        },
        select: { id: true, status: true, category: true, subject: true, createdAt: true },
      });
      await audit(request, "SUPPORT_TICKET_CREATED", "SupportTicket", ticket.id, {
        ticketId: ticket.id,
        category: input.category,
      });
      await notifyActiveAdmins("ADMIN_ALERT", {
        title: "Nouvelle demande de support",
        message: input.subject,
        actionUrl: "/admin/support",
        priority: "CRITICAL",
      });
      return sendOk(reply, {
        id: ticket.id,
        code: ticketCode(ticket.id),
        status: ticket.status,
        category: ticket.category,
        subject: ticket.subject,
        createdAt: ticket.createdAt,
      });
    },
  );

  // --- Mes demandes (paginé) ---
  app.get(
    "/support/tickets/mine",
    { schema: { tags: [TAG], summary: "Mes demandes de support (paginé)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { page, perPage } = pageQuery.parse(request.query);
      const where = { reporterId: auth.user.id };
      const [items, total] = await Promise.all([
        prisma.supportTicket.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * perPage,
          take: perPage,
          select: {
            id: true,
            status: true,
            category: true,
            subject: true,
            createdAt: true,
            resolvedAt: true,
            order: { select: { orderNumber: true } },
            User_SupportTicket_assignedToIdToUser: { select: { firstName: true, lastName: true } },
          },
        }),
        prisma.supportTicket.count({ where }),
      ]);
      return sendOk(
        reply,
        items.map((t) => ({
          id: t.id,
          code: ticketCode(t.id),
          status: t.status,
          category: t.category,
          subject: t.subject,
          createdAt: t.createdAt,
          resolvedAt: t.resolvedAt,
          orderNumber: t.order?.orderNumber ?? null,
          assignedTo: t.User_SupportTicket_assignedToIdToUser,
        })),
        { page, perPage, total },
      );
    },
  );

  // --- Détail d'une demande : propriétaire, ADMIN, STAFF+SUPPORT (sinon 404) ---
  app.get(
    "/support/tickets/:id",
    { schema: { tags: [TAG], summary: "Détail d'une demande de support", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const ticket = await prisma.supportTicket.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          category: true,
          subject: true,
          description: true,
          orderId: true,
          reporterId: true,
          assignedToId: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          order: { select: { orderNumber: true } },
          User_SupportTicket_reporterIdToUser: { select: REPORTER_SELECT },
          User_SupportTicket_assignedToIdToUser: { select: REPORTER_SELECT },
        },
      });
      if (!ticket || !(await canReadTicket(auth, ticket.reporterId))) throw notFound("Ticket introuvable.");
      return sendOk(reply, {
        id: ticket.id,
        code: ticketCode(ticket.id),
        status: ticket.status,
        category: ticket.category,
        subject: ticket.subject,
        description: ticket.description,
        orderId: ticket.orderId,
        orderNumber: ticket.order?.orderNumber ?? null,
        reporter: ticket.User_SupportTicket_reporterIdToUser,
        assignedTo: ticket.User_SupportTicket_assignedToIdToUser,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt,
      });
    },
  );

  // --- Clôture par le client (propriétaire uniquement) ---
  app.patch(
    "/support/tickets/:id",
    { schema: { tags: [TAG], summary: "Clore ou marquer résolue ma demande", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const input = clientPatchSchema.parse(request.body);
      const result = await prisma.supportTicket.updateMany({
        where: { id, reporterId: auth.user.id },
        data: {
          status: input.status,
          ...(input.status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
        },
      });
      if (result.count !== 1) throw notFound("Ticket introuvable.");
      await audit(request, "SUPPORT_TICKET_UPDATED", "SupportTicket", id, { status: input.status, by: "reporter" });
      return sendOk(reply, { id, code: ticketCode(id), status: input.status });
    },
  );

  // --- File admin (permission SUPPORT) ---
  app.get(
    "/admin/support/tickets",
    { schema: { tags: [TAG], summary: "Liste des demandes de support (admin, paginée)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await requirePermission(request, "SUPPORT");
      const args = adminListQuery.parse(request.query);
      const where = {
        ...(args.status ? { status: args.status } : {}),
        ...(args.category ? { category: args.category } : {}),
        ...(args.q
          ? {
              OR: [
                { subject: { contains: args.q, mode: "insensitive" as const } },
                { User_SupportTicket_reporterIdToUser: { email: { contains: args.q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.supportTicket.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (args.page - 1) * args.perPage,
          take: args.perPage,
          select: {
            id: true,
            category: true,
            subject: true,
            description: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            resolvedAt: true,
            orderId: true,
            order: { select: { orderNumber: true } },
            User_SupportTicket_reporterIdToUser: { select: REPORTER_SELECT },
            User_SupportTicket_assignedToIdToUser: { select: REPORTER_SELECT },
          },
        }),
        prisma.supportTicket.count({ where }),
      ]);
      return sendOk(
        reply,
        items.map((t) => ({
          id: t.id,
          code: ticketCode(t.id),
          category: t.category,
          subject: t.subject,
          description: t.description,
          status: t.status,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          resolvedAt: t.resolvedAt,
          orderId: t.orderId,
          orderNumber: t.order?.orderNumber ?? null,
          reporter: t.User_SupportTicket_reporterIdToUser,
          assignedTo: t.User_SupportTicket_assignedToIdToUser,
        })),
        { page: args.page, perPage: args.perPage, total },
      );
    },
  );

  // --- Traitement admin (statut libre, assignation, motif) ---
  app.patch(
    "/admin/support/tickets/:id",
    { schema: { tags: [TAG], summary: "Traiter une demande de support (statut, assignation)", security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const auth = await requirePermission(request, "SUPPORT");
      const { id } = request.params as { id: string };
      const input = adminPatchSchema.parse(request.body);
      if (input.status === undefined && input.assignedToId === undefined) {
        throw badRequest("VALIDATION_ERROR", "Aucune modification fournie.");
      }
      const ticket = await prisma.supportTicket.findUnique({
        where: { id },
        select: { id: true, status: true, assignedToId: true, reporterId: true },
      });
      if (!ticket) throw notFound("Ticket introuvable.");
      if (input.assignedToId) {
        const assignee = await prisma.user.findFirst({
          where: {
            id: input.assignedToId,
            status: "ACTIVE",
            deletedAt: null,
            role: { name: { in: ["ADMIN", "STAFF"] } },
          },
          select: { id: true },
        });
        if (!assignee) throw badRequest("VALIDATION_ERROR", "Responsable invalide : administrateur ou membre actif requis.");
      }

      const changes: Record<string, unknown> = {};
      if (input.status) changes.status = { from: ticket.status, to: input.status };
      if (input.assignedToId !== undefined) changes.assignedToId = { from: ticket.assignedToId, to: input.assignedToId };
      if (input.reason) changes.reason = input.reason;

      const updated = await prisma.supportTicket.update({
        where: { id },
        data: {
          ...(input.status
            ? { status: input.status, resolvedAt: input.status === "RESOLVED" ? new Date() : null }
            : {}),
          ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
        },
        select: { id: true, status: true, assignedToId: true, resolvedAt: true },
      });
      await audit(request, "SUPPORT_TICKET_UPDATED", "SupportTicket", id, changes, "WARNING");

      if (input.status && ticket.reporterId !== auth.user.id) {
        await notifyUser(ticket.reporterId, "SYSTEM", {
          title: "Votre demande de support",
          message: `Statut : ${STATUS_LABELS[input.status]}`,
          actionUrl: "/support",
          priority: "NORMAL",
        });
      }

      return sendOk(reply, {
        id: updated.id,
        code: ticketCode(updated.id),
        status: updated.status,
        assignedToId: updated.assignedToId,
        resolvedAt: updated.resolvedAt,
      });
    },
  );

  // --- Réponse de l'équipe : arrive dans la messagerie du membre (et en notification) ---
  app.post(
    "/admin/support/tickets/:id/reply",
    {
      schema: { tags: [TAG], summary: "Répondre à une demande de support (message au membre)", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const auth = await requirePermission(request, "SUPPORT");
      const { id } = request.params as { id: string };
      const { message } = replySchema.parse(request.body);
      const ticket = await prisma.supportTicket.findUnique({
        where: { id },
        select: { id: true, subject: true, status: true, assignedToId: true, reporterId: true },
      });
      if (!ticket) throw notFound("Ticket introuvable.");

      const code = ticketCode(ticket.id);
      const conversation = await openStaffConversation(auth.user.id, ticket.reporterId);
      await postStaffMessage(conversation.id, auth.user.id, `Réponse à votre demande ${code} (« ${ticket.subject} ») :\n\n${message}`);

      // Demande prise en charge : « En cours », et confiée à celui qui répond si personne ne l'avait.
      const reopen = ticket.status === "CREATED" || ticket.status === "PENDING";
      await prisma.supportTicket.update({
        where: { id },
        data: {
          ...(reopen ? { status: "IN_PROGRESS" as const } : {}),
          ...(ticket.assignedToId ? {} : { assignedToId: auth.user.id }),
        },
      });

      await notifyUser(ticket.reporterId, "NEW_MESSAGE", {
        title: "Réponse du support",
        message: `Votre demande ${code} a reçu une réponse : ${message.slice(0, 100)}`,
        actionUrl: "/messages",
        priority: "NORMAL",
      });
      await audit(request, "SUPPORT_TICKET_REPLIED", "SupportTicket", id, { code });
      return sendOk(reply, { conversationId: conversation.id, status: reopen ? "IN_PROGRESS" : ticket.status });
    },
  );
}
