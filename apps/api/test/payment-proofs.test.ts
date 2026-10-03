// Paiement par lien Wave Business : le montant est écrit dans le lien, le
// client envoie sa preuve, l'équipe (admin ou manager PAYMENTS) valide ou
// refuse. Validation = livraison du compte et part du vendeur ; refus = le
// client peut renvoyer une preuve. Retraits : capture de l'envoi, puis
// « Reçu » / « Pas reçu » du vendeur.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createProduct,
  createSeller,
  createStaff,
  createUser,
  expectApiError,
  putStorageFile,
  tracker,
  track,
} from "./helpers.js";
import { createOrder } from "../src/modules/orders/service.js";
import { getCheckoutState } from "../src/modules/payments/service.js";
import {
  approvePaymentProof,
  listPaymentProofs,
  rejectPaymentProof,
  submitPaymentProof,
} from "../src/modules/payments/proofs.js";
import { registerPaymentRoutes } from "../src/modules/payments/routes.js";
import { approveWithdrawal } from "../src/modules/admin-ops/service.js";
import { registerSellerRoutes } from "../src/modules/seller/routes.js";

const t = tracker();
const WAVE_LINK = "https://pay.wave.com/m/M_sn_FXjtL8L8mMRr/c/sn/";
let previousLink: unknown;

beforeAll(async () => {
  const row = await prisma.settings.findUnique({ where: { key: "waveMerchantLink" } });
  previousLink = row?.value;
  if (row) {
    await prisma.settings.update({ where: { key: "waveMerchantLink" }, data: { value: WAVE_LINK } });
  } else {
    await prisma.settings.create({ data: { key: "waveMerchantLink", value: WAVE_LINK, valueType: "string", group: "payments" } });
    t.settingsKeys.push("waveMerchantLink");
  }
});

afterAll(async () => {
  if (previousLink !== undefined) {
    await prisma.settings.update({ where: { key: "waveMerchantLink" }, data: { value: previousLink as string } });
  }
  await cleanup(t);
});

async function vendorProduct(price = 20_000) {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id, basePrice: price, withCredential: true });
  return { owner, seller, product };
}

async function order(buyerId: string, productId: string, paymentMode: "ONE_TIME" | "INSTALLMENTS" = "ONE_TIME") {
  const created = await createOrder({ productId, quantity: 1, paymentMode }, { actorId: buyerId });
  track(t, "orderIds", created.orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: created.orderId } });
  return { ...created, payment };
}

async function screenshot(userId: string, purpose: "payment_proof" | "withdrawal_proof" = "payment_proof") {
  return putStorageFile(t, `proofs/${userId}/${purpose}/${randomUUID()}`);
}

async function sendProof(buyerId: string, token: string, extra: { waveReference?: string } = {}) {
  return submitPaymentProof(
    token,
    { proofKey: await screenshot(buyerId), senderPhone: "+221771234567", ...extra },
    { actorId: buyerId, ip: "127.0.0.1" },
  );
}

describe("Lien Wave avec le montant à payer", () => {
  it("écrit le prix de l'offre dans le lien", async () => {
    const { product } = await vendorProduct(25_000);
    const buyer = await createUser(t, { kycVerified: true });
    const { token } = await order(buyer.id, product.id);

    const state = await getCheckoutState(token);
    expect(state.waveLink).toBe(`${WAVE_LINK}?amount=25000`);
    expect(state.proof).toBeNull();
  });

  it("écrit l'apport, pas le prix total, pour un achat en plusieurs fois", async () => {
    const product = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: 4,
      installmentDownPayment: 20_000,
      basePrice: 100_000,
    });
    const buyer = await createUser(t, { kycVerified: true });
    const { token } = await order(buyer.id, product.id, "INSTALLMENTS");
    expect((await getCheckoutState(token)).waveLink).toBe(`${WAVE_LINK}?amount=20000`);
  });
});

