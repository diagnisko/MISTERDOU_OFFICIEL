// Paiements : règlement d'un paiement (succès, échec, idempotence), état de la
// page de paiement Wave et routes in-process. Le parcours de preuve Wave est
// couvert par payment-proofs.test.ts.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createProduct,
  createUser,
  expectApiError,
  tracker,
  track,
} from "./helpers.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";
import { getCheckoutState, listMyPayments, settlePayment } from "../src/modules/payments/service.js";
import { createNextInstallmentPayment } from "../src/modules/installments/service.js";
import { registerPaymentRoutes } from "../src/modules/payments/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function buyer() {
  return createUser(t, { kycVerified: true });
}

async function orderPayment(userId: string, opts: { split?: boolean } = {}) {
  const product = await createProduct(
    t,
    opts.split
      ? {
          paymentMode: "INSTALLMENTS",
          installmentMonths: 4,
          installmentDownPayment: 30_000,
          basePrice: 100_000,
        }
      : { basePrice: 50_000 },
  );
  const res = await createOrder(
    createOrderSchema.parse({
      productId: product.id,
      paymentMode: opts.split ? "INSTALLMENTS" : "ONE_TIME",
    }),
    { actorId: userId },
  );
  track(t, "orderIds", res.orderId);
  return { ...res, productId: product.id };
}

describe("settlePayment — porte unique de règlement", () => {
  it("confirme un paiement de commande : SUCCESS, livraison et notification", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const result = await settlePayment({ id: payment.id }, "SUCCESS", {
      source: "MANUAL",
      providerReference: "PAY-REF-1",
      ctx: { ip: "127.0.0.1" },
    });
    expect(result).toMatchObject({ status: "SUCCESS", already: false, amount: 50_000 });

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe("SUCCESS");
    expect(row.providerReference).toBe("PAY-REF-1");
    expect(row.paidAt).not.toBeNull();
    expect(row.verifiedAt).not.toBeNull();

    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.deliveredAt).not.toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, type: "PAYMENT_CONFIRMED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.priority).toBe("CRITICAL");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "PAYMENT_SUCCESS", resourceId: payment.id },
    });
    expect(audit?.severity).toBe("WARNING");
    expect(audit?.metadata).toMatchObject({ outcome: "SUCCESS", source: "MANUAL" });
  });

  it("est idempotent : un second règlement ne livre ni ne re-crédite rien", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const first = await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    expect(first.already).toBe(false);
    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });

    const second = await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    expect(second.already).toBe(true);
    expect(second.status).toBe("SUCCESS");

    const third = await settlePayment({ id: payment.id }, "FAILED", {
      source: "MANUAL",
      failureReason: "tentative tardive",
    });
    expect(third.already).toBe(true);
    expect(third.status).toBe("SUCCESS");

    const afterAll = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(afterAll.status).toBe("DELIVERED");
    expect(afterAll.deliveredAt?.getTime()).toBe(afterFirst.deliveredAt?.getTime());

    const deliveries = await prisma.auditLog.count({
      where: { action: "ORDER_DELIVERED", resourceId: order.orderId },
    });
    expect(deliveries).toBe(1);
  });

  it("enregistre un échec avec son motif et prévient l'acheteur", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const result = await settlePayment({ id: payment.id }, "FAILED", {
      source: "MANUAL",
      failureReason: "Solde insuffisant",
    });
    expect(result).toMatchObject({ status: "FAILED", already: false });

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.failureReason).toBe("Solde insuffisant");
    expect(row.paidAt).toBeNull();

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(orderRow.status).toBe("PENDING_PAYMENT");
    expect(orderRow.deliveredAt).toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, type: "SYSTEM", title: "Paiement non abouti", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.message).toContain("Solde insuffisant");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAYMENT_SETTLED", resourceId: payment.id } });
    expect(audit?.metadata).toMatchObject({ outcome: "FAILED" });
  });

  it("refuse un paiement inconnu", async () => {
    const err = await expectApiError(() =>
      settlePayment({ id: "00000000-0000-4000-8000-000000000000" }, "SUCCESS", { source: "MANUAL" }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("l'apport initial ouvre l'échéancier sans livrer le compte", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id, { split: true });
    const initial = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" },
    });

    const result = await settlePayment({ id: initial.id }, "SUCCESS", { source: "MANUAL" });
    expect(result.status).toBe("SUCCESS");

    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId: order.orderId } });
    expect(plan.totalPaid).toBe(30_000);
    expect(plan.status).toBe("ACTIVE");

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(orderRow.status).toBe("PARTIALLY_PAID");
    expect(orderRow.deliveredAt).toBeNull();
  });

  it("vit l'échéancier jusqu'au solde total puis livre le compte", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id, { split: true });
    const initial = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" },
    });
    await settlePayment({ id: initial.id }, "SUCCESS", { source: "MANUAL" });

    for (let i = 0; i < 4; i += 1) {
      const next = await createNextInstallmentPayment(order.orderId, { actorId: user.id });
      const settled = await settlePayment({ id: next.paymentId }, "SUCCESS", { source: "MANUAL" });
      expect(settled.status).toBe("SUCCESS");
    }

    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId: order.orderId } });
    expect(plan.totalPaid).toBe(100_000);
    expect(plan.status).toBe("COMPLETED");

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(orderRow.status).toBe("DELIVERED");

    // Relance : plus aucune échéance à régler.
    const err = await expectApiError(() => createNextInstallmentPayment(order.orderId, { actorId: user.id }));
    expect(err.code).toBe("PLAN_ALREADY_PAID");
  });

});

