// ---------------------------------------------------------------------------
// P7 — Paiement en tranches (« Prêt ou prestation »).
//
// Décision commerciale actée : le compte n'est livré qu'une fois l'échéancier
// ENTIÈREMENT soldé. L'apport initial ouvre le dossier financier, il ne donne
// aucun accès. C'est ce qui protège la place : aucun vendeur ne livre « dans le
// vide » face à un client qui stoppe ses mensualités.
//
// Montants (entiers FCFA, aucun centime) :
//   apport        = Product.installmentDownPayment (posé par l'admin)
//   reste         = total - apport
//   mensualité    = reste / mois, arrondie à la centaine
//   dernière      = reste - mensualité × (mois - 1)  → absorbe l'arrondi,
//                   elle ne peut donc jamais être nulle ni négative.
// Les échéances tombent le même jour du mois que la commande, un mois plus tard
// pour la première mensualité (l'apport est dû maintenant, pas dans un mois).
// ---------------------------------------------------------------------------

import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { Payment, RoleName } from "@misterdou/db";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyMany, notifyUser, type NotifyParams } from "../../lib/notify.js";
import { logger } from "../../lib/logger.js";
import { alertDoubleSale, markProductsSold } from "../orders/fulfillment.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type InstallmentActor = { actorId: string; actorRole?: RoleName; ip?: string };

export type ScheduleLine = {
  index: number;
  label: string;
  amountDue: number;
  dueDate: string;
  amountPaid: number;
  status: string;
  paidAt: string | null;
};

export type Schedule = {
  totalAmount: number;
  downPaymentAmount: number;
  downPaid: boolean;
  monthlyAmount: number;
  monthCount: number;
  lastMonthAmount: number | null;
  totalPaid: number;
  remainingAmount: number;
  status: string;
  nextDueDate: string | null;
  nextAmount: number | null;
  fullyPaid: boolean;
  installments: ScheduleLine[];
};

/** Découpe un total en « apport + N mensualités » sans jamais perdre 1 FCFA. */
export function buildSchedule(input: {
  total: number;
  downPayment: number;
  months: number;
  from: Date;
}): { downPayment: number; monthly: number; last: number; lines: Array<{ index: number; amountDue: number; dueDate: Date }> } {
  const total = input.total;
  const down = Math.max(0, Math.min(input.downPayment, total));
  const rest = total - down;
  const months = input.months;

  // Arrondi à la centaine (leSeed fait de même) mais on garantit que le reste
  // ne peut pas être absorbé par une mensualité qui le dépasserait déjà.
  let monthly = months > 0 ? Math.floor(rest / months / 100) * 100 : 0;
  if (monthly < 100 && rest > 0) monthly = Math.min(rest, 100);
  if (months > 1 && monthly * (months - 1) >= rest) {
    monthly = Math.max(100, Math.floor((rest - 100) / (months - 1) / 100) * 100);
  }
  const last = rest - monthly * (months - 1);

  // Échéance 1 = un mois après la commande (l'apport est exigé maintenant).
  const lines = Array.from({ length: months }, (_, i) => {
    const due = new Date(input.from);
    due.setMonth(due.getMonth() + i + 1);
    return {
      index: i + 1,
      amountDue: i === months - 1 ? last : monthly,
      dueDate: due,
    };
  });

  return { downPayment: down, monthly, last, lines };
}

/**
 * Crée l'échéancier d'une commande en tranches. DOIT être appelé dans la
 * transaction de création de commande pour qu'une commande ne puisse jamais
 * exister sans son plan.
 */
export async function createInstallmentPlan(
  tx: Tx,
  args: {
    orderId: string;
    orderNumber: string;
    buyerId: string;
    totalAmount: number;
    downPayment: number;
    months: number;
    from: Date;
  },
) {
  const plan = buildSchedule({
    total: args.totalAmount,
    downPayment: args.downPayment,
    months: args.months,
    from: args.from,
  });

  const created = await tx.installmentPlan.create({
    data: {
      orderId: args.orderId,
      totalAmount: args.totalAmount,
      downPaymentAmount: plan.downPayment,
      remainingAmount: args.totalAmount - plan.downPayment,
      monthCount: args.months,
      monthlyAmount: plan.monthly,
      lastMonthAmount: plan.last,
      dueDay: args.from.getDate(),
      installments: {
        create: plan.lines.map((l) => ({
          index: l.index,
          amountDue: l.amountDue,
          dueDate: l.dueDate,
        })),
      },
    },
  });

  return { ...created, schedule: plan };
}

