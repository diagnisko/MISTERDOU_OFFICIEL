// Argent des ventes vendeur et disponibilité des comptes :
// produit retiré de la boutique, commission, fonds en attente puis libérés
// (« Reçu » du client ou délai de sécurité), réservation, retraits vendeur.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createProduct,
  createSeller,
  createUser,
  expectApiError,
  putStorageFile,
  tracker,
  track,
} from "./helpers.js";
import { confirmReceipt, createOrder } from "../src/modules/orders/service.js";
import { releaseMaturedCredits } from "../src/modules/orders/fulfillment.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { approveWithdrawal, startWithdrawalProcessing } from "../src/modules/admin-ops/service.js";
import { registerSellerRoutes } from "../src/modules/seller/routes.js";

const t = tracker();
const DAY_MS = 86_400_000;

afterAll(async () => {
  await cleanup(t);
});

async function vendorProduct(price = 20_000) {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id, basePrice: price, withCredential: true });
  return { owner, seller, product };
}

async function purchase(buyerId: string, productId: string, paymentMode: "ONE_TIME" | "INSTALLMENTS" = "ONE_TIME") {
  const order = await createOrder({ productId, quantity: 1, paymentMode }, { actorId: buyerId });
  track(t, "orderIds", order.orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
  return order;
}

describe("Vente d'un compte vendeur", () => {
  it("retire le compte de la boutique, prélève 15 % et met le net en attente", async () => {
    const { owner, seller, product } = await vendorProduct(20_000);
    const buyer = await createUser(t, { kycVerified: true });
    const order = await purchase(buyer.id, product.id);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SOLD");

    const commission = await prisma.commission.findFirstOrThrow({ where: { orderItem: { orderId: order.orderId } } });
    expect(commission).toMatchObject({ commissionRate: 15, commissionAmount: 3_000, netToSeller: 17_000, status: "RECORDED" });

    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(balance).toMatchObject({ balancePending: 17_000, balanceAvailable: 0, totalEarnings: 17_000, totalCommissionPaid: 3_000 });

    const credit = await prisma.pendingCredit.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(credit).toMatchObject({ amount: 17_000, releasedAt: null });

    const sold = await prisma.notification.findFirst({ where: { userId: owner.id, type: "PRODUCT_SOLD" } });
    expect(sold?.message).toContain((17_000).toLocaleString("fr-FR"));
  });

  it("ne permet plus d'acheter un compte déjà vendu", async () => {
    const { product } = await vendorProduct();
    const first = await createUser(t, { kycVerified: true });
    await purchase(first.id, product.id);
    const second = await createUser(t, { kycVerified: true });
    const err = await expectApiError(() => createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: second.id }));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("réserve un compte en cours de paiement pendant 20 minutes", async () => {
    const { product } = await vendorProduct();
    const first = await createUser(t, { kycVerified: true });
    const pending = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: first.id });
    track(t, "orderIds", pending.orderId);

    const second = await createUser(t, { kycVerified: true });
    const err = await expectApiError(() => createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: second.id }));
    expect(err.code).toBe("PRODUCT_RESERVED");

    // Réservation expirée : le compte redevient achetable.
    await prisma.order.update({ where: { id: pending.orderId }, data: { createdAt: new Date(Date.now() - 25 * 60_000) } });
    const retry = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: second.id });
    track(t, "orderIds", retry.orderId);
    expect(retry.orderNumber).toMatch(/^MD-/);
  });

  it("retire aussi de la boutique un compte dont l'échéancier vient d'être ouvert", async () => {
    const product = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: 4,
      installmentDownPayment: 20_000,
      basePrice: 100_000,
    });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await purchase(buyer.id, product.id, "INSTALLMENTS");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("PARTIALLY_PAID");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SOLD");
  });
});

