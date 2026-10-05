// ---------------------------------------------------------------------------
// Opérations admin (paramètres, journal, équipe, retraits, échéanciers,
// remboursements). Les transitions d'état passent par des gardes updateMany
// idempotents, les règlements par settlePayment (porte unique PENDING→SUCCESS).
// ---------------------------------------------------------------------------

import { randomInt } from "node:crypto";
import { prisma, Prisma } from "@misterdou/db";
import type { AuditSeverity, PlanStatus, RoleName, WithdrawalStatus } from "@misterdou/db";
import type { ManagerCreateInput, ManagerUpdateInput, PlanCollectInput } from "@misterdou/shared";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";
import { decryptString, getFile } from "../../lib/storage.js";
import { assertOwnedProof } from "../identity-verification/service.js";
import { hashPassword } from "../../lib/password.js";
import { settlePayment } from "../payments/service.js";
import { isWaveLink } from "../settings/service.js";

// Clés de configuration STRICTEMENT internes (secrets chiffrés) : ni listées
// ni modifiables via l'API de paramètres (cf. modules/admin-console/auth.ts).
export const INTERNAL_SETTINGS_PREFIX = "adminTotpSecret:";

export interface OpsActor {
  actorId: string;
  actorRole?: RoleName;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

function isPrismaCode(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

function audit(
  actor: OpsActor,
  action: string,
  opts: { resourceType?: string; resourceId?: string; metadata?: unknown; severity?: AuditSeverity },
) {
  return logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionId: actor.sessionId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    action,
    ...opts,
  });
}

const settleCtx = (actor: OpsActor) => ({ actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip });

// ---------------------------------------------------------------------------
// Paramètres de la plateforme
// ---------------------------------------------------------------------------

function matchesValueType(valueType: string, value: unknown): boolean {
  switch (valueType) {
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    case "bool":
      return typeof value === "boolean";
    default:
      return true;
  }
}

export async function listSettings() {
  return prisma.settings.findMany({
    orderBy: [{ group: "asc" }, { key: "asc" }],
    // Les clés internes (secrets MFA chiffrés) ne sont JAMAIS exposées en lecture.
    // …ni les repères de la reprise de l'ancien site (« legacy. »), gérés par l'outil de copie.
    where: { AND: [{ key: { not: { startsWith: INTERNAL_SETTINGS_PREFIX } } }, { key: { not: { startsWith: "legacy." } } }] },
    select: { key: true, value: true, valueType: true, group: true, description: true, updatedById: true, updatedAt: true },
  });
}

export async function updateSetting(key: string, value: unknown, actor: OpsActor) {
  // Verrou : on ne peut pas réécrire un secret interne (ex. secret TOTP d'un
  // administrateur) depuis l'API de paramètres — sinon un opérateur SETTINGS
  // pourrait rendre la MFA illisible et verrouiller la connexion admin.
  if (key.startsWith(INTERNAL_SETTINGS_PREFIX)) throw notFound("Paramètre introuvable.");
  const row = await prisma.settings.findUnique({ where: { key } });
  if (!row) throw notFound("Paramètre introuvable.");
  if (!matchesValueType(row.valueType, value)) {
    throw badRequest("VALIDATION_ERROR", `Valeur invalide : ce paramètre attend une valeur de type « ${row.valueType} ».`);
  }
  if (key === "waveMerchantLink" && typeof value === "string" && value.trim() !== "" && !isWaveLink(value.trim())) {
    throw badRequest("VALIDATION_ERROR", "Le lien Wave doit commencer par https://pay.wave.com/");
  }
  await prisma.settings.update({
    where: { key },
    data: { value: value as Prisma.InputJsonValue, updatedById: actor.actorId },
  });
  await audit(actor, "SETTINGS_CHANGE", {
    resourceType: "Settings",
    resourceId: row.id,
    metadata: { key, before: row.value, after: value },
    severity: "WARNING",
  });
  return { key, value };
}

// ---------------------------------------------------------------------------
// Journal d'audit
// ---------------------------------------------------------------------------

