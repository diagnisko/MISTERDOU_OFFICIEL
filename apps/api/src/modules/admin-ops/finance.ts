import { prisma } from "@misterdou/db";
import type { InstallmentStatus, Prisma } from "@misterdou/db";

// ---------------------------------------------------------------------------
// Pilotage financier de la console : chiffre d'affaires, encaissé du mois,
// montant à recevoir sur les échéanciers en cours et état mois par mois.
// Mois calendaires en UTC (Sénégal = UTC+0, sans heure d'été).
// ---------------------------------------------------------------------------

const OPEN: InstallmentStatus[] = ["PENDING", "OVERDUE"];
const OPEN_PLAN = { in: ["ACTIVE", "DEFAULTED"] as ("ACTIVE" | "DEFAULTED")[] };

function monthBounds(now: Date, offset = 0) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { start, end };
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isOverdue(i: { status: InstallmentStatus; dueDate: Date }, now: Date) {
  return i.status === "OVERDUE" || (i.status === "PENDING" && i.dueDate < now);
}

export async function financeOverview(now = new Date()) {
  const current = monthBounds(now);
  const previous = monthBounds(now, -1);
  const firstMonth = monthBounds(now, -11).start;

  const [total, thisMonth, lastMonth, open, collectedRows, expectedRows] = await Promise.all([
    prisma.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
    prisma.payment.aggregate({
      where: { status: "SUCCESS", paidAt: { gte: current.start, lt: current.end } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { status: "SUCCESS", paidAt: { gte: previous.start, lt: previous.end } },
      _sum: { amount: true },
    }),
    prisma.installment.findMany({
      where: { status: { in: OPEN }, plan: { status: OPEN_PLAN } },
      select: { planId: true, amountDue: true, amountPaid: true, dueDate: true, status: true },
    }),
    prisma.$queryRaw<Array<{ month: string; total: bigint }>>`
      SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month, COALESCE(SUM(amount), 0)::bigint AS total
      FROM "Payment"
      WHERE status = 'SUCCESS' AND "paidAt" >= ${firstMonth} AND "paidAt" < ${current.end}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ month: string; total: bigint }>>`
      SELECT to_char(date_trunc('month', "dueDate"), 'YYYY-MM') AS month, COALESCE(SUM("amountDue"), 0)::bigint AS total
      FROM "Installment"
      WHERE status <> 'CANCELLED' AND "dueDate" >= ${firstMonth} AND "dueDate" < ${current.end}
      GROUP BY 1`,
  ]);

  let receivable = 0;
  let dueThisMonth = 0;
  let dueThisMonthCount = 0;
  let overdue = 0;
  let overdueCount = 0;
  const plans = new Set<string>();
  const overduePlans = new Set<string>();
  for (const i of open) {
    const left = i.amountDue - i.amountPaid;
    receivable += left;
    plans.add(i.planId);
    if (isOverdue(i, now)) {
      overdue += left;
      overdueCount += 1;
      overduePlans.add(i.planId);
    } else if (i.dueDate >= current.start && i.dueDate < current.end) {
      dueThisMonth += left;
      dueThisMonthCount += 1;
    }
  }

  const collected = new Map(collectedRows.map((r) => [r.month, Number(r.total)]));
  const expected = new Map(expectedRows.map((r) => [r.month, Number(r.total)]));
  const monthly = Array.from({ length: 12 }, (_, k) => {
    const key = monthKey(monthBounds(now, k - 11).start);
    return { month: key, collected: collected.get(key) ?? 0, expected: expected.get(key) ?? 0 };
  });

  return {
    revenueTotal: total._sum.amount ?? 0,
    collectedThisMonth: thisMonth._sum.amount ?? 0,
    collectedLastMonth: lastMonth._sum.amount ?? 0,
    receivable: { amount: receivable, plans: plans.size },
    dueThisMonth: { amount: dueThisMonth, count: dueThisMonthCount },
    overdue: { amount: overdue, count: overdueCount, plans: overduePlans.size },
    monthly,
  };
}

// ---------------------------------------------------------------------------
// Comptes en cours de paiement
// ---------------------------------------------------------------------------

export type MonthState = "OVERDUE" | "DUE" | "PAID" | "NONE";
export type ReceivableFilter = "all" | MonthState;

export interface ReceivableArgs {
  status: ReceivableFilter;
  q?: string;
  page: number;
  perPage: number;
}

const STATE_ORDER: Record<MonthState, number> = { OVERDUE: 0, DUE: 1, NONE: 2, PAID: 3 };

export async function listReceivables(args: ReceivableArgs, now = new Date()) {
  const current = monthBounds(now);
  const q = args.q?.trim();
  const where: Prisma.InstallmentPlanWhereInput = {
    status: OPEN_PLAN,
    ...(q
      ? {
          OR: [
            { order: { orderNumber: { contains: q, mode: "insensitive" } } },
            { order: { buyer: { email: { contains: q, mode: "insensitive" } } } },
            { order: { buyer: { firstName: { contains: q, mode: "insensitive" } } } },
            { order: { buyer: { lastName: { contains: q, mode: "insensitive" } } } },
            { order: { items: { some: { title: { contains: q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };

  const plans = await prisma.installmentPlan.findMany({
    where,
    take: 1000,
    select: {
      id: true,
      status: true,
      totalAmount: true,
      downPaymentAmount: true,
      monthCount: true,
      totalPaid: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          buyer: { select: { id: true, email: true, firstName: true, lastName: true } },
          items: { select: { title: true }, take: 1 },
        },
      },
      installments: {
        orderBy: { index: "asc" },
        select: { id: true, index: true, amountDue: true, amountPaid: true, dueDate: true, paidAt: true, status: true },
      },
    },
  });

  const rows = plans.map((plan) => {
    const open = plan.installments.filter((i) => OPEN.includes(i.status));
    const late = open.filter((i) => isOverdue(i, now));
    const inMonth = plan.installments.filter(
      (i) => i.status !== "CANCELLED" && i.dueDate >= current.start && i.dueDate < current.end,
    );
    const next = open.find((i) => !isOverdue(i, now)) ?? null;

    let monthState: MonthState = "NONE";
    if (late.length > 0) monthState = "OVERDUE";
    else if (inMonth.some((i) => OPEN.includes(i.status))) monthState = "DUE";
    else if (inMonth.length > 0) monthState = "PAID";

    return {
      planId: plan.id,
      planStatus: plan.status,
      orderId: plan.order.id,
      orderNumber: plan.order.orderNumber,
      product: plan.order.items[0]?.title ?? null,
      client: plan.order.buyer,
      totalAmount: plan.totalAmount,
      downPaymentAmount: plan.downPaymentAmount,
      totalPaid: plan.totalPaid,
      remaining: open.reduce((sum, i) => sum + (i.amountDue - i.amountPaid), 0),
      monthCount: plan.monthCount,
      monthsRemaining: open.length,
      overdueCount: late.length,
      overdueAmount: late.reduce((sum, i) => sum + (i.amountDue - i.amountPaid), 0),
      monthState,
      nextDue: next ? { installmentId: next.id, dueDate: next.dueDate.toISOString(), amount: next.amountDue - next.amountPaid } : null,
      schedule: plan.installments.map((i) => ({
        id: i.id,
        index: i.index,
        amountDue: i.amountDue,
        amountPaid: i.amountPaid,
        dueDate: i.dueDate.toISOString(),
        paidAt: i.paidAt?.toISOString() ?? null,
        status: isOverdue(i, now) ? ("OVERDUE" as const) : i.status,
      })),
    };
  });

  const counts: Record<ReceivableFilter, number> = { all: rows.length, OVERDUE: 0, DUE: 0, PAID: 0, NONE: 0 };
  for (const r of rows) counts[r.monthState] += 1;

  const filtered = (args.status === "all" ? rows : rows.filter((r) => r.monthState === args.status)).sort(
    (a, b) =>
      STATE_ORDER[a.monthState] - STATE_ORDER[b.monthState] ||
      (a.nextDue?.dueDate ?? "9").localeCompare(b.nextDue?.dueDate ?? "9"),
  );
  const start = (args.page - 1) * args.perPage;
  return { items: filtered.slice(start, start + args.perPage), total: filtered.length, counts };
}
