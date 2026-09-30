// PHASE 13 — Paiements (§39 : « règlement d'un paiement (succès, échec,
// idempotence), webhook (signature, IP, fenêtre d'horodatage), mode local
// Wave/Orange Money »). Moteur settlePayment + routes in-process.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
import {
  getCheckoutState,
  initiateCheckout,
  listMyPayments,
  settlePayment,
} from "../src/modules/payments/service.js";
import {
  isAllowedWebhookIp,
  signWebhookBody,
  verifyWebhookSignature,
  verifyWebhookTimestamp,
} from "../src/modules/payments/paytech.js";
import { createNextInstallmentPayment } from "../src/modules/installments/service.js";
import { registerPaymentRoutes } from "../src/modules/payments/routes.js";
import { env } from "../src/env.js";

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
      source: "WEBHOOK",
      providerReference: "PAY-REF-1",
      ctx: { ip: "127.0.0.1" },
    });
    expect(result).toMatchObject({ status: "SUCCESS", already: false, amount: 50_000 });

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe("SUCCESS");
    expect(row.providerReference).toBe("PAY-REF-1");
    expect(row.paidAt).not.toBeNull();
    expect(row.verifiedAt).not.toBeNull();
    expect(row.webhookReceivedAt).not.toBeNull();

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
    expect(audit?.metadata).toMatchObject({ outcome: "SUCCESS", source: "WEBHOOK" });
  });

  it("est idempotent : un second règlement ne livre ni ne re-crédite rien", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const first = await settlePayment({ id: payment.id }, "SUCCESS", { source: "POLL" });
    expect(first.already).toBe(false);
    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });

    const second = await settlePayment({ id: payment.id }, "SUCCESS", { source: "POLL" });
    expect(second.already).toBe(true);
    expect(second.status).toBe("SUCCESS");

    const third = await settlePayment({ id: payment.id }, "FAILED", {
      source: "WEBHOOK",
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
      source: "WEBHOOK",
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
      settlePayment({ id: "00000000-0000-4000-8000-000000000000" }, "SUCCESS", { source: "DEV" }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("l'apport initial ouvre l'échéancier sans livrer le compte", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id, { split: true });
    const initial = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" },
    });

    const result = await settlePayment({ id: initial.id }, "SUCCESS", { source: "DEV" });
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
    await settlePayment({ id: initial.id }, "SUCCESS", { source: "DEV" });

    for (let i = 0; i < 4; i += 1) {
      const next = await createNextInstallmentPayment(order.orderId, { actorId: user.id });
      const settled = await settlePayment({ id: next.paymentId }, "SUCCESS", { source: "DEV" });
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

describe("Checkout local Wave / Orange Money", () => {
  it("initie un checkout local puis confirme au poll", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);

    const init = await initiateCheckout(order.token, "wave", { actorId: user.id });
    expect(init.mode).toBe("LOCAL");
    expect(init.status).toBe("PROCESSING");

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(payment.providerReference).toBe(`local-wave-${payment.paymentNumber}`);

    const state = await getCheckoutState(order.token);
    expect(state.status).toBe("SUCCESS");
    expect(state.amount).toBe(50_000);

    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(delivered.status).toBe("DELIVERED");

    // Relance du poll : déjà soldé.
    const secondState = await getCheckoutState(order.token);
    expect(secondState.status).toBe("SUCCESS");
  });

  it("relance un checkout déjà en cours sans le dupliquer", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    await initiateCheckout(order.token, "orange_money", { actorId: user.id });
    const again = await initiateCheckout(order.token, "orange_money", { actorId: user.id });
    expect(again.mode).toBe("LOCAL");
    expect(again.status).toBe("PROCESSING");

    const payments = await prisma.payment.count({ where: { orderId: order.orderId } });
    expect(payments).toBe(1);
  });

  it("refuse un token étranger ou inconnu, et clôture un paiement déjà soldé", async () => {
    const user = await buyer();
    const stranger = await buyer();
    const order = await orderPayment(user.id);

    await expect(initiateCheckout(order.token, "wave", { actorId: stranger.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(initiateCheckout("mdpay_inconnu", "wave", { actorId: user.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getCheckoutState("mdpay_inconnu")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await settlePayment(
      { id: (await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } })).id },
      "SUCCESS",
      { source: "DEV" },
    );
    const done = await initiateCheckout(order.token, "wave", { actorId: user.id });
    expect(done.mode).toBe("DONE");
  });

  it("refuse un paiement déjà clôturé (FAILED)", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    await settlePayment({ id: payment.id }, "FAILED", { source: "DEV", failureReason: "annulé" });

    const err = await expectApiError(() => initiateCheckout(order.token, "wave", { actorId: user.id }));
    expect(err.code).toBe("CONFLICT");
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

describe("Signature et garde-fous du webhook (unitaires)", () => {
  const raw = JSON.stringify({ reference: "PAY-1", amount: 1000, status: "SUCCESS" });

  it("signe et vérifie un corps brut (HMAC-SHA256)", () => {
    const signature = signWebhookBody(raw);
    expect(signature).toHaveLength(64);
    expect(verifyWebhookSignature(raw, signature)).toBe(true);
    expect(verifyWebhookSignature(raw + " ", signature)).toBe(false);
    expect(verifyWebhookSignature(raw, undefined)).toBe(false);
    expect(verifyWebhookSignature(raw, "a".repeat(64))).toBe(false);
  });

  it("applique une fenêtre d'horodatage de ±300 s", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyWebhookTimestamp(String(now))).toBe(true);
    expect(verifyWebhookTimestamp(String(now - 290))).toBe(true);
    expect(verifyWebhookTimestamp(String(now - 400))).toBe(false);
    expect(verifyWebhookTimestamp(String(now + 400))).toBe(false);
    expect(verifyWebhookTimestamp("pas-un-nombre")).toBe(false);
    expect(verifyWebhookTimestamp(undefined)).toBe(false);
  });

  it("filtre les IP du webhook si une liste est déclarée", () => {
    const previous = env.PAYTECH_WEBHOOK_IPS;
    try {
      env.PAYTECH_WEBHOOK_IPS = undefined;
      expect(isAllowedWebhookIp("203.0.113.7")).toBe(true);

      env.PAYTECH_WEBHOOK_IPS = "203.0.113.7, 198.51.100.4";
      expect(isAllowedWebhookIp("203.0.113.7")).toBe(true);
      expect(isAllowedWebhookIp("198.51.100.4")).toBe(true);
      expect(isAllowedWebhookIp("192.0.2.1")).toBe(false);
    } finally {
      env.PAYTECH_WEBHOOK_IPS = previous;
    }
  });
});

describe("Routes paiements (inject)", () => {
  const webhookPath = env.PAYTECH_WEBHOOK_PATH.replace(/^\/api\/v1(?=\/|$)/, "") || "/webhooks/paytech";

  function sign(payload: unknown): { raw: string; signature: string } {
    const raw = JSON.stringify(payload);
    return { raw, signature: signWebhookBody(raw) };
  }

  async function postWebhook(
    app: Awaited<ReturnType<typeof buildMiniApp>>,
    payload: unknown,
    opts: { signature?: string; timestamp?: string | number | null } = {},
  ) {
    const { raw, signature } = sign(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers["x-paytech-signature"] = opts.signature ?? signature;
    if (opts.timestamp !== null) {
      headers["x-paytech-timestamp"] = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
    }
    return app.inject({ method: "POST", url: `/api/v1${webhookPath}`, headers, payload: raw });
  }

  let app: Awaited<ReturnType<typeof buildMiniApp>>;

  beforeEach(async () => {
    const user = await buyer();
    app = await buildMiniApp({ auth: await authFor(user.id), rawJson: true }, async (instance) => {
      await instance.register(registerPaymentRoutes, { prefix: "/api/v1" });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("historique et checkout passent par les routes", async () => {
    const history = await app.inject({ method: "GET", url: "/api/v1/payments" });
    expect(history.statusCode).toBe(200);
    expect(history.json().ok).toBe(true);

    const badMethod = await app.inject({
      method: "POST",
      url: "/api/v1/payments/mdpay_x/checkout",
      payload: { method: "paypal" },
    });
    expect(badMethod.statusCode).toBe(400);
    expect(badMethod.json().error.code).toBe("VALIDATION_ERROR");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/payments/mdpay_inconnu/checkout",
      payload: { method: "wave" },
    });
    expect(unknown.statusCode).toBe(404);

    const state = await app.inject({ method: "GET", url: "/api/v1/payments/mdpay_inconnu" });
    expect(state.statusCode).toBe(404);
  });

  it("webhook : signature invalide → 401 et journal WEBHOOK_REJECTED critique", async () => {
    const res = await postWebhook(app, { reference: "PAY-X", amount: 1000, status: "SUCCESS" }, {
      signature: "f".repeat(64),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "WEBHOOK_REJECTED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(audit?.severity).toBe("CRITICAL");
    expect(audit?.metadata).toMatchObject({ reason: "signature" });
  });

  it("webhook : horodatage hors fenêtre → 400", async () => {
    const payload = { reference: "PAY-X", amount: 1000, status: "SUCCESS" as const };
    const stale = await postWebhook(app, payload, { timestamp: Math.floor(Date.now() / 1000) - 900 });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().error.message).toContain("Horodatage");

    const missing = await postWebhook(app, payload, { timestamp: null });
    expect(missing.statusCode).toBe(400);
  });

  it("webhook : corps vide ou payload invalide → 400", async () => {
    const { raw, signature } = sign({ reference: "PAY-X", amount: 1000, status: "SUCCESS" });
    const empty = await app.inject({
      method: "POST",
      url: `/api/v1${webhookPath}`,
      headers: { "content-type": "application/json", "x-paytech-signature": signWebhookBody(""), "x-paytech-timestamp": String(Math.floor(Date.now() / 1000)) },
      payload: "",
    });
    expect([400, 404]).toContain(empty.statusCode);

    const badStatus = await postWebhook(app, { reference: raw.slice(0, 3), amount: 1, status: "WHATEVER" });
    expect(badStatus.statusCode).toBe(400);

    const unknownReference = await postWebhook(app, {
      reference: "PAY-INCONNU-123",
      amount: 1000,
      status: "SUCCESS",
    });
    expect(unknownReference.statusCode).toBe(404);

    expect(signature).toHaveLength(64);
  });

  it("webhook : montant divergent → 400 et journal critique", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const res = await postWebhook(app, {
      reference: payment.paymentNumber,
      amount: payment.amount + 500,
      status: "SUCCESS",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("Montant divergent");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "WEBHOOK_AMOUNT_MISMATCH", resourceId: payment.id },
    });
    expect(audit?.severity).toBe("CRITICAL");
    expect(audit?.metadata).toMatchObject({ expected: payment.amount });

    const still = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(still.status).toBe("PENDING");
  });

  it("webhook : succès signé → 200, puis rejeu idempotent ; échec signé → FAILED", async () => {
    const user = await buyer();
    const first = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: first.orderId } });

    const ok = await postWebhook(app, {
      reference: payment.paymentNumber,
      amount: payment.amount,
      status: "SUCCESS",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ received: true, idempotent: false, status: "SUCCESS" });

    const replay = await postWebhook(app, {
      reference: payment.paymentNumber,
      amount: payment.amount,
      status: "SUCCESS",
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ idempotent: true, status: "SUCCESS" });

    const second = await orderPayment(user.id);
    const payment2 = await prisma.payment.findFirstOrThrow({ where: { orderId: second.orderId } });
    const failed = await postWebhook(app, {
      reference: payment2.paymentNumber,
      amount: payment2.amount,
      status: "FAILED",
      failure_reason: "Transaction refusée",
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().data.status).toBe("FAILED");
    const row2 = await prisma.payment.findUniqueOrThrow({ where: { id: payment2.id } });
    expect(row2.failureReason).toBe("Transaction refusée");
  });

  it("webhook : IP refusée si une liste d'adresses est déclarée", async () => {
    const previous = env.PAYTECH_WEBHOOK_IPS;
    try {
      env.PAYTECH_WEBHOOK_IPS = "203.0.113.99";
      const user = await buyer();
      const order = await orderPayment(user.id);
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
      const res = await postWebhook(app, {
        reference: payment.paymentNumber,
        amount: payment.amount,
        status: "SUCCESS",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
      const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(row.status).toBe("PENDING");
    } finally {
      env.PAYTECH_WEBHOOK_IPS = previous;
    }
  });

  it("webhook : statut CANCELLED clôture le paiement sans livrer la commande", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const res = await postWebhook(app, {
      reference: payment.paymentNumber,
      amount: payment.amount,
      status: "CANCELLED",
      failure_reason: "Annulé par le client",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("CANCELLED");

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.failureReason).toBe("Annulé par le client");
    expect(row.paidAt).toBeNull();

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(orderRow.status).toBe("PENDING_PAYMENT");
    expect(orderRow.deliveredAt).toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, title: "Paiement non abouti", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.message).toContain("Annulé par le client");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "PAYMENT_SETTLED", resourceId: payment.id, createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(audit?.metadata).toMatchObject({ outcome: "CANCELLED" });

    // Le paiement clôturé n'accepte plus aucun règlement, y compris un succès.
    const replay = await settlePayment({ id: payment.id }, "SUCCESS", { source: "POLL" });
    expect(replay).toMatchObject({ status: "CANCELLED", already: true });
    const finalRow = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalRow.status).toBe("CANCELLED");
  });
});

describe("Paiement annulé — parcours checkout", () => {
  it("un paiement annulé bloque le checkout et ne peut être relancé", async () => {
    const user = await buyer();
    const order = await orderPayment(user.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });

    const cancelled = await settlePayment({ id: payment.id }, "CANCELLED", {
      source: "WEBHOOK",
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
    expect(audit?.metadata).toMatchObject({ outcome: "CANCELLED", source: "WEBHOOK" });

    // Relance d'un paiement déjà clôturé → conflit explicite.
    const relaunch = await initiateCheckout(payment.transactionToken!, "wave", {
      actorId: user.id,
    }).catch((err: unknown) => err);
    expect(relaunch).toMatchObject({ code: "CONFLICT" });

    // L'état du checkout reste terminal côté client.
    const state = await getCheckoutState(payment.transactionToken!);
    expect(state.status).toBe("CANCELLED");

    // Un règlement tardif (webhook dupliqué) ne réouvre jamais la porte.
    const late = await settlePayment({ id: payment.id }, "SUCCESS", { source: "WEBHOOK" });
    expect(late).toMatchObject({ status: "CANCELLED", already: true });

    // L'historique expose le motif au client.
    const history = await listMyPayments(user.id);
    const entry = history.find((p) => p.id === payment.id);
    expect(entry?.status).toBe("CANCELLED");
    expect(entry?.failureReason).toBe("Le client a abandonné le paiement");
  });
});