export interface AuditListArgs {
  page: number;
  perPage: number;
  action?: string;
  severity?: AuditSeverity;
  resourceType?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

export async function listAuditLogs(args: AuditListArgs) {
  const { page, perPage } = args;
  const where: Prisma.AuditLogWhereInput = {
    ...(args.action ? { action: args.action } : {}),
    ...(args.severity ? { severity: args.severity } : {}),
    ...(args.resourceType ? { resourceType: args.resourceType } : {}),
    ...(args.from || args.to
      ? { createdAt: { ...(args.from ? { gte: args.from } : {}), ...(args.to ? { lte: args.to } : {}) } }
      : {}),
    ...(args.q
      ? {
          OR: [
            { action: { contains: args.q, mode: "insensitive" } },
            { resourceId: { contains: args.q, mode: "insensitive" } },
            { resourceType: { contains: args.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        createdAt: true,
        action: true,
        severity: true,
        resourceType: true,
        resourceId: true,
        ip: true,
        actorRole: true,
        metadata: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({ ...r, id: String(r.id) })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Équipe (managers STAFF)
// ---------------------------------------------------------------------------

export async function listManagers() {
  const rows = await prisma.managerProfile.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      permissions: true,
      createdAt: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, status: true, twoFactorEnabled: true, createdAt: true } },
      managerShift: { orderBy: { day: "asc" }, select: { id: true, day: true, startMinute: true, endMinute: true } },
    },
  });
  return rows.map(({ managerShift, ...rest }) => ({ ...rest, shifts: managerShift }));
}

export async function createManager(input: ManagerCreateInput, actor: OpsActor) {
  let created: { id: string; userId: string; email: string | null };
  try {
    created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.findFirst({ where: { name: "STAFF" }, select: { id: true } });
      if (!role) throw badRequest("VALIDATION_ERROR", "Rôle STAFF introuvable.");
      const user = await tx.user.create({
        data: {
          roleId: role.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: await hashPassword(input.password),
          status: "ACTIVE",
        },
        select: { id: true, email: true },
      });
      const profile = await tx.managerProfile.create({
        data: {
          userId: user.id,
          title: input.title ?? null,
          permissions: input.permissions,
          createdById: actor.actorId,
          managerShift: { create: input.shifts ?? [] },
        },
        select: { id: true },
      });
      return { id: profile.id, userId: user.id, email: user.email };
    });
  } catch (err) {
    if (isPrismaCode(err, "P2002")) throw conflict("EMAIL_ALREADY_REGISTERED", "Cet e-mail est déjà enregistré.");
    throw err;
  }
  await audit(actor, "MANAGER_CREATED", {
    resourceType: "ManagerProfile",
    resourceId: created.id,
    metadata: { email: created.email, permissions: input.permissions },
    severity: "WARNING",
  });
  return { id: created.id, userId: created.userId };
}

export async function updateManager(id: string, input: ManagerUpdateInput, actor: OpsActor) {
  const profile = await prisma.managerProfile.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, permissions: true, user: { select: { status: true } } },
  });
  if (!profile) throw notFound("Manager introuvable.");

  // Escalade de privilèges (A01) : un STAFF détenteur de SETTINGS ne doit jamais
  // pouvoir se redonner des permissions, changer son propre statut ou son propre
  // mot de passe. docs/04 : « Gérer les rôles » est réservé à l'ADMIN.
  if (profile.userId === actor.actorId && actor.actorRole !== "ADMIN") {
    throw forbidden("Impossible de modifier son propre accès : contactez un administrateur.");
  }

  const samePermissions =
    input.permissions !== undefined &&
    input.permissions.length === profile.permissions.length &&
    input.permissions.every((p) => profile.permissions.includes(p));
  const fields = [
    ...(input.title !== undefined && input.title !== profile.title ? ["title"] : []),
    ...(input.permissions !== undefined && !samePermissions ? ["permissions"] : []),
    ...(input.password !== undefined ? ["password"] : []),
    ...(input.status !== undefined && input.status !== profile.user.status ? ["status"] : []),
    ...(input.shifts !== undefined ? ["shifts"] : []),
  ];

  await prisma.$transaction(async (tx) => {
    if (input.title !== undefined || input.permissions !== undefined) {
      await tx.managerProfile.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
        },
      });
    }
    if (input.password !== undefined || input.status !== undefined) {
      await tx.user.update({
        where: { id: profile.userId },
        data: {
          ...(input.password !== undefined ? { passwordHash: await hashPassword(input.password) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
    }
    if (input.shifts !== undefined) {
      await tx.managerShift.deleteMany({ where: { profileId: id } });
      if (input.shifts.length > 0) {
        await tx.managerShift.createMany({
          data: input.shifts.map((s) => ({ profileId: id, day: s.day, startMinute: s.startMinute, endMinute: s.endMinute })),
        });
      }
    }
  });

  await audit(actor, "MANAGER_UPDATED", {
    resourceType: "ManagerProfile",
    resourceId: id,
    metadata: { fields },
    severity: "WARNING",
  });
  return { id };
}

export async function deleteManager(id: string, actor: OpsActor) {
  const profile = await prisma.managerProfile.findUnique({
    where: { id },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });
  if (!profile) throw notFound("Manager introuvable.");
  if (profile.userId === actor.actorId && actor.actorRole !== "ADMIN") {
    throw forbidden("Impossible de supprimer son propre accès : contactez un administrateur.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: profile.userId }, data: { status: "SUSPENDED", deletedAt: new Date() } });
    await tx.managerProfile.delete({ where: { id } });
  });

  await audit(actor, "MANAGER_DELETED", {
    resourceType: "ManagerProfile",
    resourceId: id,
    metadata: { email: profile.user.email },
    severity: "WARNING",
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Retraits vendeurs
// ---------------------------------------------------------------------------

export interface WithdrawalListArgs {
  page: number;
  perPage: number;
  status?: WithdrawalStatus;
  q?: string;
}

export async function listWithdrawals(args: WithdrawalListArgs) {
  const { page, perPage } = args;
  const where: Prisma.WithdrawalWhereInput = {
    ...(args.status ? { status: args.status } : {}),
    ...(args.q ? { seller: { user: { email: { contains: args.q, mode: "insensitive" } } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        amount: true,
        status: true,
        requestedAt: true,
        processingStartedAt: true,
        etaMinutes: true,
        processedAt: true,
        rejectionReason: true,
        paymentReference: true,
        bankDetailsSnapshot: true,
        proofKey: true,
        sellerConfirmedAt: true,
        sellerDisputedAt: true,
        sellerDisputeNote: true,
        seller: { select: { id: true, user: { select: { id: true, email: true, firstName: true, lastName: true } } } },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }),
    prisma.withdrawal.count({ where }),
  ]);
  return {
    items: rows.map(({ user, bankDetailsSnapshot, proofKey, ...rest }) => ({
      ...rest,
      requestedBy: user,
      // Où envoyer l'argent : moyen et numéro choisis par le vendeur.
      payout: readPayoutDetails(bankDetailsSnapshot),
      hasProof: Boolean(proofKey),
    })),
    total,
  };
}

function readPayoutDetails(snapshot: string | null): { method: string; phoneNumber: string } | null {
  if (!snapshot) return null;
  try {
    const data = JSON.parse(decryptString(snapshot)) as { method?: unknown; phoneNumber?: unknown };
    return typeof data.method === "string" && typeof data.phoneNumber === "string"
      ? { method: data.method, phoneNumber: data.phoneNumber }
      : null;
  } catch {
    return null;
  }
}

/** Capture de l'envoi d'un retrait (équipe WITHDRAWALS ou vendeur concerné). */
export async function getWithdrawalProofFile(id: string, sellerUserId?: string) {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id },
    select: { proofKey: true, seller: { select: { userId: true } } },
  });
  if (!withdrawal || (sellerUserId && withdrawal.seller.userId !== sellerUserId)) throw notFound("Retrait introuvable.");
  if (!withdrawal.proofKey) throw notFound("Aucune preuve d’envoi pour ce retrait.");
  return getFile(withdrawal.proofKey);
}

export const WITHDRAWAL_ETAS = [30, 60, 720] as const;

export async function startWithdrawalProcessing(id: string, etaMinutes: number, actor: OpsActor) {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id },
    select: { id: true, amount: true, status: true, sellerId: true, seller: { select: { userId: true } } },
  });
  if (!withdrawal) throw notFound("Retrait introuvable.");
  const res = await prisma.withdrawal.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "PROCESSING", processingStartedAt: new Date(), etaMinutes, processedById: actor.actorId },
  });
  if (res.count === 0) throw conflict("INVALID_STATE", "Ce retrait n'est plus en attente.");

  await audit(actor, "WITHDRAWAL_PROCESSING", {
    resourceType: "Withdrawal",
    resourceId: id,
    metadata: { amount: withdrawal.amount, etaMinutes, sellerId: withdrawal.sellerId },
    severity: "WARNING",
  });
  const delay = etaMinutes < 60 ? `${etaMinutes} minutes` : `${Math.round(etaMinutes / 60)} heure${etaMinutes >= 120 ? "s" : ""}`;
  await notifyUser(withdrawal.seller.userId, "SELLER_PAYOUT_AVAILABLE", {
    title: "Retrait en cours de traitement",
    message: `Votre retrait de ${withdrawal.amount.toLocaleString("fr-FR")} FCFA est pris en charge. Délai maximum : ${delay}.`,
    actionUrl: "/seller",
    priority: "NORMAL",
  });
  return { id, status: "PROCESSING" as const, etaMinutes };
}

