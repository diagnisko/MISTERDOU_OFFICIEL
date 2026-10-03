// Devenir vendeur (frais d'adhésion) et interdiction d'acheter sa propre offre.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { cleanup, createProduct, createSeller, createUser, expectApiError, track, tracker } from "./helpers.js";
import { requestSellerJoin, sellerJoinState } from "../src/modules/seller/join.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function payJoin(userId: string) {
  const { checkoutUrl, amount } = await requestSellerJoin({ actorId: userId });
  const token = checkoutUrl.replace("/checkout/", "");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { transactionToken: token } });
  track(t, "paymentIds", payment.id);
  return { payment, amount, checkoutUrl };
}

async function trackSeller(userId: string) {
  const seller = await prisma.seller.findUnique({ where: { userId }, select: { id: true } });
  track(t, "sellerIds", seller?.id);
  return seller;
}

describe("Devenir vendeur", () => {
  it("exige une identité vérifiée", async () => {
    const client = await createUser(t);
    const err = await expectApiError(() => requestSellerJoin({ actorId: client.id }));
    expect(err.code).toBe("SELLER_NOT_KYC_VERIFIED");
    expect((await sellerJoinState(client.id)).kycVerified).toBe(false);
  });

  it("ouvre un paiement de 1 000 FCFA, repris tant qu'il n'est pas réglé", async () => {
    const client = await createUser(t, { kycVerified: true });
    const first = await payJoin(client.id);
    expect(first.amount).toBe(1000);
    expect(first.payment.type).toBe("SELLER_REGISTRATION_FEE");
    const again = await requestSellerJoin({ actorId: client.id });
    expect(again.checkoutUrl).toBe(first.checkoutUrl);
    expect((await sellerJoinState(client.id)).checkoutUrl).toBe(first.checkoutUrl);
    expect(await trackSeller(client.id)).toBeNull();
  });

  it("passe le compte vendeur dès le paiement confirmé", async () => {
    const client = await createUser(t, { kycVerified: true });
    const { payment } = await payJoin(client.id);
    await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });

    const seller = await prisma.seller.findUniqueOrThrow({
      where: { userId: client.id },
      select: { id: true, status: true, registrationFee: true, registrationPaidAt: true, sellerBalance: { select: { id: true } } },
    });
    track(t, "sellerIds", seller.id);
    expect(seller.status).toBe("ACTIVE");
    expect(seller.registrationFee).toBe(1000);
    expect(seller.registrationPaidAt).not.toBeNull();
    expect(seller.sellerBalance).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { role: { select: { name: true } } } });
    expect(user.role.name).toBe("VENDOR");

    // Un second paiement confirmé ne change rien, et une nouvelle demande est refusée.
    await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    const err = await expectApiError(() => requestSellerJoin({ actorId: client.id }));
    expect(err.code).toBe("SELLER_ALREADY_ACTIVE");
  });

  it("n'active pas un vendeur suspendu", async () => {
    const user = await createUser(t, { role: "VENDOR", kycVerified: true });
    await createSeller(t, user, { status: "SUSPENDED" });
    const err = await expectApiError(() => requestSellerJoin({ actorId: user.id }));
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("Vendeur acheteur", () => {
  it("achète l'offre d'un autre, jamais la sienne", async () => {
    const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, owner);
    const mine = await createProduct(t, { sellerId: seller.id });
    const other = await createProduct(t, { sellerId: null });

    const err = await expectApiError(() =>
      createOrder(createOrderSchema.parse({ productId: mine.id }), { actorId: owner.id }),
    );
    expect(err.code).toBe("OWN_OFFER");

    const order = await createOrder(createOrderSchema.parse({ productId: other.id }), { actorId: owner.id });
    track(t, "orderIds", order.orderId);
    expect(order.orderId).toBeTruthy();
  });
});
