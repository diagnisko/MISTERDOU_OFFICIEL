// Fenêtre des messages, paiement en plusieurs fois en vérification, captures
// supprimées après validation, CSRF sans session.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createProduct, createSeller, createUser, expectApiError, putStorageFile, tracker, track } from "./helpers.js";
import { registerProductChatRoutes } from "../src/modules/product-chat/routes.js";
import { registerMessagingRoutes } from "../src/modules/messaging/routes.js";
import { registerAdminConsoleRoutes } from "../src/modules/admin-console/routes.js";
import { createOrder, getMyOrder, listMyOrders, revealCredentials } from "../src/modules/orders/service.js";
import { requestVerificationCode } from "../src/modules/verification-codes/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { createNextInstallmentPayment, getSchedule } from "../src/modules/installments/service.js";
import { approvePaymentProof, purgeProofScreenshots, submitPaymentProof } from "../src/modules/payments/proofs.js";
import { getFile } from "../src/lib/storage.js";

const t = tracker();
const WAVE_LINK = "https://pay.wave.com/m/M_sn_TEST/c/sn/";

afterAll(async () => {
  await cleanup(t);
});

async function ensureWaveLink() {
  const row = await prisma.settings.findUnique({ where: { key: "waveMerchantLink" } });
  if (!row) {
    await prisma.settings.create({ data: { key: "waveMerchantLink", value: WAVE_LINK, valueType: "string", group: "payments" } });
    t.settingsKeys.push("waveMerchantLink");
  } else if (typeof row.value !== "string" || !row.value.startsWith("https://pay.wave.com/")) {
    await prisma.settings.update({ where: { key: "waveMerchantLink" }, data: { value: WAVE_LINK } });
  }
}

async function proofFor(userId: string, token: string) {
  const key = await putStorageFile(t, `proofs/${userId}/payment_proof/${randomUUID()}`);
  return submitPaymentProof(token, { proofKey: key, senderPhone: "771234567" }, { actorId: userId });
}

describe("Tableau de bord de l'équipe", () => {
  it("affiche les 6 derniers paiements (petites pages acceptées)", async () => {
    const { session } = await createAdmin(t);
    const app = await buildMiniApp({ auth: session }, async (a) => {
      await a.register(registerAdminConsoleRoutes, { prefix: "/api/v1" });
    });
    // Le tableau de bord demande perPage=6 : refusé avant (« Données invalides »).
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/payments?page=1&perPage=6" });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.perPage).toBe(6);
    await app.close();
  });
});

describe("Suppressions de l'équipe : mot de passe exigé", () => {
  it("supprime un compte client seulement avec le bon mot de passe, et l'anonymise", async () => {
    const { session } = await createAdmin(t);
    const client = await createUser(t, { kycVerified: true });
    const app = await buildMiniApp({ auth: session }, async (a) => {
      await a.register(registerAdminConsoleRoutes, { prefix: "/api/v1" });
    });
    const url = `/api/v1/admin/clients/${client.id}`;
    expect((await app.inject({ method: "DELETE", url, payload: {} })).json().error.code).toBe("PASSWORD_REQUIRED");
    expect((await app.inject({ method: "DELETE", url, payload: { password: "mauvais" } })).json().error.code).toBe("INVALID_PASSWORD");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).deletedAt).toBeNull();

    const ok = await app.inject({ method: "DELETE", url, payload: { password: "MotDePasse123!" } });
    expect(ok.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
    expect(row).toMatchObject({ firstName: "Compte", lastName: "supprimé", passwordHash: null, status: "SUSPENDED" });
    expect(row.email).toMatch(/@misterdou\.invalid$/);
    expect(row.deletedAt).not.toBeNull();
    await app.close();
  });

  it("refuse de supprimer un client dont une commande est en cours", async () => {
    const { session } = await createAdmin(t);
    const client = await createUser(t, { kycVerified: true });
    const product = await createProduct(t);
    const order = await prisma.order.create({
      data: { orderNumber: `MD-T-${randomUUID().slice(0, 8)}`, buyerId: client.id, status: "PAID", totalAmount: product.basePrice },
    });
    track(t, "orderIds", order.id);
    const app = await buildMiniApp({ auth: session }, async (a) => {
      await a.register(registerAdminConsoleRoutes, { prefix: "/api/v1" });
    });
    const res = await app.inject({ method: "DELETE", url: `/api/v1/admin/clients/${client.id}`, payload: { password: "MotDePasse123!" } });
    expect(res.json().error.code).toBe("ACCOUNT_BUSY");
    await app.close();
  });
});