// « Payé » : l'équipe a envoyé l'argent elle-même par Wave et
// joint la capture de l'envoi. Le vendeur confirme ensuite la réception.
export async function approveWithdrawal(id: string, input: { proofKey: string; paymentReference?: string | null }, actor: OpsActor) {
  const paymentReference = input.paymentReference?.trim() || null;
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id },
    select: { id: true, amount: true, status: true, sellerId: true, seller: { select: { userId: true } } },
  });
  if (!withdrawal) throw notFound("Retrait introuvable.");
  if (withdrawal.status !== "PENDING" && withdrawal.status !== "PROCESSING") {
    throw conflict("INVALID_STATE", "Ce retrait n'est plus en attente.");
  }
  await assertOwnedProof(input.proofKey, actor.actorId, "withdrawal_proof");

  await prisma.$transaction(async (tx) => {
    const res = await tx.withdrawal.updateMany({
      where: { id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "APPROVED", processedAt: new Date(), processedById: actor.actorId, paymentReference, proofKey: input.proofKey },
    });
    if (res.count === 0) throw conflict("INVALID_STATE", "Ce retrait n'est plus en attente.");
  });

  await audit(actor, "WITHDRAWAL_APPROVED", {
    resourceType: "Withdrawal",
    resourceId: id,
    metadata: { amount: withdrawal.amount, paymentReference, sellerId: withdrawal.sellerId },
    severity: "CRITICAL",
  });
  await notifyUser(withdrawal.seller.userId, "SELLER_PAYOUT_AVAILABLE", {
    title: "Retrait envoyé",
    message: `${withdrawal.amount.toLocaleString("fr-FR")} FCFA vous ont été envoyés${paymentReference ? ` (réf. ${paymentReference})` : ""}. La capture de l’envoi est dans votre espace vendeur : confirmez-nous la réception.`,
    actionUrl: "/seller#retraits",
    priority: "CRITICAL",
  });
  return { id, status: "APPROVED" as const };
}