describe("Libération des fonds", () => {
  it("« Reçu » rend les fonds disponibles une seule fois", async () => {
    const { owner, seller, product } = await vendorProduct(20_000);
    const buyer = await createUser(t, { kycVerified: true });
    const order = await purchase(buyer.id, product.id);

    const stranger = await createUser(t);
    await expect(confirmReceipt(order.orderId, { actorId: stranger.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const first = await confirmReceipt(order.orderId, { actorId: buyer.id });
    expect(first.released).toBe(17_000);
    const again = await confirmReceipt(order.orderId, { actorId: buyer.id });
    expect(again.released).toBe(0);

    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(balance).toMatchObject({ balancePending: 0, balanceAvailable: 17_000 });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe("COMPLETED");
    expect(row.receivedAt).not.toBeNull();
    const commission = await prisma.commission.findFirstOrThrow({ where: { orderItem: { orderId: order.orderId } } });
    expect(commission.status).toBe("RELEASED");

    const notice = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "SELLER_PAYOUT_AVAILABLE", title: "Fonds disponibles", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notice?.message).toContain("confirmé la réception");
  });

  it("refuse « Reçu » tant que la commande n'est pas livrée", async () => {
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const pending = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
    track(t, "orderIds", pending.orderId);
    await expect(confirmReceipt(pending.orderId, { actorId: buyer.id })).rejects.toMatchObject({ code: "ORDER_NOT_DELIVERED" });
  });

  it("libère automatiquement après le délai, sauf signalement ouvert", async () => {
    const a = await vendorProduct(10_000);
    const b = await vendorProduct(10_000);
    const buyer = await createUser(t, { kycVerified: true });
    const orderA = await purchase(buyer.id, a.product.id);
    const orderB = await purchase(buyer.id, b.product.id);
    const old = new Date(Date.now() - 4 * DAY_MS);
    await prisma.order.updateMany({ where: { id: { in: [orderA.orderId, orderB.orderId] } }, data: { deliveredAt: old } });
    await prisma.supportTicket.create({
      data: {
        reporterId: buyer.id,
        orderId: orderB.orderId,
        category: "SELLER_REPORT",
        subject: "Compte repris par le vendeur",
        description: "Le vendeur s'est reconnecté au compte après la vente.",
      },
    });

    await releaseMaturedCredits();

    expect((await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: a.seller.id } })).balanceAvailable).toBe(8_500);
    const blocked = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: b.seller.id } });
    expect(blocked).toMatchObject({ balanceAvailable: 0, balancePending: 8_500 });
  });
});

describe("Retraits vendeur", () => {
  async function sellerApp(balanceAvailable: number, kycVerified = true) {
    const owner = await createUser(t, { role: "VENDOR", kycVerified });
    const seller = await createSeller(t, owner, { balanceAvailable });
    const app = await buildMiniApp({ auth: (await authFor(owner.id))! }, async (instance) => {
      await instance.register(registerSellerRoutes, { prefix: "/api/v1" });
    });
    return { owner, seller, app };
  }

  it("refuse sans identité vérifiée, sous le minimum ou au-delà du solde", async () => {
    const unverified = await sellerApp(10_000, false);
    const noKyc = await unverified.app.inject({
      method: "POST",
      url: "/api/v1/seller/withdrawals",
      payload: { amount: 5_000, method: "WAVE", phoneNumber: "+221771234567" },
    });
    expect(noKyc.statusCode).toBe(403);
    await unverified.app.close();

    const { app } = await sellerApp(10_000);
    const tooSmall = await app.inject({
      method: "POST",
      url: "/api/v1/seller/withdrawals",
      payload: { amount: 500, method: "WAVE", phoneNumber: "+221771234567" },
    });
    expect(tooSmall.statusCode).toBe(400);
    const tooBig = await app.inject({
      method: "POST",
      url: "/api/v1/seller/withdrawals",
      payload: { amount: 15_000, method: "WAVE", phoneNumber: "+221771234567" },
    });
    expect(tooBig.statusCode).toBe(409);
    expect(tooBig.json().error.code).toBe("INSUFFICIENT_BALANCE");
    await app.close();
  });

  it("débite le solde, chiffre le numéro, prévient l'équipe ; « Traiter » annonce le délai puis « Payé »", async () => {
    const admin = await createAdmin(t);
    const { owner, seller, app } = await sellerApp(10_000);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/seller/withdrawals",
      payload: { amount: 8_000, method: "WAVE", phoneNumber: "+221 77 123 45 67" },
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().data.id as string;
    track(t, "withdrawalIds", id);
    await app.close();

    expect((await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).balanceAvailable).toBe(2_000);
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PENDING");
    expect(row.bankDetailsSnapshot).not.toContain("771234567");

    const alert = await prisma.notification.findFirst({
      where: { userId: admin.user.id, type: "ADMIN_ALERT", title: "Nouvelle demande de retrait" },
    });
    expect(alert).not.toBeNull();

    const actor = { actorId: admin.user.id, actorRole: "ADMIN" as const, ip: "127.0.0.1" };
    await startWithdrawalProcessing(id, 30, actor);
    const processing = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(processing).toMatchObject({ status: "PROCESSING", etaMinutes: 30 });
    const eta = await prisma.notification.findFirst({ where: { userId: owner.id, title: "Retrait en cours de traitement" } });
    expect(eta?.message).toContain("30 minutes");

    const proofKey = await putStorageFile(t, `proofs/${admin.user.id}/withdrawal_proof/${randomUUID()}`);
    await approveWithdrawal(id, { proofKey, paymentReference: "OM-REF-123" }, actor);
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });
});
