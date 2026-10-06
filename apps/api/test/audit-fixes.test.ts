// Corrections de l'audit fonctionnel (octobre 2026) : commandes abandonnées,
// remboursement d'une vente, mot de passe oublié, informations légales.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createProduct,
  createSeller,
  createUser,
  expectApiError,
  tracker,
  track,
} from "./helpers.js";
import { confirmReceipt, createOrder } from "../src/modules/orders/service.js";
import { expireUnpaidOrders } from "../src/modules/orders/fulfillment.js";
import { removeOffer } from "../src/modules/offers/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { refundPayment } from "../src/modules/admin-ops/service.js";
import { adminPasswordResetLink, requestPasswordReset, resetPassword } from "../src/modules/auth/password-reset.js";
import { verifyPassword } from "../src/lib/password.js";
import { registerAuthRoutes } from "../src/modules/auth/routes.js";
import { registerSettingsRoutes } from "../src/modules/settings/routes.js";

const t = tracker();
const HOUR = 3_600_000;

afterAll(async () => {
  await cleanup(t);
});

async function vendorProduct(price = 20_000) {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id, basePrice: price, withCredential: true });
  return { owner, seller, product };
}

async function order(buyerId: string, productId: string) {
  const created = await createOrder({ productId, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyerId });
  track(t, "orderIds", created.orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: created.orderId } });
  return { ...created, payment };
}

