// Effacement d'une commande de test payée en mensualités (contrat en cours).
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { cleanup, createAdmin, createProduct, createUser, track, tracker } from "./helpers.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { purgeTestOrder } from "../src/modules/admin-ops/purge-order.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

describe("Effacer une commande de test en mensualités", () => {
  it("efface la commande, l'apport payé, le contrat et ses échéances", async () => {
    const { user: admin } = await createAdmin(t);
    const product = await createProduct(t, { basePrice: 40_000, paymentMode: "INSTALLMENTS", installmentMonths: 3, installmentDownPayment: 10_000, withCredential: true });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder(createOrderSchema.parse({ productId: product.id, paymentMode: "INSTALLMENTS" }), { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    const apport = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    await settlePayment({ id: apport.id }, "SUCCESS", { source: "ADMIN" as never });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("PARTIALLY_PAID");

    await purgeTestOrder(order.orderId, { actorId: admin.id, actorRole: "ADMIN" });
    expect(await prisma.order.findUnique({ where: { id: order.orderId } })).toBeNull();
    expect(await prisma.installmentPlan.count({ where: { orderId: order.orderId } })).toBe(0);
    expect(await prisma.payment.count({ where: { id: apport.id } })).toBe(0);
  });
});