export async function rejectWithdrawal(id: string, reason: string, actor: OpsActor) {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id },
    select: { id: true, amount: true, status: true, sellerId: true, seller: { select: { userId: true } } },
  });
  if (!withdrawal) throw notFound("Retrait introuvable.");
  if (withdrawal.status !== "PENDING" && withdrawal.status !== "PROCESSING") {
    throw conflict("INVALID_STATE", "Ce retrait n'est plus en attente.");
  }

  await prisma.$transaction(async (tx) => {
    const res = await tx.withdrawal.updateMany({
      where: { id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "REJECTED", rejectionReason: reason, processedAt: new Date(), processedById: actor.actorId },
    });
    if (res.count === 0) throw conflict("INVALID_STATE", "Ce retrait n'est plus en attente.");
    await recreditSellerBalance(tx, withdrawal.sellerId, withdrawal.amount);
  });

  await audit(actor, "WITHDRAWAL_REJECTED", {
    resourceType: "Withdrawal",
    resourceId: id,
    metadata: { amount: withdrawal.amount, reason, sellerId: withdrawal.sellerId },
    severity: "CRITICAL",
  });
  await notifyUser(withdrawal.seller.userId, "SYSTEM", {
    title: "Retrait refusé",
    message: reason,
    actionUrl: "/seller",
    priority: "CRITICAL",
  });
  return { id, status: "REJECTED" as const };
}