export async function getSchedule(orderId: string): Promise<Schedule | null> {
  const plan = await prisma.installmentPlan.findUnique({
    where: { orderId },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  if (!plan) return null;

  const downPaid =
    plan.totalPaid >= plan.downPaymentAmount ||
    (await prisma.payment.findFirst({
      where: { orderId, type: "INITIAL_INSTALLMENT", status: "SUCCESS" },
      select: { id: true },
    })) !== null;

  const totalPaid = plan.totalPaid;
  const remainingAmount = Math.max(0, plan.totalAmount - totalPaid);
  const next = plan.installments.find((i) => i.status !== "PAID" && i.status !== "WAIVED") ?? null;

  return {
    totalAmount: plan.totalAmount,
    downPaymentAmount: plan.downPaymentAmount,
    downPaid,
    monthlyAmount: plan.monthlyAmount,
    monthCount: plan.monthCount,
    lastMonthAmount: plan.lastMonthAmount,
    totalPaid,
    remainingAmount,
    status: plan.status,
    nextDueDate: next ? next.dueDate.toISOString() : null,
    nextAmount: next ? next.amountDue - next.amountPaid : null,
    fullyPaid: remainingAmount === 0,
    installments: plan.installments.map((i) => ({
      index: i.index,
      label: `Mensualité ${i.index}/${plan.monthCount}`,
      amountDue: i.amountDue,
      dueDate: i.dueDate.toISOString(),
      amountPaid: i.amountPaid,
      status: i.status,
      paidAt: i.paidAt ? i.paidAt.toISOString() : null,
    })),
  };
}

/**
 * Encaisse une échéance. Appelée DANS la transaction de settlePayment.
 * L'apport initial n'ouvre aucun accès ; c'est la solde totale qui déclenche la
 * livraison. Idempotent : une échéance déjà SOLDEE est ignorée.
 */
export async function applyDownPayment(tx: Tx, payment: Payment): Promise<boolean> {
  const plan = await tx.installmentPlan.findUnique({
    where: { id: payment.installmentPlanId ?? "" },
  });
  if (!plan || !payment.orderId) return false;

  const alreadyCounted = plan.totalPaid >= plan.downPaymentAmount;
  const totalPaid = alreadyCounted ? plan.totalPaid : plan.totalPaid + payment.amount;

  // L'apport initial n'est PAS une Installment : il ne porte aucun index et
  // n'apparaît donc pas dans le tableau des mensualités. On ne touche qu'au
  // cumul payé du plan.
  await tx.installmentPlan.update({
    where: { id: plan.id },
    data: { totalPaid, status: "ACTIVE" },
  });

  await tx.order.update({ where: { id: payment.orderId }, data: { status: "PARTIALLY_PAID" } });

  // Échéancier ouvert : le compte est retiré de la boutique pendant le paiement.
  if (!alreadyCounted) {
    const taken = await markProductsSold(tx, payment.orderId);
    if (taken.length > 0) {
      const order = await tx.order.findUnique({ where: { id: payment.orderId }, select: { orderNumber: true } });
      await alertDoubleSale(order?.orderNumber ?? payment.orderId, taken);
    }
  }

  logger.info({ planId: plan.id, orderId: payment.orderId, totalPaid }, "[installments] apport enregistré");
  return !alreadyCounted;
}

/** Enregistre le paiement d'une mensualité. Retourne `true` si l'échéancier est soldé. */
export async function applyInstallmentPayment(tx: Tx, payment: Payment): Promise<boolean> {
  if (!payment.installmentId || !payment.installmentPlanId) return false;

  const installment = await tx.installment.findUnique({ where: { id: payment.installmentId } });
  if (!installment) return false;
  // Idempotence : échéance déjà comptée → on ne la re-marque pas.
  if (installment.status === "PAID" || installment.status === "WAIVED") {
    return (await isPlanSettled(tx, payment.installmentPlanId)) as boolean;
  }

  // Un paiement peut couvrir plusieurs mois : le montant est versé sur
  // l'échéance ciblée puis sur les suivantes, dans l'ordre.
  const queue = await tx.installment.findMany({
    where: { planId: installment.planId, index: { gte: installment.index }, status: { notIn: ["PAID", "WAIVED", "CANCELLED"] } },
    orderBy: { index: "asc" },
  });
  let remaining = payment.amount;
  for (const line of queue) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, line.amountDue - line.amountPaid);
    remaining -= take;
    const amountPaid = line.amountPaid + take;
    const paid = amountPaid >= line.amountDue;
    await tx.installment.update({
      where: { id: line.id },
      data: {
        amountPaid,
        status: paid ? "PAID" : "PENDING",
        paidAt: paid ? new Date() : null,
        // paymentId est unique : seule l'échéance ciblée porte le paiement.
        paymentId: paid && line.id === installment.id ? payment.id : null,
      },
    });
  }

  const plan = await tx.installmentPlan.findUnique({
    where: { id: payment.installmentPlanId },
  });
  if (!plan) return false;

  // On additionne les échéances RÉUSSIES plutôt que d'incrémenter à chaque
  // paiement : un encaissement rejoué ne peut pas gonfler le cumul.
  const agg = await tx.payment.aggregate({
    where: { installmentPlanId: plan.id, status: "SUCCESS" },
    _sum: { amount: true },
  });
  const totalPaid = agg._sum.amount ?? 0;
  const settled = totalPaid >= plan.totalAmount;

  await tx.installmentPlan.update({
    where: { id: plan.id },
    data: { totalPaid, status: settled ? "COMPLETED" : "ACTIVE" },
  });

  if (payment.orderId) {
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: settled ? "PAID" : "PARTIALLY_PAID" },
    });
  }

  return settled;
}