describe("Fenêtre des messages", () => {
  it("liste les dernières discussions avec un lien direct vers chacune", async () => {
    const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, owner);
    const product = await createProduct(t, { sellerId: seller.id });
    const client = await createUser(t, { kycVerified: true });

    const clientApp = await buildMiniApp({ auth: await authFor(client.id) }, async (app) => {
      await app.register(registerProductChatRoutes, { prefix: "/api/v1" });
    });
    expect((await clientApp.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "Bonjour, le compte est-il toujours dispo ?" } })).statusCode).toBe(200);
    const mine = (await clientApp.inject({ method: "GET", url: "/api/v1/threads/recent" })).json().data;
    expect(mine.items[0]).toMatchObject({ kind: "product", title: product.title });
    expect(mine.items[0].href).toMatch(/^\/account\/messages\?thread=/);
    await clientApp.close();

    const sellerApp = await buildMiniApp({ auth: await authFor(owner.id) }, async (app) => {
      await app.register(registerProductChatRoutes, { prefix: "/api/v1" });
    });
    const inbox = (await sellerApp.inject({ method: "GET", url: "/api/v1/threads/recent" })).json().data;
    const item = inbox.items.find((i: { title: string }) => i.title === product.title);
    expect(item).toMatchObject({ unread: 1, preview: "Bonjour, le compte est-il toujours dispo ?" });
    expect(item.href).toMatch(/^\/seller\/messages\?thread=/);
    expect(inbox.total).toBeGreaterThanOrEqual(1);
    await sellerApp.close();
  });
});

describe("Paiement en plusieurs fois avec preuve Wave", () => {
  it("marque les mois en vérification et bloque un second paiement d'ici la validation", async () => {
    await ensureWaveLink();
    const product = await createProduct(t, { paymentMode: "INSTALLMENTS", installmentMonths: 4, installmentDownPayment: 20_000, basePrice: 100_000 });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "INSTALLMENTS" }, { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    const down = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    await settlePayment({ id: down.id }, "SUCCESS", { source: "MANUAL" });

    const two = await createNextInstallmentPayment(order.orderId, { actorId: buyer.id }, 2);
    await proofFor(buyer.id, two.token!);
    const schedule = await getSchedule(order.orderId);
    expect(schedule?.reviewing).toMatchObject({ downPayment: false, months: [1, 2], amount: two.amount });

    const blocked = await expectApiError(() => createNextInstallmentPayment(order.orderId, { actorId: buyer.id }, 1));
    expect(blocked.code).toBe("PROOF_ALREADY_SENT");
  });
});