describe("Preuve envoyée par le client", () => {
  it("met le paiement en vérification, prévient l'équipe et n'est jamais confirmé tout seul", async () => {
    const admin = await createAdmin(t);
    const payStaff = await createStaff(t, ["PAYMENTS"]);
    const otherStaff = await createStaff(t, ["PRODUCTS"]);
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const { token, payment } = await order(buyer.id, product.id);

    const sent = await sendProof(buyer.id, token, { waveReference: `T_${randomUUID().slice(0, 10)}` });
    expect(sent.status).toBe("PROCESSING");

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row).toMatchObject({ status: "PROCESSING", provider: "WAVE_LINK" });

    // Seule l'équipe confirme : la page de paiement ne fait qu'afficher l'état.
    const state = await getCheckoutState(token);
    expect(state.status).toBe("PROCESSING");
    expect(state.proof?.status).toBe("PENDING");

    const alerted = await prisma.notification.findMany({
      where: { title: "Paiement Wave à vérifier", createdAt: { gte: SUITE_STARTED_AT } },
      select: { userId: true },
    });
    const ids = alerted.map((n) => n.userId);
    expect(ids).toContain(admin.user.id);
    expect(ids).toContain(payStaff.user.id);
    expect(ids).not.toContain(otherStaff.user.id);

    const again = await expectApiError(() => sendProof(buyer.id, token));
    expect(again.code).toBe("PROOF_ALREADY_SENT");
  });

  it("refuse une capture déposée par un autre compte ou un paiement d'autrui", async () => {
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const intruder = await createUser(t, { kycVerified: true });
    const { token } = await order(buyer.id, product.id);

    const foreignKey = await screenshot(intruder.id);
    const err = await expectApiError(() =>
      submitPaymentProof(token, { proofKey: foreignKey, senderPhone: "771234567" }, { actorId: buyer.id }),
    );
    expect(err.code).toBe("FORBIDDEN");

    const notMine = await expectApiError(() => sendProof(intruder.id, token));
    expect(notMine.code).toBe("NOT_FOUND");
  });

  it("garde le compte réservé tant que la preuve attend la vérification", async () => {
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const pending = await order(buyer.id, product.id);
    await sendProof(buyer.id, pending.token);
    // Au-delà des 20 minutes de réservation habituelles.
    await prisma.order.update({ where: { id: pending.orderId }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });

    const other = await createUser(t, { kycVerified: true });
    const err = await expectApiError(() => createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: other.id }));
    expect(err.code).toBe("PRODUCT_RESERVED");
  });
});