describe("Page de paiement Wave", () => {
  it("refuse un token inconnu et n'expose plus de lien une fois le paiement soldé", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    await expect(getCheckoutState("mdpay_inconnu")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const pending = await getCheckoutState(order.token);
    expect(pending).toMatchObject({ status: "PENDING", amount: 50_000, proof: null });

    await settlePayment(
      { id: (await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } })).id },
      "SUCCESS",
      { source: "MANUAL" },
    );
    const done = await getCheckoutState(order.token);
    expect(done).toMatchObject({ status: "SUCCESS", waveLink: null });
  });

  it("crée chaque paiement pour Wave (aucun autre prestataire)", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(payment.provider).toBe("WAVE_LINK");
  });

  it("listMyPayments expose l'historique sans donnée sensible", async () => {
    const user = await buyer();
    await orderPayment(user.id);
    const list = await listMyPayments(user.id);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("paymentNumber");
    expect(JSON.stringify(list)).not.toMatch(/token|password|hash/i);
  });
});

describe("Routes paiements (inject)", () => {
  it("historique et état passent par les routes ; plus de checkout ni de webhook externe", async () => {
    const user = await buyer();
    const app = await buildMiniApp({ auth: await authFor(user.id) }, async (instance) => {
      await instance.register(registerPaymentRoutes, { prefix: "/api/v1" });
    });

    const history = await app.inject({ method: "GET", url: "/api/v1/payments" });
    expect(history.statusCode).toBe(200);
    expect(history.json().ok).toBe(true);

    const state = await app.inject({ method: "GET", url: "/api/v1/payments/mdpay_inconnu" });
    expect(state.statusCode).toBe(404);

    const checkout = await app.inject({ method: "POST", url: "/api/v1/payments/mdpay_x/checkout", payload: { method: "wave" } });
    expect(checkout.statusCode).toBe(404);
    const webhook = await app.inject({ method: "POST", url: "/api/v1/webhooks/paytech", payload: {} });
    expect(webhook.statusCode).toBe(404);
    await app.close();
  });
});

describe("Paiement annulé", () => {
  it("un paiement annulé reste clos et ne peut plus être confirmé", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const cancelled = await settlePayment({ id: payment.id }, "CANCELLED", {
      source: "MANUAL",
      failureReason: "Le client a abandonné le paiement",
      ctx: { ip: "127.0.0.1" },
    });
    expect(cancelled).toMatchObject({ status: "CANCELLED", already: false });

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.failureReason).toBe("Le client a abandonné le paiement");

    const audit = await prisma.auditLog.findFirst({
      where: { resourceId: payment.id, action: "PAYMENT_SETTLED" },
    });
    expect(audit?.metadata).toMatchObject({ outcome: "CANCELLED", source: "MANUAL" });

    // L'état reste terminal côté client, sans lien Wave.
    const state = await getCheckoutState(payment.transactionToken!);
    expect(state).toMatchObject({ status: "CANCELLED", waveLink: null });

    // Un règlement tardif (validation en double) ne réouvre jamais la porte.
    const late = await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    expect(late).toMatchObject({ status: "CANCELLED", already: true });

    // L'historique expose le motif au client.
    const history = await listMyPayments(user.id);
    const entry = history.find((p) => p.id === payment.id);
    expect(entry?.status).toBe("CANCELLED");
    expect(entry?.failureReason).toBe("Le client a abandonné le paiement");
  });
});