async function isPlanSettled(tx: Tx, planId: string): Promise<boolean> {
  const plan = await tx.installmentPlan.findUnique({ where: { id: planId } });
  return plan !== null && plan.totalPaid >= plan.totalAmount;
}

/**
 * Prépare le règlement de la prochaine échéance : crée un Payment ciblé sur
 * l'Installment et renvoie son token (le checkout existant suffit ensuite).
 * Le client paie ainsi mensualité par mensualité depuis « Mes achats ».
 */
export async function createNextInstallmentPayment(orderId: string, actor: InstallmentActor, months = 1) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, buyerId: true, status: true, paymentMode: true },
  });
  if (!order) throw notFound("Commande introuvable");
  if (order.buyerId !== actor.actorId) throw notFound("Commande introuvable");
  if (order.status === "REFUNDED" || order.status === "CANCELLED") {
    throw conflict("ORDER_NOT_PAYABLE", "Cette commande n'est plus payable.");
  }

  const plan = await prisma.installmentPlan.findUnique({
    where: { orderId },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  if (!plan) throw notFound("Aucun échéancier sur cette commande.");
  if (plan.totalPaid >= plan.totalAmount) {
    throw conflict("PLAN_ALREADY_PAID", "Toutes vos mensualités sont réglées.");
  }

  const open = plan.installments.filter((i) => i.status !== "PAID" && i.status !== "WAIVED" && i.status !== "CANCELLED");
  const next = open[0];
  if (!next) throw conflict("PLAN_ALREADY_PAID", "Toutes vos mensualités sont réglées.");
  if (!Number.isInteger(months) || months < 1 || months > open.length) {
    throw badRequest("VALIDATION_ERROR", `Choisissez entre 1 et ${open.length} mensualité${open.length > 1 ? "s" : ""}.`);
  }
  const covered = open.slice(0, months);
  const amount = covered.reduce((sum, i) => sum + (i.amountDue - i.amountPaid), 0);
  const last = covered[covered.length - 1]!;

  // Un règlement du même montant déjà en cours : on renvoie le même token
  // plutôt que de créer un paiement concurrent. Un montant différent (le
  // client a changé le nombre de mois) annule l'ancien.
  const pendingRows = await prisma.payment.findMany({
    where: { installmentId: next.id, status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, transactionToken: true, amount: true, status: true },
  });
  const pending = pendingRows.find((p) => p.amount === amount) ?? null;
  const stale = pendingRows.filter((p) => p.id !== pending?.id && p.status === "PENDING");
  if (stale.length > 0) {
    await prisma.payment.updateMany({ where: { id: { in: stale.map((p) => p.id) }, status: "PENDING" }, data: { status: "CANCELLED" } });
  }
  if (pending) {
    return {
      paymentId: pending.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: pending.amount,
      token: pending.transactionToken,
      already: true,
    };
  }

  const transactionToken = `mdpay_${randomBytes(18).toString("base64url")}`;

  const created = await prisma.payment.create({
    data: {
      userId: order.buyerId,
      orderId: order.id,
      installmentPlanId: plan.id,
      installmentId: next.id,
      paymentNumber: `PAY-${order.orderNumber}-M${next.index}${last.index !== next.index ? "-" + last.index : ""}-${randomInt(100, 999)}`,
      type: "INSTALLMENT",
      amount,
      currency: "XOF",
      provider: "WAVE_LINK",
      status: "PENDING",
      transactionToken,
    },
    select: { id: true },
  });

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "INSTALLMENT_PAYMENT_CREATED",
    resourceType: "InstallmentPlan",
    resourceId: plan.id,
    metadata: { orderNumber: order.orderNumber, index: next.index, months, amount },
  });

  await notifyUser(order.buyerId, "UPCOMING_INSTALLMENT", {
    title: `Mensualité ${next.index}/${plan.monthCount} à régler`,
    message: `Le montant de ${amount.toLocaleString("fr-FR")} FCFA est dû au ${new Date(next.dueDate).toLocaleDateString("fr-FR")}.`,
    actionUrl: `/account/orders/${order.id}`,
    priority: "NORMAL",
  });

  return {
    paymentId: created.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount,
    token: transactionToken,
    already: false,
  };
}

