import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { managerCreateSchema, managerUpdateSchema, planCollectSchema, planSettleSchema } from "@misterdou/shared";
import type { ManagerPermission } from "@misterdou/shared";
import { sendOk } from "../../lib/envelope.js";
import { badRequest } from "../../lib/errors.js";
import { requireAdminSession, requireAuth, requirePermission } from "../../lib/auth-context.js";
import {
  approveWithdrawal,
  collectInstallment,
  createManager,
  deleteManager,
  listAuditLogs,
  listManagers,
  listPlans,
  listSettings,
  listWithdrawals,
  refundPayment,
  rejectWithdrawal,
  settlePlan,
  updateManager,
  updateSetting,
  type OpsActor,
} from "./service.js";
import { financeOverview, listReceivables } from "./finance.js";

const TAG = "Admin — Opérations";

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(10).max(100).default(25),
  q: z.string().trim().max(120).optional(),
});

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(120).optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  resourceType: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(120).optional(),
});

const withdrawalQuery = pageQuery.extend({
  status: z.enum(["PENDING", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED"]).optional(),
});

const planQuery = pageQuery.extend({
  status: z.enum(["ACTIVE", "COMPLETED", "DEFAULTED", "CANCELLED"]).optional(),
});

const receivableQuery = pageQuery.extend({
  status: z.enum(["all", "OVERDUE", "DUE", "PAID", "NONE"]).default("all"),
});

const settingsValueBody = z.object({ value: z.unknown() });
const approveBody = z.object({ paymentReference: z.string().trim().min(3).max(120) });
const rejectBody = z.object({ reason: z.string().trim().min(5).max(300) });
const refundBody = z.object({ reason: z.string().trim().min(5).max(500) });
const planIdQuery = z.object({ planId: z.string().trim().min(1).optional() });

function permissionGuard(perm: ManagerPermission) {
  return async (request: FastifyRequest) => {
    await requirePermission(request, perm);
  };
}

// docs/04 : « Modifier les Settings » et « Gérer les rôles » = ADMIN seul
// (session renforcée 2FA). Un STAFF ne doit pas pouvoir s'auto-attribuer des
// permissions ni réécrire la configuration de la plateforme.
async function adminGuard(request: FastifyRequest) {
  requireAdminSession(request);
}

function actor(request: FastifyRequest): OpsActor {
  const auth = requireAuth(request);
  return {
    actorId: auth.user.id,
    actorRole: auth.user.role?.name,
    sessionId: auth.id,
    ip: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

const secured = (summary: string) => ({ tags: [TAG], summary, security: [{ bearerAuth: [] }] });

export async function registerAdminOpsRoutes(app: FastifyInstance) {
  // --- Paramètres de la plateforme ---
  app.get(
    "/admin/settings",
    { preHandler: permissionGuard("SETTINGS"), schema: secured("Liste des paramètres de la plateforme") },
    async (_request, reply) => sendOk(reply, await listSettings()),
  );

  app.patch(
    "/admin/settings/:key",
    { preHandler: adminGuard, schema: secured("Modifier un paramètre de la plateforme (ADMIN)") },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const parsed = settingsValueBody.safeParse(request.body);
      if (!parsed.success || !("value" in parsed.data) || parsed.data.value === undefined) {
        throw badRequest("VALIDATION_ERROR", "Valeur du paramètre manquante.");
      }
      return sendOk(reply, await updateSetting(key, parsed.data.value, actor(request)));
    },
  );

  // --- Journal d'audit ---
  app.get(
    "/admin/audit",
    { preHandler: permissionGuard("SETTINGS"), schema: secured("Journal d'audit (paginé, filtrable)") },
    async (request, reply) => {
      const args = auditQuery.parse(request.query);
      const { items, total } = await listAuditLogs(args);
      return sendOk(reply, items, { page: args.page, perPage: args.perPage, total });
    },
  );

  // --- Équipe (managers) ---
  app.get(
    "/admin/managers",
    { preHandler: permissionGuard("SETTINGS"), schema: secured("Liste des managers et de leurs permissions") },
    async (_request, reply) => sendOk(reply, await listManagers()),
  );

  app.post(
    "/admin/managers",
    { preHandler: adminGuard, schema: secured("Créer un manager (compte STAFF) — ADMIN") },
    async (request, reply) => {
      const input = managerCreateSchema.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Données du manager invalides.");
      const created = await createManager(input.data, actor(request));
      reply.status(201);
      return sendOk(reply, created);
    },
  );

  app.patch(
    "/admin/managers/:id",
    { preHandler: adminGuard, schema: secured("Modifier un manager (permissions, accès, horaires) — ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = managerUpdateSchema.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Données du manager invalides.");
      return sendOk(reply, await updateManager(id, input.data, actor(request)));
    },
  );

  app.delete(
    "/admin/managers/:id",
    { preHandler: adminGuard, schema: secured("Désactiver un manager et supprimer son profil — ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return sendOk(reply, await deleteManager(id, actor(request)));
    },
  );

  // --- Retraits vendeurs ---
  app.get(
    "/admin/withdrawals",
    { preHandler: permissionGuard("WITHDRAWALS"), schema: secured("Liste des retraits vendeurs (paginée)") },
    async (request, reply) => {
      const args = withdrawalQuery.parse(request.query);
      const { items, total } = await listWithdrawals(args);
      return sendOk(reply, items, { page: args.page, perPage: args.perPage, total });
    },
  );

  app.post(
    "/admin/withdrawals/:id/approve",
    { preHandler: permissionGuard("WITHDRAWALS"), schema: secured("Approuver un retrait vendeur") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = approveBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Référence de paiement invalide (3 à 120 caractères).");
      return sendOk(reply, await approveWithdrawal(id, input.data.paymentReference, actor(request)));
    },
  );

  app.post(
    "/admin/withdrawals/:id/reject",
    { preHandler: permissionGuard("WITHDRAWALS"), schema: secured("Refuser un retrait vendeur (recrédit du solde)") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = rejectBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Motif de refus invalide (5 à 300 caractères).");
      return sendOk(reply, await rejectWithdrawal(id, input.data.reason, actor(request)));
    },
  );

  // --- Échéanciers (paiement en tranches) ---
  app.get(
    "/admin/plans",
    { preHandler: permissionGuard("PAYMENTS"), schema: secured("Liste des échéanciers (paginée)") },
    async (request, reply) => {
      const args = planQuery.parse(request.query);
      const { items, total } = await listPlans(args);
      return sendOk(reply, items, { page: args.page, perPage: args.perPage, total });
    },
  );

  // --- Pilotage financier ---
  app.get(
    "/admin/finance",
    { preHandler: permissionGuard("STATS"), schema: secured("Chiffre d'affaires, encaissé du mois, montant à recevoir, série 12 mois") },
    async (_request, reply) => sendOk(reply, await financeOverview()),
  );

  app.get(
    "/admin/receivables",
    { preHandler: permissionGuard("PAYMENTS"), schema: secured("Comptes en cours de paiement : état du mois, mois restants, échéancier") },
    async (request, reply) => {
      const args = receivableQuery.parse(request.query);
      const { items, total, counts } = await listReceivables(args);
      return sendOk(reply, { items, counts, total, page: args.page, perPage: args.perPage }, { page: args.page, perPage: args.perPage, total });
    },
  );

  app.post(
    "/admin/plans/collect",
    { preHandler: permissionGuard("PAYMENTS"), schema: secured("Encaisser manuellement une échéance") },
    async (request, reply) => {
      const input = planCollectSchema.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Échéance à encaisser invalide.");
      return sendOk(reply, await collectInstallment(input.data, actor(request)));
    },
  );

  app.post(
    "/admin/plans/settle",
    { preHandler: permissionGuard("PAYMENTS"), schema: secured("Solder un échéancier (apport + mensualités)") },
    async (request, reply) => {
      const input = planSettleSchema.safeParse(request.body ?? {});
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Référence de règlement invalide.");
      const query = planIdQuery.parse(request.query ?? {});
      const body = (request.body ?? {}) as { planId?: unknown };
      const planId = query.planId ?? (typeof body.planId === "string" ? body.planId.trim() : undefined);
      if (!planId) throw badRequest("VALIDATION_ERROR", "Identifiant d'échéancier manquant.");
      return sendOk(reply, await settlePlan(planId, input.data.reference, actor(request)));
    },
  );

  // --- Remboursements ---
  app.post(
    "/admin/payments/:id/refund",
    { preHandler: permissionGuard("PAYMENTS"), schema: secured("Rembourser un paiement réussi") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = refundBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Motif de remboursement invalide (5 à 500 caractères).");
      return sendOk(reply, await refundPayment(id, input.data.reason, actor(request)));
    },
  );
}