describe("Commandes jamais réglées", () => {
  it("sont annulées après le délai, sauf si une preuve Wave attend l'équipe", async () => {
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const old = await order(buyer.id, product.id);
    await prisma.order.update({ where: { id: old.orderId }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });

    const other = await vendorProduct();
    const waiting = await order(buyer.id, other.product.id);
    await prisma.order.update({ where: { id: waiting.orderId }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    await prisma.payment.update({ where: { id: waiting.payment.id }, data: { status: "PROCESSING", provider: "WAVE_LINK" } });

    const recentProduct = await vendorProduct();
    const recent = await order(buyer.id, recentProduct.product.id);

    expect(await expireUnpaidOrders()).toBeGreaterThanOrEqual(1);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: old.orderId } })).status).toBe("CANCELLED");
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).toMatchObject({ status: "CANCELLED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: waiting.orderId } })).status).toBe("PENDING_PAYMENT");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: recent.orderId } })).status).toBe("PENDING_PAYMENT");

    const told = await prisma.notification.findFirst({ where: { userId: buyer.id, title: `Commande ${old.orderNumber} annulée` } });
    expect(told?.message).toContain("remis en vente");
  });

  it("ne bloquent plus l'offre du vendeur une fois la réservation passée", async () => {
    const { seller, owner, product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const abandoned = await order(buyer.id, product.id);
    const actor = { actorId: owner.id };

    // Réservation en cours : l'offre est bloquée.
    const blocked = await expectApiError(() => removeOffer(product.id, { kind: "seller", sellerId: seller.id }, actor));
    expect(blocked.code).toBe("PRODUCT_RESERVED");

    // 30 minutes plus tard, sans preuve de paiement : le vendeur reprend la main.
    await prisma.order.update({ where: { id: abandoned.orderId }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    await expect(removeOffer(product.id, { kind: "seller", sellerId: seller.id }, actor)).resolves.toMatchObject({ removed: true });
  });
});

describe("Remboursement d'une vente", () => {
  it("retire au vendeur sa part en attente, une seule fois", async () => {
    const admin = await createAdmin(t);
    const { owner, seller, product } = await vendorProduct(20_000);
    const buyer = await createUser(t, { kycVerified: true });
    const { payment } = await order(buyer.id, product.id);
    await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    expect(await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).toMatchObject({ balancePending: 17_000, totalEarnings: 17_000 });

    await refundPayment(payment.id, "Compte inaccessible.", { actorId: admin.user.id, actorRole: "ADMIN" });

    expect(await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).toMatchObject({
      balancePending: 0,
      balanceAvailable: 0,
      totalEarnings: 0,
      totalCommissionPaid: 0,
    });
    const commission = await prisma.commission.findFirstOrThrow({ where: { orderItem: { order: { payments: { some: { id: payment.id } } } } } });
    expect(commission.status).toBe("REFUNDED");
    const told = await prisma.notification.findFirst({ where: { userId: owner.id, title: "Vente annulée et remboursée" } });
    expect(told?.message).toContain("ne vous seront pas versés");
    const client = await prisma.notification.findFirst({ where: { userId: buyer.id, type: "ORDER_REFUNDED" } });
    expect(client?.message).toContain("par Wave");
  });

  it("reprend sur le solde disponible une part déjà libérée", async () => {
    const admin = await createAdmin(t);
    const { seller, product } = await vendorProduct(10_000);
    const buyer = await createUser(t, { kycVerified: true });
    const { payment, orderId } = await order(buyer.id, product.id);
    await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    await confirmReceipt(orderId, { actorId: buyer.id });
    expect((await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).balanceAvailable).toBe(8_500);

    await refundPayment(payment.id, "Compte récupéré par le vendeur.", { actorId: admin.user.id, actorRole: "ADMIN" });
    expect(await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).toMatchObject({ balanceAvailable: 0, totalEarnings: 0 });
  });
});

describe("Mot de passe oublié", () => {
  it("signale un e-mail inconnu ou un compte suspendu ; envoie le code sinon", async () => {
    await expect(requestPasswordReset("personne-p13@example.com", {})).rejects.toMatchObject({ code: "EMAIL_NOT_REGISTERED", statusCode: 404 });
    const suspended = await createUser(t, { status: "SUSPENDED" });
    await expect(requestPasswordReset(suspended.email, {})).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    const user = await createUser(t);
    await expect(requestPasswordReset(user.email.toUpperCase(), {})).resolves.toEqual({ sent: true });
    expect(await prisma.auditLog.count({ where: { action: "PASSWORD_RESET_REQUESTED", resourceId: user.id } })).toBe(1);
  });

  it("le lien change le mot de passe, ferme les sessions et ne sert qu'une fois", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t);
    await authFor(user.id);
    const { link } = await adminPasswordResetLink(user.id, { actorId: admin.user.id, actorRole: "ADMIN" });
    const token = new URL(link).searchParams.get("token")!;
    expect(link).toContain("/mot-de-passe-oublie/nouveau?token=");

    const [id, exp, sig] = token.split(".");
    const tampered = `${id}.${Number(exp) + 3600}.${sig}`;
    expect((await expectApiError(() => resetPassword(tampered, "NouveauMotDePasse1", {}))).code).toBe("VALIDATION_ERROR");

    await expect(resetPassword(token, "NouveauMotDePasse1", {})).resolves.toEqual({ reset: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(await verifyPassword("NouveauMotDePasse1", row.passwordHash!)).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);

    // Deuxième utilisation : le mot de passe a changé, le lien est mort.
    expect((await expectApiError(() => resetPassword(token, "EncoreUnAutre22", {}))).code).toBe("VALIDATION_ERROR");
    const alert = await prisma.notification.findFirst({ where: { userId: user.id, title: "Mot de passe réinitialisé" } });
    expect(alert?.priority).toBe("CRITICAL");
  });

  it("refuse un lien pour un administrateur ou un compte suspendu", async () => {
    const admin = await createAdmin(t);
    const other = await createAdmin(t);
    await expect(adminPasswordResetLink(other.user.id, { actorId: admin.user.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const suspended = await createUser(t, { status: "SUSPENDED" });
    await expect(adminPasswordResetLink(suspended.id, { actorId: admin.user.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("routes publiques : e-mail invalide refusé, e-mail inconnu signalé", async () => {
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerAuthRoutes, { prefix: "/api/v1" });
    });
    const bad = await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "pas-un-email" } });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "inconnu-p13@example.com" } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("EMAIL_NOT_REGISTERED");
    const weak = await app.inject({ method: "POST", url: "/api/v1/auth/password/reset", payload: { token: "x".repeat(30), password: "court" } });
    expect(weak.statusCode).toBe(400);
    await app.close();
  });
});

describe("Informations légales", () => {
  it("expose l'exploitant et les règles chiffrées réglées dans la console", async () => {
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerSettingsRoutes, { prefix: "/api/v1" });
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/legal" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      platformName: expect.any(String),
      commissionPercent: expect.any(Number),
      payoutHoldDays: expect.any(Number),
      unpaidOrderExpiryHours: expect.any(Number),
    });
    await app.close();
  });
});