describe("Captures supprimées une fois inutiles", () => {
  it("efface la capture à la validation et rattrape les anciennes", async () => {
    await ensureWaveLink();
    const admin = await createAdmin(t);
    const product = await createProduct(t, { withCredential: true });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    const sent = await proofFor(buyer.id, order.token);
    const before = await prisma.paymentProof.findUniqueOrThrow({ where: { id: sent.proof.id } });
    await expect(getFile(before.screenshotKey)).resolves.toBeTruthy();

    await approvePaymentProof(sent.proof.id, { actorId: admin.user.id, actorRole: "ADMIN" });
    const after = await prisma.paymentProof.findUniqueOrThrow({ where: { id: sent.proof.id } });
    expect(after.screenshotKey).toBe("");
    await expect(getFile(before.screenshotKey)).rejects.toBeTruthy();

    // Rattrapage : une ancienne preuve validée qui avait encore sa capture.
    const legacyKey = await putStorageFile(t, `proofs/${buyer.id}/payment_proof/${randomUUID()}`);
    await prisma.paymentProof.update({ where: { id: sent.proof.id }, data: { screenshotKey: legacyKey } });
    expect(await purgeProofScreenshots()).toBeGreaterThanOrEqual(1);
    expect((await prisma.paymentProof.findUniqueOrThrow({ where: { id: sent.proof.id } })).screenshotKey).toBe("");
  });
});

describe("Messagerie avec le support", () => {
  it("le client écrit à l'équipe, l'équipe lit et répond ; un tiers n'y a pas accès", async () => {
    const admin = await createAdmin(t);
    const client = await createUser(t, { kycVerified: true });
    const register = async (instance: Parameters<typeof registerMessagingRoutes>[0]) => {
      await instance.register(registerMessagingRoutes, { prefix: "/api/v1" });
      await instance.register(registerProductChatRoutes, { prefix: "/api/v1" });
    };

    const clientApp = await buildMiniApp({ auth: await authFor(client.id) }, register);
    const opened = await clientApp.inject({ method: "POST", url: "/api/v1/conversations", payload: { kind: "CLIENT_TO_ADMIN", withUserId: admin.user.id } });
    expect(opened.statusCode).toBe(200);
    const convoId = opened.json().data.id as string;
    track(t, "conversationIds", convoId);
    expect((await clientApp.inject({ method: "POST", url: `/api/v1/conversations/${convoId}/messages`, payload: { content: "Je n’arrive pas à me connecter au compte." } })).statusCode).toBe(200);

    const adminApp = await buildMiniApp({ auth: admin.session }, register);
    const list = (await adminApp.inject({ method: "GET", url: "/api/v1/conversations" })).json().data as Array<{ id: string; unread: number }>;
    expect(list.find((c) => c.id === convoId)?.unread).toBe(1);
    const read = await adminApp.inject({ method: "GET", url: `/api/v1/conversations/${convoId}/messages` });
    expect(read.statusCode).toBe(200);
    expect((await adminApp.inject({ method: "POST", url: `/api/v1/conversations/${convoId}/messages`, payload: { content: "Bonjour, on regarde ensemble." } })).statusCode).toBe(200);
    await adminApp.close();

    // Le client voit la réponse dans la fenêtre des messages, avec un lien direct.
    const recent = (await clientApp.inject({ method: "GET", url: "/api/v1/threads/recent" })).json().data;
    const support = recent.items.find((i: { key: string }) => i.key === `c:${convoId}`);
    expect(support).toMatchObject({ kind: "support", unread: 1, href: `/messages?c=${convoId}`, preview: "Bonjour, on regarde ensemble." });
    await clientApp.close();

    const stranger = await createUser(t);
    const strangerApp = await buildMiniApp({ auth: await authFor(stranger.id) }, register);
    const denied = await strangerApp.inject({ method: "GET", url: `/api/v1/conversations/${convoId}/messages` });
    expect([403, 404]).toContain(denied.statusCode);
    await strangerApp.close();
  });
});