/**
 * Remboursement d'une vente : la part du vendeur est annulée une seule fois
 * (commission passée à REFUNDED). Encore en attente → retirée du solde en
 * attente ; déjà disponible → reprise sur le solde disponible (qui peut devenir
 * négatif si le vendeur l'a déjà retirée : aucun nouveau retrait possible).
 */
async function reverseSellerShare(tx: Prisma.TransactionClient, orderId: string, now: Date) {
  const commissions = await tx.commission.findMany({
    where: { orderItem: { orderId }, status: { not: "REFUNDED" } },
    select: { id: true, sellerId: true, status: true, netToSeller: true, commissionAmount: true },
  });
  const reversals: Array<{ sellerId: string; amount: number; wasAvailable: boolean }> = [];
  for (const c of commissions) {
    const claim = await tx.commission.updateMany({ where: { id: c.id, status: { not: "REFUNDED" } }, data: { status: "REFUNDED" } });
    if (claim.count === 0) continue;
    const wasAvailable = c.status === "RELEASED";
    await tx.sellerBalance.updateMany({
      where: { sellerId: c.sellerId },
      data: {
        ...(wasAvailable ? { balanceAvailable: { decrement: c.netToSeller } } : { balancePending: { decrement: c.netToSeller } }),
        totalEarnings: { decrement: c.netToSeller },
        totalCommissionPaid: { decrement: c.commissionAmount },
      },
    });
    reversals.push({ sellerId: c.sellerId, amount: c.netToSeller, wasAvailable });
  }
  // Fonds en attente neutralisés : ils ne seront jamais libérés.
  await tx.pendingCredit.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now } });
  return reversals;
}

// Le solde peut être absent (vendeur sans encaissement) : on crée alors la ligne.
async function recreditSellerBalance(tx: Prisma.TransactionClient, sellerId: string, amount: number) {
  try {
    await tx.sellerBalance.update({ where: { sellerId }, data: { balanceAvailable: { increment: amount } } });
  } catch (err) {
    if (!isPrismaCode(err, "P2025")) throw err;
    await tx.sellerBalance.upsert({
      where: { sellerId },
      create: { sellerId, balanceAvailable: amount },
      update: { balanceAvailable: { increment: amount } },
    });
  }
}

// ---------------------------------------------------------------------------
// Échéanciers (collecte manuelle + solde complet)
// ---------------------------------------------------------------------------

export interface PlanListArgs {
  page: number;
  perPage: number;
  status?: PlanStatus;
  q?: string;
}

