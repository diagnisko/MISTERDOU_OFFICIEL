// PHASE 13 — Commandes (§39 : « création d'une commande — statut du compte,
// KYC, produit publié, mode de paiement, quantité, recalcul serveur du
// montant, promo active appliquée ») + historique, détail et révélation.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createProduct,
  createUser,
  expectApiError,
  tracker,
  track,
} from "./helpers.js";
import {
  createOrder,
  createOrderSchema,
  getMyOrder,
  listMyOrders,
  revealCredentials,
} from "../src/modules/orders/service.js";
import { registerOrderRoutes } from "../src/modules/orders/routes.js";
import { decryptString } from "../src/lib/storage.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

function input(raw: Record<string, unknown>) {
  return createOrderSchema.parse(raw);
}

async function buyer(opts: Parameters<typeof createUser>[1] = {}) {
  return createUser(t, { kycVerified: true, ...opts });
}

async function newOrder(userId: string, productId: string, opts: Record<string, unknown> = {}) {
  const res = await createOrder(input({ productId, ...opts }), { actorId: userId });
  track(t, "orderIds", res.orderId);
  return res;
}

describe("Création d'une commande", () => {
  it("crée une commande ONE_TIME : Order, snapshot d'article, paiement et notifications", async () => {
    const user = await buyer();
    const product = await createProduct(t, { basePrice: 50_000 });

    const res = await newOrder(user.id, product.id);

    expect(res.amount).toBe(50_000);
    expect(res.orderNumber).toMatch(/^MD-\d{4}-\d{7}$/);
    expect(res.token).toMatch(/^mdpay_/);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.orderId },
      include: { items: true, payments: true },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.buyerId).toBe(user.id);
    expect(order.paymentMode).toBe("ONE_TIME");
    expect(order.totalAmount).toBe(50_000);
    expect(order.discountAmount).toBe(0);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      productId: product.id,
      title: product.title,
      unitPrice: 50_000,
      quantity: 1,
    });
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({
      type: "ORDER_PAYMENT",
      amount: 50_000,
      status: "PENDING",
      transactionToken: res.token,
      userId: user.id,
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "ORDER_CREATED", resourceId: res.orderId },
    });
    expect(audit?.metadata).toMatchObject({ orderNumber: res.orderNumber, totalAmount: 50_000 });

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, type: "ORDER_CONFIRMED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification).not.toBeNull();
  });

  it("recalcule le montant côté serveur à partir de la quantité (1 à 5)", async () => {
    const user = await buyer();
    const product = await createProduct(t, { basePrice: 20_000 });

    const res = await newOrder(user.id, product.id, { quantity: 3 });
    expect(res.amount).toBe(60_000);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.orderId },
      include: { items: true },
    });
    expect(order.items[0]?.quantity).toBe(3);
    expect(order.items[0]?.unitPrice).toBe(20_000);

    const defaultRes = await newOrder(user.id, product.id);
    expect(defaultRes.amount).toBe(20_000);
  });

  it("applique la promotion active au prix débité et snapshot l'promotion", async () => {
    const admin = await createAdmin(t);
    const user = await buyer();
    const product = await createProduct(t, { basePrice: 60_000 });
    const promotion = await prisma.promotion.create({
      data: {
        productId: product.id,
        title: "P13 promo commande",
        promoPrice: 45_000,
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
        status: "ACTIVE",
        createdById: admin.user.id,
      },
    });
    track(t, "promotionIds", promotion.id);

    const res = await newOrder(user.id, product.id);

    expect(res.amount).toBe(45_000);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.promotionId).toBe(promotion.id);
    expect(order.totalAmount).toBe(45_000);
    expect(order.discountAmount).toBe(15_000);
  });

  it("refuse un compte suspendu", async () => {
    const user = await buyer({ status: "SUSPENDED" });
    const product = await createProduct(t);
    const err = await expectApiError(() => newOrder(user.id, product.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("suspendu");
  });

  it("exige un dossier d'identité vérifié (KYC_REQUIRED)", async () => {
    const user = await createUser(t);
    const product = await createProduct(t);
    const err = await expectApiError(() => newOrder(user.id, product.id));
    expect(err.code).toBe("KYC_REQUIRED");
    expect(err.statusCode).toBe(403);
  });

  it("n'accepte que les produits actifs, publiés et non supprimés", async () => {
    const user = await buyer();

    const unpublished = await createProduct(t, { published: false });
    await expect(newOrder(user.id, unpublished.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const draft = await createProduct(t, { status: "DRAFT" });
    await expect(newOrder(user.id, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const deleted = await createProduct(t);
    await prisma.product.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await expect(newOrder(user.id, deleted.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      newOrder(user.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepte le comptant sur toute offre, réserve les tranches aux offres éligibles", async () => {
    const user = await buyer();
    const oneTime = await createProduct(t, { paymentMode: "ONE_TIME" });
    const split = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: 4,
      installmentDownPayment: 30_000,
      basePrice: 100_000,
    });

    const errComptant = await expectApiError(() => newOrder(user.id, oneTime.id, { paymentMode: "INSTALLMENTS" }));
    expect(errComptant.code).toBe("INSTALLMENTS_UNAVAILABLE");

    // Page « Offres » : un compte ouvert aux tranches s'achète aussi en une fois.
    const comptant = await newOrder(user.id, split.id, { paymentMode: "ONE_TIME" });
    expect(comptant.amount).toBe(100_000);
    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { id: comptant.orderId } } });
    expect(payment.type).toBe("ORDER_PAYMENT");
    expect(payment.amount).toBe(100_000);
  });

  it("refuse l'échelonné si l'offre n'est pas éligible (mois absents ou apport ≥ total)", async () => {
    const user = await buyer();

    const noMonths = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: null,
      installmentDownPayment: 10_000,
    });
    const errMonths = await expectApiError(() => newOrder(user.id, noMonths.id, { paymentMode: "INSTALLMENTS" }));
    expect(errMonths.code).toBe("INSTALLMENTS_UNAVAILABLE");
    expect(errMonths.message).toContain("pas éligible");

    const badDown = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: 3,
      installmentDownPayment: 100_000,
      basePrice: 100_000,
    });
    const errDown = await expectApiError(() => newOrder(user.id, badDown.id, { paymentMode: "INSTALLMENTS" }));
    expect(errDown.code).toBe("INSTALLMENTS_UNAVAILABLE");
    expect(errDown.message).toContain("Apport initial invalide");
  });

  it("ouvre un échéancier atomique : plan, échéances et apport initial rattachés", async () => {
    const user = await buyer();
    const product = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: 4,
      installmentDownPayment: 30_000,
      basePrice: 100_000,
    });

    const res = await newOrder(user.id, product.id, { paymentMode: "INSTALLMENTS" });
    expect(res.amount).toBe(100_000);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.orderId },
      include: { payments: true },
    });
    expect(order.paymentMode).toBe("INSTALLMENTS");
    expect(order.payments[0]).toMatchObject({
      type: "INITIAL_INSTALLMENT",
      amount: 30_000,
      status: "PENDING",
    });
    expect(order.payments[0]?.installmentPlanId).not.toBeNull();

    const plan = await prisma.installmentPlan.findUniqueOrThrow({
      where: { orderId: res.orderId },
      include: { installments: { orderBy: { index: "asc" } } },
    });
    expect(plan.monthCount).toBe(4);
    expect(plan.downPaymentAmount).toBe(30_000);
    expect(plan.remainingAmount).toBe(70_000);
    expect(plan.monthlyAmount).toBe(17_500);
    expect(plan.lastMonthAmount).toBe(17_500);
    expect(plan.installments).toHaveLength(4);
    expect(plan.installments.reduce((n, i) => n + i.amountDue, 0)).toBe(70_000);
    expect(plan.installments[0]?.index).toBe(1);
    expect(plan.installments[0]?.status).toBe("PENDING");

    const first = plan.installments[0]?.dueDate ?? new Date();
    const expected = new Date();
    expected.setMonth(expected.getMonth() + 1);
    expect(first.getDate()).toBe(expected.getDate());
  });

  it("refuse les quantités hors bornes", async () => {
    const user = await buyer();
    const product = await createProduct(t);
    await expect(newOrder(user.id, product.id, { quantity: 0 })).rejects.toThrow();
    await expect(newOrder(user.id, product.id, { quantity: 6 })).rejects.toThrow();
    await expect(newOrder(user.id, "pas-une-uuid")).rejects.toThrow();
  });
});

