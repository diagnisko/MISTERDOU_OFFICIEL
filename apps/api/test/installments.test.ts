// PHASE 13 — Échéanciers (§39 : « création d'un échéancier, échéances,
// mensualités, retards, rappels »). Découpe, lecture, règlement de la
// prochaine échéance, job de retards et rappels J-3.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createProduct,
  createUser,
  tracker,
  track,
} from "./helpers.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";
import {
  assertSplittable,
  buildSchedule,
  createNextInstallmentPayment,
  getSchedule,
  markOverdueInstallments,
  sendInstallmentReminders,
} from "../src/modules/installments/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { registerInstallmentRoutes } from "../src/modules/installments/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function splitOrder(
  userId: string,
  opts: { months?: number; downPayment?: number; basePrice?: number } = {},
) {
  const product = await createProduct(t, {
    paymentMode: "INSTALLMENTS",
    installmentMonths: opts.months ?? 4,
    installmentDownPayment: opts.downPayment ?? 30_000,
    basePrice: opts.basePrice ?? 100_000,
  });
  const res = await createOrder(
    createOrderSchema.parse({ productId: product.id, paymentMode: "INSTALLMENTS" }),
    { actorId: userId },
  );
  track(t, "orderIds", res.orderId);
  return { ...res, productId: product.id };
}

describe("Découpe d'un échéancier (buildSchedule)", () => {
  const from = new Date("2026-09-27T12:00:00.000Z");

  it("découpe apport + mensualités sans perte ni gain de centime", () => {
    const plan = buildSchedule({ total: 100_000, downPayment: 30_000, months: 4, from });
    expect(plan.downPayment).toBe(30_000);
    expect(plan.monthly).toBe(17_500);
    expect(plan.last).toBe(17_500);
    expect(plan.lines).toHaveLength(4);
    expect(plan.lines.reduce((n, l) => n + l.amountDue, 0)).toBe(70_000);
    expect(plan.lines.at(-1)?.amountDue).toBe(17_500);
    expect(plan.lines[0]?.dueDate.getMonth()).toBe(from.getMonth() + 1);
    expect(plan.lines[0]?.dueDate.getDate()).toBe(from.getDate());
  });

  it("arrondit la mensualité à la centaine et absorbe l'arrondi sur la dernière", () => {
    const plan = buildSchedule({ total: 100_000, downPayment: 0, months: 3, from });
    expect(plan.monthly).toBe(33_300);
    expect(plan.last).toBe(33_400);
    expect(plan.lines.reduce((n, l) => n + l.amountDue, 0)).toBe(100_000);
    expect(plan.lines.every((l) => l.amountDue % 100 === 0 || l === plan.lines.at(-1))).toBe(true);
  });

  it("garde une mensualité minimale de 100 FCFA sur un petit reste", () => {
    const plan = buildSchedule({ total: 150, downPayment: 0, months: 2, from });
    expect(plan.monthly).toBe(100);
    expect(plan.last).toBe(50);
    expect(plan.lines.reduce((n, l) => n + l.amountDue, 0)).toBe(150);
  });

  it("clampe l'apport au total de la commande", () => {
    const plan = buildSchedule({ total: 100_000, downPayment: 120_000, months: 2, from });
    expect(plan.downPayment).toBe(100_000);
  });

  it("assertSplittable refuse un offre sans mois ou un apport hors borne", () => {
    expect(assertSplittable({ total: 100_000, months: 4, downPayment: 30_000 })).toEqual({
      months: 4,
      downPayment: 30_000,
    });
    expect(() => assertSplittable({ total: 100_000, months: null, downPayment: 10_000 })).toThrowError(
      expect.objectContaining({ code: "INSTALLMENTS_UNAVAILABLE" }),
    );
    expect(() => assertSplittable({ total: 100_000, months: 1, downPayment: 10_000 })).toThrowError(
      expect.objectContaining({ code: "INSTALLMENTS_UNAVAILABLE" }),
    );
    expect(() => assertSplittable({ total: 100_000, months: 3, downPayment: 100_000 })).toThrowError(
      expect.objectContaining({ code: "INSTALLMENTS_UNAVAILABLE" }),
    );
    expect(() => assertSplittable({ total: 100_000, months: 3, downPayment: -1 })).toThrowError(
      expect.objectContaining({ code: "INSTALLMENTS_UNAVAILABLE" }),
    );
  });
});