export async function listPlans(args: PlanListArgs) {
  const { page, perPage } = args;
  const where: Prisma.InstallmentPlanWhereInput = {
    ...(args.status ? { status: args.status } : {}),
    ...(args.q
      ? {
          OR: [
            { order: { orderNumber: { contains: args.q, mode: "insensitive" } } },
            { order: { buyer: { email: { contains: args.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.installmentPlan.findMany({
      where,
      orderBy: { order: { createdAt: "desc" } },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        downPaymentAmount: true,
        remainingAmount: true,
        monthCount: true,
        monthlyAmount: true,
        lastMonthAmount: true,
        totalPaid: true,
        paidCount: true,
        order: {
          select: {
            orderNumber: true,
            status: true,
            totalAmount: true,
            paymentMode: true,
            buyer: { select: { id: true, email: true, firstName: true, lastName: true } },
            // Le compte acheté (« Clé d'accès » depuis la liste).
            items: { take: 1, select: { productId: true, title: true } },
          },
        },
        installments: {
          orderBy: { index: "asc" },
          select: { id: true, index: true, amountDue: true, amountPaid: true, dueDate: true, paidAt: true, status: true },
        },
      },
    }),
    prisma.installmentPlan.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      ...r,
      installments: r.installments.map((i) => ({ ...i, dueDate: i.dueDate.toISOString(), paidAt: i.paidAt ? i.paidAt.toISOString() : null })),
    })),
    total,
  };
}

export async function collectInstallment(input: PlanCollectInput, actor: OpsActor) {
  const installment = await prisma.installment.findUnique({
    where: { id: input.installmentId },
    select: {
      id: true,
      index: true,
      amountDue: true,
      amountPaid: true,
      status: true,
      planId: true,
      plan: { select: { id: true, totalAmount: true, order: { select: { id: true, orderNumber: true, buyerId: true } } } },
    },
  });
  if (!installment) throw notFound("Échéance introuvable.");
  if (installment.status === "PAID" || installment.status === "WAIVED") {
    throw conflict("INSTALLMENT_ALREADY_PAID", "Cette échéance est déjà réglée.");
  }
  const amount = installment.amountDue - installment.amountPaid;
  if (amount <= 0) throw conflict("INSTALLMENT_ALREADY_PAID", "Cette échéance est déjà réglée.");

  const order = installment.plan.order;
  let payment = await prisma.payment.findFirst({
    where: { installmentId: installment.id, status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!payment) {
    payment = await prisma.payment.create({
      data: {
        userId: order.buyerId,
        orderId: order.id,
        installmentPlanId: installment.planId,
        installmentId: installment.id,
        paymentNumber: `PAY-${order.orderNumber}-M${installment.index}-${randomInt(100, 999)}`,
        type: "INSTALLMENT",
        amount,
        currency: "XOF",
        provider: "SYSTEM",
        status: "PENDING",
      },
      select: { id: true },
    });
  }

  const settled = await settlePayment({ id: payment.id }, "SUCCESS", { source: "ADMIN", ctx: settleCtx(actor) });

  await audit(actor, "PLAN_INSTALLMENT_COLLECTED", {
    resourceType: "InstallmentPlan",
    resourceId: installment.planId,
    metadata: {
      planId: installment.planId,
      installmentId: installment.id,
      index: installment.index,
      amount,
      method: input.method ?? null,
      reference: input.reference ?? null,
    },
    severity: "WARNING",
  });
  await notifyUser(order.buyerId, "PAYMENT_CONFIRMED", {
    title: "Paiement encaissé",
    message: `${amount} FCFA encaissés pour la tranche ${installment.index} de la commande ${order.orderNumber}.`,
    actionUrl: "/account/orders",
    priority: "NORMAL",
  });

  const plan = await prisma.installmentPlan.findUnique({
    where: { id: installment.planId },
    select: { totalPaid: true, totalAmount: true },
  });
  const totalPaid = plan?.totalPaid ?? 0;
  return {
    paymentId: settled.paymentId,
    status: settled.status,
    planId: installment.planId,
    totalPaid,
    settled: plan !== null && totalPaid >= plan.totalAmount,
  };
}

export async function settlePlan(planId: string, reference: string | undefined, actor: OpsActor) {
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      totalAmount: true,
      downPaymentAmount: true,
      totalPaid: true,
      order: { select: { id: true, orderNumber: true, buyerId: true } },
      installments: { orderBy: { index: "asc" }, select: { id: true, index: true, amountDue: true, amountPaid: true, status: true } },
    },
  });
  if (!plan) throw notFound("Échéancier introuvable.");
  if (plan.totalPaid >= plan.totalAmount) throw conflict("PLAN_NOTHING_TO_SETTLE", "Cet échéancier est déjà soldé.");

  const ctx = settleCtx(actor);
  const order = plan.order;

  // a) Apport initial — un seul paiement INITIAL_INSTALLMENT par plan.
  if (plan.downPaymentAmount > 0 && plan.totalPaid < plan.downPaymentAmount) {
    const downSettled = await prisma.payment.findFirst({
      where: { installmentPlanId: plan.id, type: "INITIAL_INSTALLMENT", status: "SUCCESS" },
      select: { id: true },
    });
    if (!downSettled) {
      let payment = await prisma.payment.findFirst({
        where: { installmentPlanId: plan.id, type: "INITIAL_INSTALLMENT", status: { in: ["PENDING", "PROCESSING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!payment) {
        payment = await prisma.payment.create({
          data: {
            userId: order.buyerId,
            orderId: order.id,
            installmentPlanId: plan.id,
            paymentNumber: `PAY-${order.orderNumber}-DP-${randomInt(100, 999)}`,
            type: "INITIAL_INSTALLMENT",
            amount: plan.downPaymentAmount,
            currency: "XOF",
            provider: "SYSTEM",
            status: "PENDING",
          },
          select: { id: true },
        });
      }
      await settlePayment({ id: payment.id }, "SUCCESS", { source: "ADMIN", ctx });
    }
  }

  // b) Mensualités restantes, une par une (chaque settle est idempotent).
  //    Les échéances encaissables sont filtrées d'abord, puis les éventuels
  //    paiements PENDING/PROCESSING déjà ouverts sont lus EN LOT (une seule
  //    requête) avant la boucle — l'ancienne version faisait 1 SELECT par
  //    échéance (N+1 de 12 requêtes pour un plan à 12 mois).
  const collectable = plan.installments.filter(
    (inst) => inst.status !== "PAID" && inst.status !== "WAIVED" && inst.amountDue - inst.amountPaid > 0,
  );
  const openPayments = collectable.length
    ? await prisma.payment.findMany({
        where: {
          installmentId: { in: collectable.map((inst) => inst.id) },
          status: { in: ["PENDING", "PROCESSING"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, installmentId: true },
      })
    : [];
  // Le plus récent gagne (tri createdAt desc conservé de l'ancien findFirst).
  const openByInstallment = new Map<string, string>();
  for (const payment of openPayments) {
    if (payment.installmentId && !openByInstallment.has(payment.installmentId)) {
      openByInstallment.set(payment.installmentId, payment.id);
    }
  }

  for (const inst of collectable) {
    const amount = inst.amountDue - inst.amountPaid;
    const openId = openByInstallment.get(inst.id);
    let payment: { id: string };
    if (openId) {
      payment = { id: openId };
    } else {
      payment = await prisma.payment.create({
        data: {
          userId: order.buyerId,
          orderId: order.id,
          installmentPlanId: plan.id,
          installmentId: inst.id,
          paymentNumber: `PAY-${order.orderNumber}-M${inst.index}-${randomInt(100, 999)}`,
          type: "INSTALLMENT",
          amount,
          currency: "XOF",
          provider: "SYSTEM",
          status: "PENDING",
        },
        select: { id: true },
      });
    }
    await settlePayment({ id: payment.id }, "SUCCESS", { source: "ADMIN", ctx });
  }

  const finalPlan = await prisma.installmentPlan.findUnique({
    where: { id: plan.id },
    select: { status: true, totalPaid: true, totalAmount: true },
  });
  const totalPaid = finalPlan?.totalPaid ?? plan.totalPaid;
  const settled = totalPaid >= plan.totalAmount;
  if (settled) {
    await notifyUser(order.buyerId, "PAYMENT_CONFIRMED", {
      title: "Plan soldé",
      message: `L'échéancier de la commande ${order.orderNumber} est entièrement soldé.`,
      actionUrl: "/account/orders",
      priority: "CRITICAL",
    });
  }

  await audit(actor, "PLAN_SETTLED", {
    resourceType: "InstallmentPlan",
    resourceId: plan.id,
    metadata: { planId: plan.id, orderId: order.id, reference: reference ?? null, totalAmount: plan.totalAmount },
    severity: "WARNING",
  });
  return { planId: plan.id, status: finalPlan?.status ?? ("ACTIVE" as const), totalPaid, settled };
}

// ---------------------------------------------------------------------------
// Remboursement d'un paiement
// ---------------------------------------------------------------------------

const ORDER_PAYMENT_TYPES = ["ORDER_PAYMENT", "INITIAL_INSTALLMENT", "INSTALLMENT"] as const;

export async function refundPayment(id: string, reason: string, actor: OpsActor) {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      type: true,
      amount: true,
      paymentNumber: true,
      orderId: true,
      installmentPlanId: true,
      userId: true,
      provider: true,
    },
  });
  if (!payment) throw notFound("Paiement introuvable.");
  if (payment.status === "REFUNDED") throw conflict("ORDER_ALREADY_REFUNDED", "Ce paiement est déjà remboursé.");
  if (payment.status !== "SUCCESS") throw conflict("INVALID_STATE", "Seul un paiement réussi peut être remboursé.");

  const isOrderType = (ORDER_PAYMENT_TYPES as readonly string[]).includes(payment.type);
  const now = new Date();
  const effect: {
    featured?: Record<string, unknown>;
    sellerUserId?: string;
    /** Part vendeur annulée par le remboursement (une ligne par vendeur). */
    sellerReversals?: Array<{ sellerId: string; amount: number; wasAvailable: boolean }>;
  } = {};

  await prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({ where: { id, status: "SUCCESS" }, data: { status: "REFUNDED" } });
    if (res.count === 0) throw conflict("ORDER_ALREADY_REFUNDED", "Ce paiement est déjà remboursé.");

    if (isOrderType && payment.orderId) {
      await tx.order.update({ where: { id: payment.orderId }, data: { status: "REFUNDED" } });
      effect.sellerReversals = await reverseSellerShare(tx, payment.orderId, now);
      if (payment.installmentPlanId) {
        await tx.installmentPlan.update({ where: { id: payment.installmentPlanId }, data: { status: "CANCELLED" } });
        await tx.installment.updateMany({
          where: { planId: payment.installmentPlanId, status: { in: ["PENDING", "OVERDUE"] } },
          data: { status: "CANCELLED" },
        });
      }
    }

    if (payment.type === "FEATURED") {
      const purchase = await tx.featuredProduct.findFirst({
        where: { paymentId: payment.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, productId: true, sellerId: true, expiresAt: true, seller: { select: { userId: true } } },
      });
      if (purchase) {
        await tx.featuredProduct.update({ where: { id: purchase.id }, data: { status: "REFUNDED" } });
        // Inverse exact d'activateFeatured : on ne retire featuredUntil que si
        // CETTE achat en est la source actuelle (sinon une mise en avant payée
        // plus tard serait perdue — alors on laisse et on le note).
        const product = await tx.product.findUnique({
          where: { id: purchase.productId },
          select: { featuredUntil: true },
        });
        const currentUntil = product?.featuredUntil ?? null;
        const ownsWindow =
          purchase.expiresAt >= now && currentUntil !== null && currentUntil.getTime() === purchase.expiresAt.getTime();
        if (ownsWindow) {
          await tx.product.update({ where: { id: purchase.productId }, data: { featuredUntil: null } });
        }
        let balanceRecredited = false;
        if (payment.provider === "BALANCE" && purchase.sellerId) {
          await recreditSellerBalance(tx, purchase.sellerId, payment.amount);
          balanceRecredited = true;
        }
        effect.featured = {
          purchaseId: purchase.id,
          productId: purchase.productId,
          featuredUntilCleared: ownsWindow,
          featuredUntilKept: !ownsWindow,
          balanceRecredited,
        };
        if (purchase.seller?.userId) effect.sellerUserId = purchase.seller.userId;
      }
    }
  });

  await audit(actor, "PAYMENT_REFUNDED", {
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: {
      reason,
      amount: payment.amount,
      type: payment.type,
      paymentNumber: payment.paymentNumber,
      orderId: payment.orderId,
      ...(effect.featured ? { featured: effect.featured } : {}),
      ...(effect.sellerReversals?.length ? { sellerReversals: effect.sellerReversals } : {}),
    },
    severity: "CRITICAL",
  });

  if (isOrderType) {
    await notifyUser(payment.userId, "ORDER_REFUNDED", {
      title: "Remboursement en cours",
      message: `${payment.amount.toLocaleString("fr-FR")} FCFA vous sont remboursés par Wave, sur le numéro qui a payé.`,
      actionUrl: "/account/orders",
      priority: "CRITICAL",
    });
  }
  for (const reversal of effect.sellerReversals ?? []) {
    const seller = await prisma.seller.findUnique({ where: { id: reversal.sellerId }, select: { userId: true } });
    if (!seller) continue;
    await notifyUser(seller.userId, "SYSTEM", {
      title: "Vente annulée et remboursée",
      message: reversal.wasAvailable
        ? `Le client a été remboursé : ${reversal.amount.toLocaleString("fr-FR")} FCFA sont retirés de votre solde disponible.`
        : `Le client a été remboursé : les ${reversal.amount.toLocaleString("fr-FR")} FCFA en attente ne vous seront pas versés.`,
      actionUrl: "/seller",
      priority: "CRITICAL",
    });
  }
  if (payment.type === "FEATURED" && effect.sellerUserId) {
    await notifyUser(effect.sellerUserId, "SYSTEM", {
      title: "Mise en avant remboursée",
      message: `${payment.amount} FCFA remboursés pour la mise en avant.`,
      actionUrl: "/seller",
      priority: "CRITICAL",
    });
  }
  return { id, status: "REFUNDED" as const };
}
