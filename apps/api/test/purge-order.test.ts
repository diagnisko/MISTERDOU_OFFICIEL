// Effacement d'une commande de test : plus aucune trace dans les statistiques,
// solde du vendeur remis comme avant, compte désactivé ; mot de passe exigé.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { buildMiniApp, cleanup, createAdmin, createProduct, createSeller, createUser, tracker } from "./helpers.js";
import { confirmReceipt, createOrder, createOrderSchema } from "../src/modules/orders/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { registerAdminOpsRoutes } from "../src/modules/admin-ops/routes.js";

const t = tracker();
afterAll(async () => {
  await cleanup(t);
});

describe("Effacer une commande de test", () => {
  it("retire commande, paiements et part du vendeur ; le compte est désactivé", async () => {
    const admin = await createAdmin(t);
    const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, owner);
    const product = await createProduct(t, { sellerId: seller.id, basePrice: 20_000, withCredential: true });
    const balanceBefore = await prisma.sellerBalance.findUnique({ where: { sellerId: seller.id } });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder(createOrderSchema.parse({ productId: product.id }), { actorId: buyer.id });
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    await confirmReceipt(order.orderId, { actorId: buyer.id });
    expect((await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).balanceAvailable).toBe((balanceBefore?.balanceAvailable ?? 0) + 17_000);

    const app = await buildMiniApp({ auth: admin.session }, async (i) => {
      await i.register(registerAdminOpsRoutes, { prefix: "/api/v1" });
    });
    const url = `/api/v1/admin/orders/${order.orderId}/test`;
    expect((await app.inject({ method: "DELETE", url, payload: {} })).json().error.code).toBe("PASSWORD_REQUIRED");
    const ok = await app.inject({ method: "DELETE", url, payload: { password: "MotDePasse123!" } });
    expect(ok.statusCode).toBe(200);

    expect(await prisma.order.count({ where: { id: order.orderId } })).toBe(0);
    expect(await prisma.payment.count({ where: { id: payment.id } })).toBe(0);
    const after = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(after).toMatchObject({ balanceAvailable: balanceBefore?.balanceAvailable ?? 0, balancePending: balanceBefore?.balancePending ?? 0, totalEarnings: balanceBefore?.totalEarnings ?? 0 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("SUSPENDED");
    expect(await prisma.auditLog.count({ where: { action: "TEST_ORDER_PURGED", resourceId: order.orderId } })).toBe(1);
    await app.close();
  });
});