describe("Lecture de l'échéancier", () => {
  it("retourne le tableau complet, le reste dû et la prochaine échéance", async () => {
    const user = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);

    const schedule = await getSchedule(order.orderId);
    expect(schedule).not.toBeNull();
    expect(schedule?.totalAmount).toBe(100_000);
    expect(schedule?.downPaymentAmount).toBe(30_000);
    expect(schedule?.downPaid).toBe(false);
    expect(schedule?.monthCount).toBe(4);
    expect(schedule?.monthlyAmount).toBe(17_500);
    expect(schedule?.totalPaid).toBe(0);
    expect(schedule?.remainingAmount).toBe(100_000);
    expect(schedule?.fullyPaid).toBe(false);
    expect(schedule?.status).toBe("ACTIVE");
    expect(schedule?.nextAmount).toBe(17_500);
    expect(schedule?.installments).toHaveLength(4);
    expect(schedule?.installments[0]).toMatchObject({
      index: 1,
      label: "Mensualité 1/4",
      status: "PENDING",
      amountPaid: 0,
    });

    const initial = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" },
    });
    await settlePayment({ id: initial.id }, "SUCCESS", { source: "MANUAL" });

    const afterDown = await getSchedule(order.orderId);
    expect(afterDown?.downPaid).toBe(true);
    expect(afterDown?.totalPaid).toBe(30_000);
    expect(afterDown?.remainingAmount).toBe(70_000);

    const none = await getSchedule("00000000-0000-4000-8000-000000000000");
    expect(none).toBeNull();
  });

  it("passe au plan soldé quand la totalité est encaissée", async () => {
    const user = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);
    const initial = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" },
    });
    await settlePayment({ id: initial.id }, "SUCCESS", { source: "MANUAL" });

    for (let i = 0; i < 4; i += 1) {
      const next = await createNextInstallmentPayment(order.orderId, { actorId: user.id });
      await settlePayment({ id: next.paymentId }, "SUCCESS", { source: "MANUAL" });
    }

    const schedule = await getSchedule(order.orderId);
    expect(schedule?.totalPaid).toBe(100_000);
    expect(schedule?.remainingAmount).toBe(0);
    expect(schedule?.fullyPaid).toBe(true);
    expect(schedule?.status).toBe("COMPLETED");
    expect(schedule?.nextDueDate).toBeNull();
    expect(schedule?.nextAmount).toBeNull();
    expect(schedule?.downPaid).toBe(true);
    expect(schedule?.installments.every((i) => i.status === "PAID")).toBe(true);
  });
});

