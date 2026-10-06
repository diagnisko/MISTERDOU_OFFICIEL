// Contrat revendeur : forfait payé d'avance (6, 12 ou 18 mois) à la place de la
// commission ; adhésion vendeur incluse ; renouvellement à la suite ; fin du
// contrat = retour à la commission habituelle.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { cleanup, createProduct, createUser, expectApiError, track, tracker } from "./helpers.js";
import { addMonths, contractState, requestContract, runContractJobs } from "../src/modules/seller/contract.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { createOrder } from "../src/modules/orders/service.js";

const t = tracker();
const DAY_MS = 86_400_000;

afterAll(async () => {
  await cleanup(t);
});

async function payContract(userId: string, months: 6 | 12 | 18) {
  const { checkoutUrl, amount } = await requestContract(months, { actorId: userId });
  const token = checkoutUrl.split("/").pop()!;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { transactionToken: token } });
  track(t, "paymentIds", payment.id);
  await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
  track(t, "sellerIds", (await prisma.seller.findUnique({ where: { userId }, select: { id: true } }))?.id);
  return { payment, amount };
}

async function sale(sellerUserId: string, price = 20_000) {
  const seller = await prisma.seller.findUniqueOrThrow({ where: { userId: sellerUserId } });
  const product = await createProduct(t, { sellerId: seller.id, basePrice: price, withCredential: true });
  const buyer = await createUser(t, { kycVerified: true });
  const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
  track(t, "orderIds", order.orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
  return prisma.commission.findFirstOrThrow({ where: { orderItem: { orderId: order.orderId } } });
}

describe("Contrat revendeur", () => {
  it("exige une identité vérifiée", async () => {
    const client = await createUser(t);
    expect((await expectApiError(() => requestContract(6, { actorId: client.id }))).code).toBe("SELLER_NOT_KYC_VERIFIED");
  });

  it("aux prix affichés ; reprend le même paiement, en remplace un d'une autre durée", async () => {
    const client = await createUser(t, { kycVerified: true });
    const state = await contractState(client.id);
    expect(state.plans).toEqual([
      { months: 6, price: 5000 },
      { months: 12, price: 8000 },
      { months: 18, price: 10000 },
    ]);

    const first = await requestContract(6, { actorId: client.id });
    expect(first.amount).toBe(5000);
    expect((await requestContract(6, { actorId: client.id })).checkoutUrl).toBe(first.checkoutUrl);
    const year = await requestContract(12, { actorId: client.id });
    expect(year.amount).toBe(8000);
    expect(year.checkoutUrl).not.toBe(first.checkoutUrl);
    const old = await prisma.payment.findUniqueOrThrow({ where: { transactionToken: first.checkoutUrl.split("/").pop()! } });
    expect(old.status).toBe("CANCELLED");
    expect((await contractState(client.id)).pending).toMatchObject({ months: 12, amount: 8000 });
  });

  it("payé : le client devient vendeur, 0 % de commission pendant le contrat, renouvellement à la suite", async () => {
    const client = await createUser(t, { kycVerified: true });
    const before = Date.now();
    const { payment } = await payContract(client.id, 6);
    expect(payment.type).toBe("SELLER_CONTRACT");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, include: { role: true, seller: true } });
    expect(user.role.name).toBe("VENDOR");
    expect(user.seller?.status).toBe("ACTIVE");
    const contract = await prisma.sellerContract.findFirstOrThrow({ where: { userId: client.id, status: "ACTIVE" } });
    expect(contract.startsAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(contract.endsAt!.getTime()).toBe(addMonths(contract.startsAt!, 6).getTime());

    const free = await sale(client.id, 20_000);
    expect(free).toMatchObject({ commissionRate: 0, commissionAmount: 0, netToSeller: 20_000 });

    // Renouvellement avant la fin : 18 mois de plus, à la suite du contrat en cours.
    await payContract(client.id, 18);
    const renewed = await prisma.sellerContract.findFirstOrThrow({ where: { userId: client.id, months: 18, status: "ACTIVE" } });
    expect(renewed.startsAt!.getTime()).toBe(contract.endsAt!.getTime());
    expect((await contractState(client.id)).coveredUntil).toBe(renewed.endsAt!.toISOString());
  });

  it("rappel 7 jours avant la fin, puis retour à la commission", async () => {
    const client = await createUser(t, { kycVerified: true });
    await payContract(client.id, 6);
    const contract = await prisma.sellerContract.findFirstOrThrow({ where: { userId: client.id, status: "ACTIVE" } });

    // À 5 jours de la fin : un rappel, une seule fois.
    await prisma.sellerContract.update({ where: { id: contract.id }, data: { startsAt: new Date(Date.now() - 170 * DAY_MS), endsAt: new Date(Date.now() + 5 * DAY_MS) } });
    await runContractJobs();
    await runContractJobs();
    expect(await prisma.notification.count({ where: { userId: client.id, title: "Votre contrat revendeur se termine bientôt" } })).toBe(1);

    // Terminé : statut EXPIRED, vendeur prévenu, commission habituelle sur la vente suivante.
    await prisma.sellerContract.update({ where: { id: contract.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await runContractJobs();
    expect((await prisma.sellerContract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("EXPIRED");
    expect(await prisma.notification.count({ where: { userId: client.id, title: "Contrat revendeur terminé" } })).toBe(1);
    const paid = await sale(client.id, 20_000);
    expect(paid).toMatchObject({ commissionRate: 15, commissionAmount: 3_000 });
  });

  it("calcule les fins de mois sans déborder", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2026-08-15T00:00:00Z"), 18).toISOString()).toBe("2028-02-15T00:00:00.000Z");
  });
});