describe("Historique, détail et révélation", () => {
  it("liste mes commandes sans jamais exposer d'identifiants", async () => {
    const user = await buyer();
    const product = await createProduct(t, { basePrice: 30_000 });
    const res = await newOrder(user.id, product.id);

    const list = await listMyOrders(user.id);
    const mine = list.find((o) => o.id === res.orderId);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({ status: "PENDING_PAYMENT", itemCount: 1, canReveal: false });
    expect(mine?.firstItem?.title).toBe(product.title);
    expect(JSON.stringify(list)).not.toMatch(/password|credential|MotDePasse/i);
  });

  it("lit le détail d'une commande uniquement pour son acheteur", async () => {
    const user = await buyer();
    const other = await buyer();
    const product = await createProduct(t, { basePrice: 40_000 });
    const res = await newOrder(user.id, product.id);

    const detail = await getMyOrder(res.orderId, user.id);
    expect(detail.totalAmount).toBe(40_000);
    expect(detail.items).toHaveLength(1);
    expect(detail.payments).toHaveLength(1);
    expect(detail.canReveal).toBe(false);

    const err = await expectApiError(() => getMyOrder(res.orderId, other.id));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("révèle les identifiants après livraison (propriétaire, tracé, credential mis à jour)", async () => {
    const user = await buyer();
    const product = await createProduct(t, { withCredential: true });
    const res = await newOrder(user.id, product.id);

    await expect(revealCredentials(res.orderId, { actorId: user.id })).rejects.toMatchObject({
      code: "ORDER_NOT_DELIVERED",
    });

    await prisma.order.update({
      where: { id: res.orderId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });

    const revealed = await revealCredentials(res.orderId, { actorId: user.id });
    expect(revealed.orderNumber).toBe(res.orderNumber);
    expect(revealed.title).toBe(product.title);
    expect(revealed.email).toMatch(/@example\.com$/);
    expect(revealed.password.length).toBeGreaterThan(5);

    const credential = await prisma.productCredential.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(decryptString(credential.encryptedEmail)).toBe(revealed.email);
    expect(decryptString(credential.encryptedPassword)).toBe(revealed.password);
    expect(credential.lastAccessedById).toBe(user.id);
    expect(credential.lastAccessedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "ORDER_CREDENTIAL_REVEALED", resourceId: credential.id },
    });
    expect(audit?.severity).toBe("WARNING");
  });

  it("la révélation échoue pour un tiers, une commande remboursée ou sans accès", async () => {
    const user = await buyer();
    const stranger = await buyer();
    const withCred = await createProduct(t, { withCredential: true });
    const withoutCred = await createProduct(t);

    const owned = await newOrder(user.id, withCred.id);
    const noAccess = await newOrder(user.id, withoutCred.id);
    const refunded = await newOrder(user.id, withCred.id);
    for (const orderId of [owned.orderId, noAccess.orderId, refunded.orderId]) {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    }
    await prisma.order.update({ where: { id: refunded.orderId }, data: { status: "REFUNDED" } });

    await expect(revealCredentials(owned.orderId, { actorId: stranger.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(revealCredentials(refunded.orderId, { actorId: user.id })).rejects.toMatchObject({
      code: "ORDER_REFUNDED",
    });
    await expect(revealCredentials(noAccess.orderId, { actorId: user.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      revealCredentials("00000000-0000-4000-8000-000000000000", { actorId: user.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Routes commandes (inject)", () => {
  it("POST /orders : authentification, validation, création, détail et révélation", async () => {
    const user = await buyer();
    const product = await createProduct(t, { basePrice: 25_000, withCredential: true });
    const other = await buyer();

    const anon = await buildMiniApp({ auth: null }, async (app) => {
      await app.register(registerOrderRoutes, { prefix: "/api/v1" });
    });
    const unauthenticated = await anon.inject({ method: "POST", url: "/api/v1/orders", payload: {} });
    expect(unauthenticated.statusCode).toBe(401);
    await anon.close();

    const opts = { auth: await authFor(user.id) };
    const app = await buildMiniApp(opts, async (instance) => {
      await instance.register(registerOrderRoutes, { prefix: "/api/v1" });
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      payload: { productId: "pas-une-uuid", quantity: 99 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      payload: { productId: product.id, quantity: 1, paymentMode: "ONE_TIME" },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json().data;
    track(t, "orderIds", body.orderId);
    expect(body.amount).toBe(25_000);

    const list = await app.inject({ method: "GET", url: "/api/v1/orders/mine" });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((o: { id: string }) => o.id === body.orderId)).toBe(true);

    const detail = await app.inject({ method: "GET", url: `/api/v1/orders/${body.orderId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.totalAmount).toBe(25_000);

    const revealTooEarly = await app.inject({ method: "GET", url: `/api/v1/orders/${body.orderId}/reveal` });
    expect(revealTooEarly.statusCode).toBe(400);
    expect(revealTooEarly.json().error.code).toBe("ORDER_NOT_DELIVERED");

    opts.auth = await authFor(other.id);
    const foreignDetail = await app.inject({ method: "GET", url: `/api/v1/orders/${body.orderId}` });
    expect(foreignDetail.statusCode).toBe(404);

    opts.auth = await authFor(user.id);
    await prisma.order.update({
      where: { id: body.orderId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
    const revealed = await app.inject({ method: "GET", url: `/api/v1/orders/${body.orderId}/reveal` });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().data).toMatchObject({ orderNumber: body.orderNumber });

    await app.close();
  });
});
