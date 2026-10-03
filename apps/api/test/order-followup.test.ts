// Suivi d'une commande côté client : identifiants après « Reçu », codes de
// vérification (demande, fourniture par l'équipe ou le vendeur, expiration),
// détail enrichi et paiement de plusieurs mensualités d'un coup.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createProduct,
  createSeller,
  createStaff,
  createUser,
  tracker,
  track,
} from "./helpers.js";
import { confirmReceipt, createOrder, getMyOrder, revealCredentials } from "../src/modules/orders/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { createNextInstallmentPayment } from "../src/modules/installments/service.js";
import { registerVerificationCodeRoutes } from "../src/modules/verification-codes/routes.js";
import type { ActiveSession } from "../src/lib/auth-context.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function vendorSale(price = 20_000) {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id, basePrice: price, withCredential: true });
  const buyer = await createUser(t, { kycVerified: true });
  const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
  track(t, "orderIds", order.orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
  return { owner, seller, product, buyer, orderId: order.orderId };
}

async function codesApp(auth: ActiveSession | null) {
  return buildMiniApp({ auth }, async (instance) => {
    await instance.register(registerVerificationCodeRoutes, { prefix: "/api/v1" });
  });
}

describe("Détail d'une commande", () => {
  it("expose réception, code et échéancier, et garde les identifiants après « Reçu »", async () => {
    const { buyer, orderId } = await vendorSale();
    const before = await getMyOrder(orderId, buyer.id);
    expect(before).toMatchObject({ canReveal: true, canConfirmReceipt: true, receivedAt: null, verificationCode: null, schedule: null });
    expect(before.autoConfirmAt).not.toBeNull();
    expect(before.items[0]?.soldBy).toBe("Vendeur partenaire");

    await confirmReceipt(orderId, { actorId: buyer.id });
    const after = await getMyOrder(orderId, buyer.id);
    expect(after).toMatchObject({ status: "COMPLETED", canReveal: true, canConfirmReceipt: false, autoConfirmAt: null });
    const creds = await revealCredentials(orderId, { actorId: buyer.id });
    expect(creds.email).toMatch(/@example\.com$/);
  });

  it("ne montre pas la commande d'un autre client", async () => {
    const { orderId } = await vendorSale();
    const stranger = await createUser(t);
    await expect(getMyOrder(orderId, stranger.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Codes de vérification", () => {
  it("le client demande, le vendeur du compte fournit, le client lit le code", async () => {
    const { owner, buyer, orderId } = await vendorSale();
    const client = await codesApp(await authFor(buyer.id));

    const asked = await client.inject({ method: "POST", url: `/api/v1/orders/${orderId}/verification-code` });
    expect(asked.statusCode).toBe(200);
    const request = asked.json().data;
    expect(request).toMatchObject({ status: "PENDING", code: null });

    // Redemander tant que c'est en attente ne crée pas de doublon.
    const again = await client.inject({ method: "POST", url: `/api/v1/orders/${orderId}/verification-code` });
    expect(again.json().data.id).toBe(request.id);

    // Le client ne peut pas consulter la file ni fournir de code.
    expect((await client.inject({ method: "GET", url: "/api/v1/verification-codes" })).statusCode).toBe(403);

    // Le vendeur est prévenu et voit la demande.
    const alert = await prisma.notification.findFirst({ where: { userId: owner.id, title: "Code de vérification demandé" } });
    expect(alert).not.toBeNull();
    const seller = await codesApp(await authFor(owner.id));
    const queue = await seller.inject({ method: "GET", url: "/api/v1/verification-codes" });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.scope).toBe("seller");
    expect(queue.json().data.items.map((r: { id: string }) => r.id)).toContain(request.id);

    const provided = await seller.inject({
      method: "POST",
      url: `/api/v1/verification-codes/${request.id}/provide`,
      payload: { code: "482913" },
    });
    expect(provided.statusCode).toBe(200);

    // Un second envoi est refusé : premier arrivé, premier servi.
    const twice = await seller.inject({
      method: "POST",
      url: `/api/v1/verification-codes/${request.id}/provide`,
      payload: { code: "111111" },
    });
    expect(twice.statusCode).toBe(409);

    const view = await getMyOrder(orderId, buyer.id);
    expect(view.verificationCode).toMatchObject({ status: "PROVIDED", code: "482913" });
    const stored = await prisma.verificationCodeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.codeEncrypted).not.toContain("482913");
    const expiresIn = stored.expiresAt!.getTime() - stored.providedAt!.getTime();
    expect(expiresIn).toBe(10 * 60_000);

    await client.close();
    await seller.close();
  });

  it("un autre vendeur ne voit ni ne sert la demande", async () => {
    const { buyer, orderId } = await vendorSale();
    const client = await codesApp(await authFor(buyer.id));
    const request = (await client.inject({ method: "POST", url: `/api/v1/orders/${orderId}/verification-code` })).json().data;

    const otherOwner = await createUser(t, { role: "VENDOR", kycVerified: true });
    await createSeller(t, otherOwner);
    const other = await codesApp(await authFor(otherOwner.id));
    const queue = (await other.inject({ method: "GET", url: "/api/v1/verification-codes" })).json().data;
    expect(queue.items.map((r: { id: string }) => r.id)).not.toContain(request.id);
    const denied = await other.inject({ method: "POST", url: `/api/v1/verification-codes/${request.id}/provide`, payload: { code: "123456" } });
    expect(denied.statusCode).toBe(404);
    await client.close();
    await other.close();
  });

  it("l'équipe (admin, manager ORDERS) sert toutes les demandes ; un manager sans ORDERS non", async () => {
    const { buyer, orderId } = await vendorSale();
    const client = await codesApp(await authFor(buyer.id));
    const request = (await client.inject({ method: "POST", url: `/api/v1/orders/${orderId}/verification-code` })).json().data;

    const noPerm = await createStaff(t, ["SUPPORT"]);
    const blocked = await codesApp(noPerm.session);
    expect((await blocked.inject({ method: "GET", url: "/api/v1/verification-codes" })).statusCode).toBe(403);

    const admin = await createAdmin(t);
    const adminApp = await codesApp(admin.session);
    const queue = (await adminApp.inject({ method: "GET", url: "/api/v1/verification-codes" })).json().data;
    expect(queue.scope).toBe("team");
    expect(queue.items.map((r: { id: string }) => r.id)).toContain(request.id);

    const manager = await createStaff(t, ["ORDERS"]);
    const managerApp = await codesApp(manager.session);
    const ok = await managerApp.inject({ method: "POST", url: `/api/v1/verification-codes/${request.id}/provide`, payload: { code: "AB-778" } });
    expect(ok.statusCode).toBe(200);

    // L'admin voit l'auteur réel ; le vendeur verrait « Équipe MISTERDOU ».
    const all = (await adminApp.inject({ method: "GET", url: "/api/v1/verification-codes?status=ALL" })).json().data;
    const row = all.items.find((r: { id: string }) => r.id === request.id);
    expect(row.providedBy).not.toBe("Équipe MISTERDOU");

    await Promise.all([client.close(), blocked.close(), adminApp.close(), managerApp.close()]);
  });

  it("un code expiré peut être redemandé", async () => {
    const { owner, buyer, orderId } = await vendorSale();
    const client = await codesApp(await authFor(buyer.id));
    const first = (await client.inject({ method: "POST", url: `/api/v1/orders/${orderId}/verification-code` })).json().data;
    const seller = await codesApp(await authFor(owner.id));
    await seller.inject({ method: "POST", url: `/api/v1/verification-codes/${first.id}/provide`, payload: { code: "555000" } });

    await prisma.verificationCodeRequest.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const expired = await getMyOrder(orderId, buyer.id);
    expect(expired.verificationCode).toMatchObject({ status: "EXPIRED", code: null });

    const second = (await client.inject({ method: "POST", url: `/api/v1/orders/${orderId}/verification-code` })).json().data;
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("PENDING");
    await client.close();
    await seller.close();
  });

  it("refuse une demande avant la livraison", async () => {
    const product = await createProduct(t, { withCredential: true });
    const buyer = await createUser(t, { kycVerified: true });
    const pending = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
    track(t, "orderIds", pending.orderId);
    const client = await codesApp(await authFor(buyer.id));
    const res = await client.inject({ method: "POST", url: `/api/v1/orders/${pending.orderId}/verification-code` });
    expect(res.statusCode).toBe(409);
    await client.close();
  });
});

describe("Mensualités payées d'avance", () => {
  it("un paiement de deux mois solde deux échéances d'un coup", async () => {
    const product = await createProduct(t, {
      paymentMode: "INSTALLMENTS",
      installmentMonths: 4,
      installmentDownPayment: 20_000,
      basePrice: 100_000,
      withCredential: true,
    });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "INSTALLMENTS" }, { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    const down = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    await settlePayment({ id: down.id }, "SUCCESS", { source: "MANUAL" });

    await expect(createNextInstallmentPayment(order.orderId, { actorId: buyer.id }, 5)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const one = await createNextInstallmentPayment(order.orderId, { actorId: buyer.id }, 1);
    const two = await createNextInstallmentPayment(order.orderId, { actorId: buyer.id }, 2);
    expect(two.amount).toBe(40_000);
    // Changer le nombre de mois annule le paiement en attente précédent.
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: one.paymentId } })).status).toBe("CANCELLED");

    await settlePayment({ id: two.paymentId }, "SUCCESS", { source: "MANUAL" });
    const schedule = (await getMyOrder(order.orderId, buyer.id)).schedule!;
    expect(schedule.installments.map((i) => i.status)).toEqual(["PAID", "PAID", "PENDING", "PENDING"]);
    expect(schedule.totalPaid).toBe(60_000);

    // Le reste d'un coup : le plan est soldé et le compte livré.
    const rest = await createNextInstallmentPayment(order.orderId, { actorId: buyer.id }, 2);
    expect(rest.amount).toBe(40_000);
    await settlePayment({ id: rest.paymentId }, "SUCCESS", { source: "MANUAL" });
    const done = await getMyOrder(order.orderId, buyer.id);
    expect(done.status).toBe("DELIVERED");
    expect(done.schedule?.fullyPaid).toBe(true);
  });
});