describe("Règlement de la prochaine échéance", () => {
  it("refuse les tiers, les commandes sans échéancier et les commandes clôturées", async () => {
    const owner = await createUser(t, { kycVerified: true });
    const stranger = await createUser(t, { kycVerified: true });
    const split = await splitOrder(owner.id);

    await expect(
      createNextInstallmentPayment(split.orderId, { actorId: stranger.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const plainProduct = await createProduct(t, { paymentMode: "ONE_TIME" });
    const plain = await createOrder(createOrderSchema.parse({ productId: plainProduct.id }), {
      actorId: owner.id,
    });
    track(t, "orderIds", plain.orderId);
    await expect(
      createNextInstallmentPayment(plain.orderId, { actorId: owner.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await prisma.order.update({ where: { id: split.orderId }, data: { status: "REFUNDED" } });
    await expect(
      createNextInstallmentPayment(split.orderId, { actorId: owner.id }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE" });

    await expect(
      createNextInstallmentPayment("00000000-0000-4000-8000-000000000000", { actorId: owner.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("crée un paiement ciblé sur l'échéance, le journalise et notifie (puis réutilise)", async () => {
    const user = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);
    // L'apport d'abord : les mois se paient ensuite (ou avec lui).
    const down = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" } });
    await settlePayment({ id: down.id }, "SUCCESS", { source: "MANUAL" });

    const first = await createNextInstallmentPayment(order.orderId, { actorId: user.id });
    expect(first.already).toBe(false);
    expect(first.amount).toBe(17_500);
    expect(first.token).toMatch(/^mdpay_/);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: first.paymentId } });
    expect(payment).toMatchObject({ type: "INSTALLMENT", status: "PENDING", userId: user.id });
    expect(payment.installmentId).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "INSTALLMENT_PAYMENT_CREATED" },
    });
    expect(audit?.metadata).toMatchObject({ index: 1, amount: 17_500 });

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, type: "UPCOMING_INSTALLMENT", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.title).toBe("Mensualité 1/4 à régler");

    const second = await createNextInstallmentPayment(order.orderId, { actorId: user.id });
    expect(second.already).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.token).toBe(first.token);

    const payments = await prisma.payment.count({ where: { orderId: order.orderId } });
    expect(payments).toBe(2);
  });
});

describe("Retards et rappels (jobs)", () => {
  it("marque les échéances échues en OVERDUE et le plan en DEFAULTED", async () => {
    const user = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);
    const installments = await prisma.installment.findMany({
      where: { plan: { orderId: order.orderId } },
      orderBy: { index: "asc" },
    });
    const late = installments[1];
    if (!late) throw new Error("[tests] échéance manquante");
    await prisma.installment.update({
      where: { id: late.id },
      data: { dueDate: new Date(Date.now() - 24 * 3_600_000) },
    });

    // Garde-fou : aucune échéance PENDING du jeu dev n'est échue (3 à venir),
    // le job ne peut donc PAS modifier de données hors test.
    const devPendingOverdue = await prisma.installment.count({
      where: {
        status: "PENDING",
        dueDate: { lt: new Date() },
        plan: { order: { buyer: { email: { not: { startsWith: "p13-" } } } } },
      },
    });
    expect(devPendingOverdue).toBe(0);

    const marked = await markOverdueInstallments();
    expect(marked).toBeGreaterThanOrEqual(1);

    const row = await prisma.installment.findUniqueOrThrow({ where: { id: late.id } });
    expect(row.status).toBe("OVERDUE");

    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId: order.orderId } });
    expect(plan.status).toBe("DEFAULTED");
  });

  it("envoie le rappel J-3 une seule fois puis se tait (anti-doublon)", async () => {
    const user = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);
    const installments = await prisma.installment.findMany({
      where: { plan: { orderId: order.orderId } },
      orderBy: { index: "asc" },
    });
    const soon = installments[0];
    if (!soon) throw new Error("[tests] échéance manquante");
    await prisma.installment.update({
      where: { id: soon.id },
      data: { dueDate: new Date(Date.now() + 2 * 24 * 3_600_000) },
    });

    const first = await sendInstallmentReminders();
    expect(first.upcoming).toBeGreaterThanOrEqual(1);

    const reminders = await prisma.notification.findMany({
      where: { userId: user.id, type: "UPCOMING_INSTALLMENT", title: "Mensualité 1/4 à régler" },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.message).toContain("FCFA dus le");

    const second = await sendInstallmentReminders();
    const afterSecond = await prisma.notification.count({
      where: { userId: user.id, type: "UPCOMING_INSTALLMENT", title: "Mensualité 1/4 à régler" },
    });
    expect(afterSecond).toBe(1);
    expect(second.upcoming).toBeGreaterThanOrEqual(0);
  });

  it("notifie les retards en critique (INSTALLMENT_OVERDUE), une seule fois", async () => {
    const user = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);
    const installments = await prisma.installment.findMany({
      where: { plan: { orderId: order.orderId } },
      orderBy: { index: "asc" },
    });
    const late = installments[0];
    if (!late) throw new Error("[tests] échéance manquante");
    await prisma.installment.update({
      where: { id: late.id },
      data: { dueDate: new Date(Date.now() - 2 * 24 * 3_600_000) },
    });
    await markOverdueInstallments();

    const result = await sendInstallmentReminders();
    expect(result.overdue).toBeGreaterThanOrEqual(1);

    const alerts = await prisma.notification.findMany({
      where: { userId: user.id, type: "INSTALLMENT_OVERDUE", title: "Mensualité 1/4 en retard" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.priority).toBe("CRITICAL");

    await sendInstallmentReminders();
    const afterSecond = await prisma.notification.count({
      where: { userId: user.id, type: "INSTALLMENT_OVERDUE", title: "Mensualité 1/4 en retard" },
    });
    expect(afterSecond).toBe(1);
  });
});

describe("Routes échéanciers (inject)", () => {
  it("GET /orders/:id/installments : propriétaire, tiers et non connecté", async () => {
    const owner = await createUser(t, { kycVerified: true });
    const stranger = await createUser(t, { kycVerified: true });
    const order = await splitOrder(owner.id);

    const anon = await buildMiniApp({ auth: null }, async (app) => {
      await app.register(registerInstallmentRoutes, { prefix: "/api/v1" });
    });
    const unauthenticated = await anon.inject({ method: "GET", url: `/api/v1/orders/${order.orderId}/installments` });
    expect(unauthenticated.statusCode).toBe(401);
    await anon.close();

    const opts = { auth: await authFor(owner.id) };
    const app = await buildMiniApp(opts, async (instance) => {
      await instance.register(registerInstallmentRoutes, { prefix: "/api/v1" });
    });

    const mine = await app.inject({ method: "GET", url: `/api/v1/orders/${order.orderId}/installments` });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.schedule).not.toBeNull();
    expect(mine.json().data.schedule.installments).toHaveLength(4);

    opts.auth = await authFor(stranger.id);
    const foreign = await app.inject({ method: "GET", url: `/api/v1/orders/${order.orderId}/installments` });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().data.schedule).toBeNull();

    opts.auth = await authFor(owner.id);
    const badId = await app.inject({ method: "GET", url: "/api/v1/orders/pas-une-uuid/installments" });
    expect(badId.statusCode).toBe(400);

    await app.close();
  });

  it("POST /orders/:id/installments/pay : token de checkout puis paiement déjà en attente", async () => {
    const user = await createUser(t, { kycVerified: true });
    const stranger = await createUser(t, { kycVerified: true });
    const order = await splitOrder(user.id);
    // L'apport d'abord : les mois se paient ensuite (ou avec lui).
    const down = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" } });
    await settlePayment({ id: down.id }, "SUCCESS", { source: "MANUAL" });

    const opts = { auth: await authFor(user.id) };
    const app = await buildMiniApp(opts, async (instance) => {
      await instance.register(registerInstallmentRoutes, { prefix: "/api/v1" });
    });

    const first = await app.inject({ method: "POST", url: `/api/v1/orders/${order.orderId}/installments/pay` });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ alreadyPending: false, amount: 17_500 });
    expect(first.json().data.checkoutUrl).toMatch(/^\/checkout\/mdpay_/);

    const second = await app.inject({ method: "POST", url: `/api/v1/orders/${order.orderId}/installments/pay` });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.alreadyPending).toBe(true);

    opts.auth = await authFor(stranger.id);
    const foreign = await app.inject({ method: "POST", url: `/api/v1/orders/${order.orderId}/installments/pay` });
    expect(foreign.statusCode).toBe(404);

    opts.auth = await authFor(user.id);
    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "INSTALLMENT_PAY_REQUESTED", resourceId: order.orderId },
    });
    expect(audit?.metadata).toMatchObject({ already: false });

    await app.close();
  });
});