describe("Mensualités : apport et mois dans un même paiement", () => {
  async function planOrder() {
    const product = await createProduct(t, { paymentMode: "INSTALLMENTS", installmentMonths: 3, installmentDownPayment: 30_000, basePrice: 120_000, withCredential: true });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "INSTALLMENTS" }, { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    return { product, buyer, orderId: order.orderId };
  }

  it("apport + 2 mois, puis le dernier mois livre le compte", async () => {
    const { product, buyer, orderId } = await planOrder();
    const first = await createNextInstallmentPayment(orderId, { actorId: buyer.id }, 2);
    expect(first.amount).toBe(90_000);
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: first.paymentId } });
    expect(pay.type).toBe("INITIAL_INSTALLMENT");
    // Une seule demande d'apport : la commande n'a pas deux paiements ouverts.
    expect(await prisma.payment.count({ where: { orderId, status: "PENDING" } })).toBe(1);

    await settlePayment({ id: first.paymentId }, "SUCCESS", { source: "MANUAL" });
    const schedule = await getSchedule(orderId);
    expect(schedule).toMatchObject({ downPaid: true, totalPaid: 90_000, remainingAmount: 30_000 });
    expect(schedule!.installments.map((l) => l.status)).toEqual(["PAID", "PAID", "PENDING"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PARTIALLY_PAID");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SOLD");

    const last = await createNextInstallmentPayment(orderId, { actorId: buyer.id }, 1);
    expect(last.amount).toBe(30_000);
    await settlePayment({ id: last.paymentId }, "SUCCESS", { source: "MANUAL" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
  });

  it("l'apport validé ouvre l'accès au compte (identifiants, codes), pas avant", async () => {
    const { buyer, orderId } = await planOrder();
    expect((await expectApiError(() => revealCredentials(orderId, { actorId: buyer.id }))).code).toBe("ORDER_NOT_DELIVERED");
    expect((await expectApiError(() => requestVerificationCode(orderId, { actorId: buyer.id }))).code).toBe("ORDER_NOT_DELIVERED");

    const down = await createNextInstallmentPayment(orderId, { actorId: buyer.id }, 0);
    await settlePayment({ id: down.paymentId }, "SUCCESS", { source: "MANUAL" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PARTIALLY_PAID");
    expect((await listMyOrders(buyer.id)).find((o) => o.id === orderId)?.canReveal).toBe(true);
    expect((await getMyOrder(orderId, buyer.id)).canReveal).toBe(true);
    await expect(revealCredentials(orderId, { actorId: buyer.id })).resolves.toMatchObject({ email: expect.any(String), password: expect.any(String) });
    await expect(requestVerificationCode(orderId, { actorId: buyer.id })).resolves.toBeTruthy();
    const note = await prisma.notification.findFirst({ where: { userId: buyer.id, title: { startsWith: "Apport confirmé" } } });
    expect(note?.message).toContain("identifiants");
  });

  it("apport seul (0 mois), puis 2 mois ensemble", async () => {
    const { buyer, orderId } = await planOrder();
    const down = await createNextInstallmentPayment(orderId, { actorId: buyer.id }, 0);
    expect(down.amount).toBe(30_000);
    await settlePayment({ id: down.paymentId }, "SUCCESS", { source: "MANUAL" });
    expect((await getSchedule(orderId))!.installments.every((l) => l.status === "PENDING")).toBe(true);

    await expect(createNextInstallmentPayment(orderId, { actorId: buyer.id }, 0)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const two = await createNextInstallmentPayment(orderId, { actorId: buyer.id }, 2);
    expect(two.amount).toBe(60_000);
    await settlePayment({ id: two.paymentId }, "SUCCESS", { source: "MANUAL" });
    expect((await getSchedule(orderId))!.installments.map((l) => l.status)).toEqual(["PAID", "PAID", "PENDING"]);
  });

  it("apport + tous les mois d'un coup : le compte est livré tout de suite", async () => {
    const { buyer, orderId } = await planOrder();
    const all = await createNextInstallmentPayment(orderId, { actorId: buyer.id }, 3);
    expect(all.amount).toBe(120_000);
    await settlePayment({ id: all.paymentId }, "SUCCESS", { source: "MANUAL" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DELIVERED");
    expect((await getSchedule(orderId))).toMatchObject({ fullyPaid: true, remainingAmount: 0 });
  });
});