describe("Vérification par l'équipe", () => {
  it("valider livre le compte et félicite le vendeur", async () => {
    const admin = await createAdmin(t);
    const { owner, product } = await vendorProduct(20_000);
    const buyer = await createUser(t, { kycVerified: true });
    const { token, payment, orderId } = await order(buyer.id, product.id);
    await sendProof(buyer.id, token);

    const { items } = await listPaymentProofs("PENDING");
    const proof = items.find((p) => p.payment.id === payment.id);
    expect(proof).toMatchObject({ amount: 20_000, senderPhone: "+221771234567", warnings: { productSold: false, referenceReusedBy: [] } });

    const actor = { actorId: admin.user.id, actorRole: "ADMIN" as const, ip: "127.0.0.1" };
    const result = await approvePaymentProof(proof!.id, actor);
    expect(result).toMatchObject({ status: "APPROVED", paymentStatus: "SUCCESS" });

    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SOLD");
    const bravo = await prisma.notification.findFirst({ where: { userId: owner.id, type: "PRODUCT_SOLD" } });
    expect(bravo?.title).toContain("Bravo");
    expect(bravo?.message).toContain((17_000).toLocaleString("fr-FR"));
    const delivered = await prisma.notification.findFirst({ where: { userId: buyer.id, type: "ORDER_DELIVERED" } });
    expect(delivered).not.toBeNull();

    const twice = await expectApiError(() => approvePaymentProof(proof!.id, actor));
    expect(twice.code).toBe("PROOF_ALREADY_REVIEWED");
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_PROOF_APPROVED", resourceId: payment.id } })).toBe(1);
  });

  it("refuser rouvre le paiement, donne le motif au client et accepte une nouvelle preuve", async () => {
    const admin = await createAdmin(t);
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const { token, payment } = await order(buyer.id, product.id);
    const first = await sendProof(buyer.id, token);

    await rejectPaymentProof(first.proof.id, "Aucun paiement reçu de ce numéro.", { actorId: admin.user.id, actorRole: "ADMIN" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    const state = await getCheckoutState(token);
    expect(state.proof).toMatchObject({ status: "REJECTED", rejectionReason: "Aucun paiement reçu de ce numéro." });
    expect(state.waveLink).toContain("amount=");

    const told = await prisma.notification.findFirst({ where: { userId: buyer.id, title: "Paiement non validé" } });
    expect(told?.message).toContain("Aucun paiement reçu de ce numéro.");
    expect(told?.actionUrl).toBe(`/checkout/${token}`);

    const second = await sendProof(buyer.id, token);
    expect(second.status).toBe("PROCESSING");
  });

  it("bloque une référence Wave déjà utilisée pour un autre paiement", async () => {
    const admin = await createAdmin(t);
    const reference = `T_${randomUUID().slice(0, 10)}`;
    const a = await vendorProduct();
    const b = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const first = await order(buyer.id, a.product.id);
    const sent = await sendProof(buyer.id, first.token, { waveReference: reference });
    await approvePaymentProof(sent.proof.id, { actorId: admin.user.id, actorRole: "ADMIN" });

    const second = await order(buyer.id, b.product.id);
    const err = await expectApiError(() => sendProof(buyer.id, second.token, { waveReference: reference.toLowerCase() }));
    expect(err.code).toBe("PROOF_REFERENCE_USED");
  });
});

describe("Routes (inject)", () => {
  it("client : envoi de la preuve ; équipe : permission PAYMENTS, capture, validation", async () => {
    const { product } = await vendorProduct();
    const buyer = await createUser(t, { kycVerified: true });
    const { token, payment } = await order(buyer.id, product.id);

    const clientApp = await buildMiniApp({ auth: await authFor(buyer.id) }, async (app) => {
      await app.register(registerPaymentRoutes, { prefix: "/api/v1" });
    });
    const badPhone = await clientApp.inject({
      method: "POST",
      url: `/api/v1/payments/${token}/proof`,
      payload: { proofKey: await screenshot(buyer.id), senderPhone: "abc" },
    });
    expect(badPhone.statusCode).toBe(400);
    const sent = await clientApp.inject({
      method: "POST",
      url: `/api/v1/payments/${token}/proof`,
      payload: { proofKey: await screenshot(buyer.id), senderPhone: "77 123 45 67", waveReference: "" },
    });
    expect(sent.statusCode).toBe(200);
    expect((await clientApp.inject({ method: "GET", url: "/api/v1/admin/payment-proofs" })).statusCode).toBe(403);
    await clientApp.close();

    const wrong = await createStaff(t, ["ORDERS"]);
    const wrongApp = await buildMiniApp({ auth: wrong.session }, async (app) => {
      await app.register(registerPaymentRoutes, { prefix: "/api/v1" });
    });
    expect((await wrongApp.inject({ method: "GET", url: "/api/v1/admin/payment-proofs" })).statusCode).toBe(403);
    await wrongApp.close();

    const staff = await createStaff(t, ["PAYMENTS"]);
    const app = await buildMiniApp({ auth: staff.session }, async (instance) => {
      await instance.register(registerPaymentRoutes, { prefix: "/api/v1" });
    });
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/payment-proofs?status=PENDING" });
    expect(list.statusCode).toBe(200);
    const proof = list.json().data.items.find((p: { payment: { id: string } }) => p.payment.id === payment.id);
    expect(proof.senderPhone).toBe("771234567");
    expect(proof.waveReference).toBeNull();

    const file = await app.inject({ method: "GET", url: `/api/v1/admin/payment-proofs/${proof.id}/file` });
    expect(file.statusCode).toBe(200);
    expect(file.headers["cache-control"]).toBe("private, no-store");

    const shortReason = await app.inject({ method: "POST", url: `/api/v1/admin/payment-proofs/${proof.id}/reject`, payload: { reason: "non" } });
    expect(shortReason.statusCode).toBe(400);

    const approved = await app.inject({ method: "POST", url: `/api/v1/admin/payment-proofs/${proof.id}/approve` });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({ status: "APPROVED", paymentStatus: "SUCCESS" });
    await app.close();
  });
});

describe("Retrait : capture de l'envoi et réponse du vendeur", () => {
  it("le vendeur voit la capture, peut signaler « Pas reçu » puis confirmer « Reçu »", async () => {
    const admin = await createAdmin(t);
    const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, owner);
    const row = await prisma.withdrawal.create({ data: { sellerId: seller.id, requestedById: owner.id, amount: 12_000 } });
    track(t, "withdrawalIds", row.id);

    const sellerApp = await buildMiniApp({ auth: await authFor(owner.id) }, async (app) => {
      await app.register(registerSellerRoutes, { prefix: "/api/v1" });
    });
    const early = await sellerApp.inject({ method: "POST", url: `/api/v1/seller/withdrawals/${row.id}/receipt`, payload: { received: true } });
    expect(early.statusCode).toBe(409);

    await approveWithdrawal(row.id, { proofKey: await screenshot(admin.user.id, "withdrawal_proof") }, { actorId: admin.user.id, actorRole: "ADMIN" });
    const sent = await prisma.notification.findFirst({ where: { userId: owner.id, title: "Retrait envoyé" } });
    expect(sent?.priority).toBe("CRITICAL");

    expect((await sellerApp.inject({ method: "GET", url: `/api/v1/seller/withdrawals/${row.id}/proof` })).statusCode).toBe(200);

    const noNote = await sellerApp.inject({ method: "POST", url: `/api/v1/seller/withdrawals/${row.id}/receipt`, payload: { received: false } });
    expect(noNote.statusCode).toBe(400);
    const disputed = await sellerApp.inject({
      method: "POST",
      url: `/api/v1/seller/withdrawals/${row.id}/receipt`,
      payload: { received: false, note: "Rien reçu sur mon Wave." },
    });
    expect(disputed.statusCode).toBe(200);
    expect(await prisma.withdrawal.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "APPROVED",
      sellerDisputeNote: "Rien reçu sur mon Wave.",
    });
    const alert = await prisma.notification.findFirst({ where: { userId: admin.user.id, title: "Retrait non reçu" } });
    expect(alert?.priority).toBe("CRITICAL");

    const received = await sellerApp.inject({ method: "POST", url: `/api/v1/seller/withdrawals/${row.id}/receipt`, payload: { received: true } });
    expect(received.statusCode).toBe(200);
    const done = await prisma.withdrawal.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.sellerConfirmedAt).not.toBeNull();
    await sellerApp.close();

    // Un autre vendeur ne voit ni la capture ni le bouton.
    const stranger = await createUser(t, { role: "VENDOR" });
    await createSeller(t, stranger);
    const strangerApp = await buildMiniApp({ auth: await authFor(stranger.id) }, async (app) => {
      await app.register(registerSellerRoutes, { prefix: "/api/v1" });
    });
    expect((await strangerApp.inject({ method: "GET", url: `/api/v1/seller/withdrawals/${row.id}/proof` })).statusCode).toBe(404);
    expect(
      (await strangerApp.inject({ method: "POST", url: `/api/v1/seller/withdrawals/${row.id}/receipt`, payload: { received: true } })).statusCode,
    ).toBe(404);
    await strangerApp.close();
  });
});