/** Marque les mensualités échues comme OVERDUE (appelé par un job ou à la lecture). */
export async function markOverdueInstallments(now = new Date()): Promise<number> {
  const res = await prisma.installment.updateMany({
    where: { status: "PENDING", dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });
  if (res.count > 0) {
    await prisma.installmentPlan.updateMany({
      where: { status: "ACTIVE", installments: { some: { status: "OVERDUE" } } },
      data: { status: "DEFAULTED" },
    });
  }
  return res.count;
}

export function assertSplittable(input: { total: number; months: number | null; downPayment: number | null }): { months: number; downPayment: number } {
  if (input.months === null || input.months < 2) {
    throw badRequest("INSTALLMENTS_UNAVAILABLE", "Cette offre n'est pas éligible au paiement en tranches.");
  }
  const downPayment = input.downPayment ?? 0;
  if (downPayment < 0 || downPayment >= input.total) {
    throw badRequest("INSTALLMENTS_UNAVAILABLE", "Apport initial invalide pour cette offre.");
  }
  return { months: input.months, downPayment };
}

// ---------------------------------------------------------------------------
// Rappels & retards — exécuté par le job quotidien (voir startInstallmentJobs).
// Chaque rappel est émis UNE SEULE fois par échéance : la recherche d'une
// notification homonyme récente sert de garde anti-doublon (pas de table
// supplémentaire, le titre intègre l'index de l'échéance).
// ---------------------------------------------------------------------------

const REMINDER_WINDOW_DAYS = 3;
const DEDUP_WINDOW_DAYS = 7;

interface Reminder {
  userId: string;
  title: string;
  params: NotifyParams;
}

function reminderKey(userId: string, title: string): string {
  return userId + "|" + title;
}

/** Rappels pour les échéances à venir (≤ 3 jours) + notification de retard. */
export async function sendInstallmentReminders(now = new Date()): Promise<{ upcoming: number; overdue: number }> {
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + REMINDER_WINDOW_DAYS);

  const [dueSoon, overdueRows] = await Promise.all([
    prisma.installment.findMany({
      where: { status: "PENDING", dueDate: { gte: now, lte: horizon } },
      include: { plan: { include: { order: { select: { orderNumber: true, buyerId: true } } } } },
      take: 200,
    }),
    prisma.installment.findMany({
      where: { status: "OVERDUE" },
      include: { plan: { include: { order: { select: { orderNumber: true, buyerId: true } } } } },
      take: 200,
    }),
  ]);

  const upcomingReminders: Reminder[] = dueSoon.map((inst) => {
    const title = `Mensualité ${inst.index}/${inst.plan.monthCount} à régler`;
    return {
      userId: inst.plan.order.buyerId,
      title,
      params: {
        title,
        message: `${(inst.amountDue - inst.amountPaid).toLocaleString("fr-FR")} FCFA dus le ${inst.dueDate.toLocaleDateString("fr-FR")} (commande ${inst.plan.order.orderNumber}).`,
        actionUrl: "/account/orders",
        priority: "NORMAL",
      },
    };
  });

  const overdueReminders: Reminder[] = overdueRows.map((inst) => {
    const title = `Mensualité ${inst.index}/${inst.plan.monthCount} en retard`;
    return {
      userId: inst.plan.order.buyerId,
      title,
      params: {
        title,
        message: `Une échéance de ${(inst.amountDue - inst.amountPaid).toLocaleString("fr-FR")} FCFA est en retard (commande ${inst.plan.order.orderNumber}). Régularisez depuis « Mes commandes ».`,
        actionUrl: "/account/orders",
        priority: "CRITICAL",
      },
    };
  });

  // Garde anti-doublon EN UNE SEULE requête : on lit les (userId, title) déjà
  // notifiés sur la fenêtre glissante, puis on filtre en mémoire. Le titre
  // intègre l'index de l'échéance : pas de table supplémentaire.
  const all = [...upcomingReminders, ...overdueReminders];
  const recent = new Set<string>();
  if (all.length > 0) {
    const since = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const found = await prisma.notification.findMany({
      where: {
        userId: { in: [...new Set(all.map((r) => r.userId))] },
        title: { in: [...new Set(all.map((r) => r.title))] },
        createdAt: { gte: since },
      },
      select: { userId: true, title: true },
    });
    for (const row of found) recent.add(reminderKey(row.userId, row.title));
  }

  const freshUpcoming = upcomingReminders.filter((r) => !recent.has(reminderKey(r.userId, r.title)));
  const freshOverdue = overdueReminders.filter((r) => !recent.has(reminderKey(r.userId, r.title)));

  // 2 appels EN LOT (envoi groupé) contre ~4 requêtes PAR échéance avant :
  // environ 3 requêtes au total au lieu de ~800 en run chargé.
  await notifyMany(
    "UPCOMING_INSTALLMENT",
    freshUpcoming.map((r) => ({ userId: r.userId, params: r.params })),
  );
  await notifyMany(
    "INSTALLMENT_OVERDUE",
    freshOverdue.map((r) => ({ userId: r.userId, params: r.params })),
  );

  const upcoming = freshUpcoming.length;
  const overdueNotified = freshOverdue.length;

  if (upcoming > 0 || overdueNotified > 0) {
    logger.info({ upcoming, overdue: overdueNotified }, "[installments] rappels envoyés");
  }
  return { upcoming, overdue: overdueNotified };
}

/**
 * Job périodique : marque les échéances échues (OVERDUE / plan DEFAULTED)
 * puis envoie les rappels. Lancé au démarrage de l'API (index.ts).
 */
export function startInstallmentJobs(): NodeJS.Timeout {
  const run = async () => {
    try {
      const marked = await markOverdueInstallments();
      if (marked > 0) logger.info({ marked }, "[installments] échéances marquées en retard");
      await sendInstallmentReminders();
    } catch (err) {
      logger.error({ err }, "[installments] échec du job d'échéancier");
    }
  };
  void run(); // exécution immédiate au démarrage
  // Toutes les 6 heures : assez fin pour les rappels J-3, assez large pour un
  // job sans file d'attente (marqueurs idempotents, notifications anti-doublon).
  const timer = setInterval(() => void run(), 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
