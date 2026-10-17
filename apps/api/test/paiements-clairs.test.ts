// Paiements plus clairs : pas de contrat avant l'apport, compte acheté retiré
// de la boutique (et des commandes non payées des autres clients), effacement
// d'un paiement de test.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { SUITE_STARTED_AT, buildMiniApp, cleanup, createAdmin, createProduct, createUser, track, tracker } from "./helpers.js";
import { createOrder, createOrderSchema, getMyOrder, listMyOrders } from "../src/modules/orders/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { listPlans } from "../src/modules/admin-ops/service.js";
import { listReceivables } from "../src/modules/admin-ops/finance.js";
import { purgeTestPayment } from "../src/modules/admin-ops/purge-order.js";
import { releaseOtherBuyers } from "../src/modules/orders/fulfillment.js";
import { registerCatalogueRoutes } from "../src/modules/catalogue/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function monthlyOrder(product: { id: string }) {
  const buyer = await createUser(t, { kycVerified: true });
  const order = await createOrder(createOrderSchema.parse({ productId: product.id, paymentMode: "INSTALLMENTS" }), { actorId: buyer.id });
  track(t, "orderIds", order.orderId);
  const apport = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  return { buyer, order, apport };
}

describe("Pas de contrat avant l'apport", () => {
  it("le contrat n'apparaît nulle part avant l'apport, puis démarre le jour de sa validation", async () => {
    const product = await createProduct(t, { basePrice: 40_000, paymentMode: "INSTALLMENTS", installmentMonths: 3, installmentDownPayment: 10_000, withCredential: true });
    const { buyer, order, apport } = await monthlyOrder(product);

    // Avant : le client ne voit que l'apport à payer ; la console ne voit pas de contrat.
    const before = await getMyOrder(order.orderId, buyer.id);
    expect(before.schedule).toBeNull();
    expect(before.payments.find((p) => p.type === "INITIAL_INSTALLMENT")?.status).toBe("PENDING");
    expect((await listPlans({ page: 1, perPage: 100, q: order.orderNumber })).items).toHaveLength(0);
    expect((await listReceivables({ page: 1, perPage: 100, status: "all", q: order.orderNumber })).items).toHaveLength(0);

    // On antidate la commande : les échéances doivent partir de la validation, pas de la commande.
    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId: order.orderId } });
    const old = new Date(Date.now() - 10 * 86_400_000);
    await prisma.installment.updateMany({ where: { planId: plan.id }, data: { dueDate: old } });

    await settlePayment({ id: apport.id }, "SUCCESS", { source: "ADMIN" });
    const after = await getMyOrder(order.orderId, buyer.id);
    expect(after.schedule).not.toBeNull();
    const first = await prisma.installment.findFirstOrThrow({ where: { planId: plan.id, index: 1 } });
    const expected = new Date();
    expected.setMonth(expected.getMonth() + 1);
    expect(Math.abs(first.dueDate.getTime() - expected.getTime())).toBeLessThan(5 * 60_000);
    expect((await listPlans({ page: 1, perPage: 100, q: order.orderNumber })).items).toHaveLength(1);
  });
});

describe("Compte acheté", () => {
  it("quitte la boutique dès la preuve envoyée, sa page dit « plus disponible », il revient si la preuve est refusée", async () => {
    const product = await createProduct(t, { title: `Achat ${Date.now().toString(36)}`, withCredential: true });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder(createOrderSchema.parse({ productId: product.id }), { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerCatalogueRoutes, { prefix: "/api" });
    });
    const listed = async () =>
      ((await app.inject({ method: "GET", url: `/api/catalogue?q=${encodeURIComponent(product.title)}` })).json().data as Array<{ id: string }>).map((p) => p.id);

    expect(await listed()).toContain(product.id);
    await prisma.payment.updateMany({ where: { orderId: order.orderId }, data: { status: "PROCESSING" } });
    expect(await listed()).not.toContain(product.id);
    const page = await app.inject({ method: "GET", url: `/api/catalogue/${product.slug}` });
    expect(page.statusCode).toBe(410);
    expect(page.json().error).toMatchObject({ code: "PRODUCT_UNAVAILABLE", details: { title: product.title } });

    // Preuve refusée : le paiement repasse en attente, le compte revient en vente.
    await prisma.payment.updateMany({ where: { orderId: order.orderId }, data: { status: "PENDING" } });
    expect(await listed()).toContain(product.id);
    await app.close();
  });

  it("retire les commandes non payées des autres clients et les prévient", async () => {
    const product = await createProduct(t, { withCredential: true });
    const early = await createUser(t, { kycVerified: true });
    const abandoned = await createOrder(createOrderSchema.parse({ productId: product.id }), { actorId: early.id });
    track(t, "orderIds", abandoned.orderId);
    // Réservation de 20 minutes passée : un autre client peut acheter.
    await prisma.order.update({ where: { id: abandoned.orderId }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });

    const buyer = await createUser(t, { kycVerified: true });
    const bought = await createOrder(createOrderSchema.parse({ productId: product.id }), { actorId: buyer.id });
    track(t, "orderIds", bought.orderId);
    await prisma.payment.updateMany({ where: { orderId: bought.orderId }, data: { status: "PROCESSING" } });

    expect(await releaseOtherBuyers(bought.orderId)).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: abandoned.orderId } })).status).toBe("CANCELLED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: bought.orderId } })).status).toBe("PENDING_PAYMENT");
    expect((await listMyOrders(early.id)).map((o) => o.id)).not.toContain(abandoned.orderId);
    expect(
      await prisma.notification.count({ where: { userId: early.id, title: "Ce compte n’est plus disponible", createdAt: { gte: SUITE_STARTED_AT } } }),
    ).toBe(1);
  });
});

describe("Effacer un paiement de test", () => {
  it("un paiement de commande efface toute la commande ; un autre paiement disparaît seul", async () => {
    const { user: admin } = await createAdmin(t);
    const actor = { actorId: admin.id, actorRole: "ADMIN" as const };
    const product = await createProduct(t, { basePrice: 40_000, paymentMode: "INSTALLMENTS", installmentMonths: 3, installmentDownPayment: 10_000, withCredential: true });
    const { order, apport } = await monthlyOrder(product);
    await settlePayment({ id: apport.id }, "SUCCESS", { source: "ADMIN" });

    expect((await purgeTestPayment(apport.id, actor)).scope).toBe("order");
    expect(await prisma.order.findUnique({ where: { id: order.orderId } })).toBeNull();
    expect(await prisma.installmentPlan.count({ where: { orderId: order.orderId } })).toBe(0);

    const seller = await createUser(t, { role: "VENDOR" });
    const fee = await prisma.payment.create({
      data: { userId: seller.id, paymentNumber: `PAY-TEST-${Date.now()}`, type: "SELLER_REGISTRATION_FEE", amount: 1000, currency: "XOF", provider: "WAVE_LINK", status: "SUCCESS", paidAt: new Date() },
    });
    expect((await purgeTestPayment(fee.id, actor)).scope).toBe("payment");
    expect(await prisma.payment.findUnique({ where: { id: fee.id } })).toBeNull();
  });
});
