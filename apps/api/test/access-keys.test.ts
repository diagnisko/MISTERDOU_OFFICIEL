// Clés d'accès ajoutées APRÈS l'achat (compte vendu ou en mensualités) : le
// client les voit aussitôt ; offre supprimée par l'équipe ; échéancier soldé
// ou annulé avec le mot de passe de la personne connectée.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createProduct, createSeller, createUser, expectApiError, track, tracker } from "./helpers.js";
import { createOrder, createOrderSchema, revealCredentials } from "../src/modules/orders/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { removeOffer, setOfferCredential } from "../src/modules/offers/service.js";
import { registerAdminOpsRoutes } from "../src/modules/admin-ops/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

/** Achat en mensualités d'un compte SANS identifiants, apport validé (accès ouvert). */
async function boughtWithoutKey() {
  const buyer = await createUser(t, { kycVerified: true });
  const product = await createProduct(t, { paymentMode: "INSTALLMENTS", installmentMonths: 3, installmentDownPayment: 20_000, basePrice: 80_000 });
  const order = await createOrder(createOrderSchema.parse({ productId: product.id, paymentMode: "INSTALLMENTS" }), { actorId: buyer.id });
  track(t, "orderIds", order.orderId);
  const down = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId, type: "INITIAL_INSTALLMENT" } });
  await settlePayment({ id: down.id }, "SUCCESS", { source: "MANUAL" });
  return { buyer, product, orderId: order.orderId };
}

describe("Clé d'accès ajoutée après l'achat", () => {
  it("le client voit un message clair, l'équipe est prévenue ; une fois la clé saisie, il la voit et il est notifié", async () => {
    const admin = await createAdmin(t);
    const { buyer, product, orderId } = await boughtWithoutKey();

    const before = await expectApiError(() => revealCredentials(orderId, { actorId: buyer.id }));
    expect(before.message).toContain("pas encore été ajoutés");
    expect(await prisma.notification.count({ where: { userId: admin.user.id, title: "Clé d’accès attendue par un client" } })).toBe(1);

    // Compte en mensualités (achat en cours) : la saisie de la clé passe quand même.
    const saved = await setOfferCredential(product.id, { loginId: "joueur-p13@example.com", password: "Secret-du-compte-1" }, { kind: "moderator" }, { actorId: admin.user.id, actorRole: "ADMIN" });
    expect(saved).toMatchObject({ replaced: false, notifiedBuyers: 1 });

    const revealed = await revealCredentials(orderId, { actorId: buyer.id });
    expect(revealed).toMatchObject({ email: "joueur-p13@example.com", password: "Secret-du-compte-1" });
    expect(await prisma.notification.count({ where: { userId: buyer.id, title: "Identifiants du compte disponibles" } })).toBe(1);

    // Remplacement : le client voit les nouveaux identifiants.
    await setOfferCredential(product.id, { loginId: "joueur-p13@example.com", password: "Nouveau-secret-2" }, { kind: "moderator" }, { actorId: admin.user.id });
    expect((await revealCredentials(orderId, { actorId: buyer.id })).password).toBe("Nouveau-secret-2");
  });

  it("un vendeur saisit la clé de sa propre offre, jamais celle d'un autre", async () => {
    const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, owner);
    const mine = await createProduct(t, { sellerId: seller.id, status: "SOLD" });
    const other = await createProduct(t);
    await expect(setOfferCredential(mine.id, { loginId: "abc@example.com", password: "x1" }, { kind: "seller", sellerId: seller.id }, { actorId: owner.id })).resolves.toMatchObject({ replaced: false });
    const err = await expectApiError(() => setOfferCredential(other.id, { loginId: "abc@example.com", password: "x1" }, { kind: "seller", sellerId: seller.id }, { actorId: owner.id }));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("Suppression d'une offre par l'équipe", () => {
  it("supprime l'offre d'un vendeur (vendeur prévenu), refuse une offre vendue", async () => {
    const admin = await createAdmin(t);
    const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, owner);
    const offer = await createProduct(t, { sellerId: seller.id });
    await removeOffer(offer.id, { kind: "moderator" }, { actorId: admin.user.id, actorRole: "ADMIN" });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: offer.id } })).toMatchObject({ status: "ARCHIVED", deletedAt: expect.any(Date) });
    expect(await prisma.notification.count({ where: { userId: owner.id, title: "Offre retirée par l’équipe" } })).toBe(1);

    const sold = await createProduct(t, { status: "SOLD" });
    expect((await expectApiError(() => removeOffer(sold.id, { kind: "moderator" }, { actorId: admin.user.id }))).code).toBe("INVALID_STATE");
  });
});

describe("Échéanciers : solde et annulation avec mot de passe", () => {
  async function opsApp() {
    const admin = await createAdmin(t);
    const app = await buildMiniApp({ auth: admin.session }, async (instance) => {
      await instance.register(registerAdminOpsRoutes, { prefix: "/api/v1" });
    });
    return app;
  }

  it("solder exige le mot de passe", async () => {
    const app = await opsApp();
    const { orderId } = await boughtWithoutKey();
    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId } });
    const none = await app.inject({ method: "POST", url: "/api/v1/admin/plans/settle", payload: { planId: plan.id } });
    expect(none.json().error.code).toBe("PASSWORD_REQUIRED");
    const wrong = await app.inject({ method: "POST", url: "/api/v1/admin/plans/settle", payload: { planId: plan.id, password: "faux-mot" } });
    expect(wrong.json().error.code).toBe("INVALID_PASSWORD");
    const ok = await app.inject({ method: "POST", url: "/api/v1/admin/plans/settle", payload: { planId: plan.id, password: "MotDePasse123!" } });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("COMPLETED");
    await app.close();
  });

  it("annuler le contrat : accès fermé, échéances annulées, offre désactivée, client prévenu", async () => {
    const app = await opsApp();
    const { buyer, product, orderId } = await boughtWithoutKey();
    await prisma.productCredential.create({ data: { productId: product.id, encryptedEmail: "x", encryptedPassword: "y" } });
    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId } });

    const noPassword = await app.inject({ method: "POST", url: `/api/v1/admin/plans/${plan.id}/cancel`, payload: { reason: "Mensualités impayées" } });
    expect(noPassword.json().error.code).toBe("PASSWORD_REQUIRED");
    const res = await app.inject({ method: "POST", url: `/api/v1/admin/plans/${plan.id}/cancel`, payload: { reason: "Mensualités impayées", password: "MotDePasse123!" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "CANCELLED", alreadyPaid: 20_000 });

    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("CANCELLED");
    expect(await prisma.installment.count({ where: { planId: plan.id, status: { not: "CANCELLED" } } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SUSPENDED");
    expect((await expectApiError(() => revealCredentials(orderId, { actorId: buyer.id }))).code).toBe("ORDER_NOT_DELIVERED");
    expect(await prisma.notification.count({ where: { userId: buyer.id, title: "Paiement en plusieurs fois annulé" } })).toBe(1);

    const again = await app.inject({ method: "POST", url: `/api/v1/admin/plans/${plan.id}/cancel`, payload: { reason: "Encore", password: "MotDePasse123!" } });
    expect(again.json().error.code).toBe("INVALID_STATE");
    await app.close();
  });
});
