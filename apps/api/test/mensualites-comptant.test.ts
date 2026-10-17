// Comptant et mensualités : une offre ouverte aux mensualités reste en vente
// comptant, et son prix total en mensualités (fixé par le vendeur) sert au
// paiement en plusieurs fois.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { buildMiniApp, cleanup, createProduct, createSeller, createUser, expectApiError, track, tracker } from "./helpers.js";
import { registerCatalogueRoutes } from "../src/modules/catalogue/routes.js";
import { createOffer, type CreateOfferInput } from "../src/modules/offers/service.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

function offer(overrides: Partial<CreateOfferInput> = {}): CreateOfferInput {
  return {
    gameAccountId: `MC${Date.now().toString(36)}${randomUUID().slice(0, 6)}`.toUpperCase(),
    acceptsExchange: false,
    title: "Compte Division 1 — 3 100 OVR",
    description: "Compte propre, e-mail de récupération fourni après l’achat.",
    division: "Division 1",
    teamPower: 3100,
    coins: 800,
    basePrice: 50_000,
    paymentMode: "INSTALLMENTS",
    installmentMonths: 4,
    installmentDownPayment: 10_000,
    installmentPrice: 60_000,
    credentials: { loginId: "joueur@example.com", password: "secret-du-compte" },
    ...overrides,
  };
}

describe("Comptant et mensualités", () => {
  it("Comptant montre aussi les offres ouvertes aux mensualités ; Mensualités seulement celles-là", async () => {
    const tag = `Comptant${randomUUID().slice(0, 6)}`;
    const cashOnly = await createProduct(t, { title: `${tag} comptant` });
    const both = await createProduct(t, { title: `${tag} deux`, paymentMode: "INSTALLMENTS", installmentMonths: 4, installmentDownPayment: 10_000 });
    await prisma.product.update({ where: { id: both.id }, data: { installmentPrice: 60_000 } });
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerCatalogueRoutes, { prefix: "/api" });
    });
    const list = async (mode: string) =>
      (await app.inject({ method: "GET", url: `/api/catalogue?q=${tag}&paymentMode=${mode}&perPage=48` })).json().data as Array<{
        id: string;
        price: number;
        installmentPrice: number | null;
        schedule: { total: number; downPayment: number; monthlyAmount: number; months: number } | null;
      }>;

    const cash = await list("ONE_TIME");
    expect(cash.map((p) => p.id).sort()).toEqual([cashOnly.id, both.id].sort());
    const monthly = await list("INSTALLMENTS");
    expect(monthly.map((p) => p.id)).toEqual([both.id]);

    // Prix comptant inchangé ; mensualités calculées sur le prix en mensualités.
    const row = monthly[0]!;
    expect(row.price).toBe(50_000);
    expect(row.installmentPrice).toBe(60_000);
    expect(row.schedule).toMatchObject({ total: 60_000, downPayment: 10_000, months: 4, monthlyAmount: 12_500 });

    // Décocher les mensualités : l'offre quitte Mensualités, reste en Comptant.
    await prisma.product.update({ where: { id: both.id }, data: { paymentMode: "ONE_TIME", installmentMonths: null, installmentDownPayment: null, installmentPrice: null } });
    expect((await list("INSTALLMENTS")).map((p) => p.id)).toEqual([]);
    expect((await list("ONE_TIME")).map((p) => p.id)).toContain(both.id);
    await app.close();
  });

  it("enregistre le prix en mensualités, jamais plus bas que comptant, l'apport plus petit que ce prix", async () => {
    const user = await createUser(t, { role: "VENDOR", kycVerified: true });
    const seller = await createSeller(t, user);
    const owner = { kind: "seller", sellerId: seller.id } as const;

    const created = await createOffer(offer(), owner, { actorId: user.id });
    track(t, "productIds", created.id);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      paymentMode: "INSTALLMENTS",
      basePrice: 50_000,
      installmentPrice: 60_000,
    });

    const lower = await expectApiError(() => createOffer(offer({ installmentPrice: 40_000 }), owner, { actorId: user.id }));
    expect((lower.details as { fields: Record<string, string> }).fields.installmentPrice).toContain("plus bas que le prix comptant");
    const tooBigDown = await expectApiError(() => createOffer(offer({ installmentDownPayment: 60_000 }), owner, { actorId: user.id }));
    expect((tooBigDown.details as { fields: Record<string, string> }).fields.installmentDownPayment).toContain("prix en mensualités");

    // Sans prix en mensualités : le même que comptant. Comptant seul : rien d'enregistré.
    const same = await createOffer(offer({ installmentPrice: null }), owner, { actorId: user.id });
    track(t, "productIds", same.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: same.id } })).installmentPrice).toBe(50_000);
    const cashOnly = await createOffer(offer({ paymentMode: "ONE_TIME" }), owner, { actorId: user.id });
    track(t, "productIds", cashOnly.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: cashOnly.id } })).installmentPrice).toBeNull();
  });

  it("facture le prix comptant en une fois, le prix en mensualités en plusieurs fois", async () => {
    const product = await createProduct(t, { basePrice: 50_000, paymentMode: "INSTALLMENTS", installmentMonths: 4, installmentDownPayment: 10_000, withCredential: true });
    await prisma.product.update({ where: { id: product.id }, data: { installmentPrice: 60_000 } });

    const cashBuyer = await createUser(t, { kycVerified: true });
    const cash = await createOrder(createOrderSchema.parse({ productId: product.id, paymentMode: "ONE_TIME" }), { actorId: cashBuyer.id });
    track(t, "orderIds", cash.orderId);
    expect(cash.amount).toBe(50_000);
    await prisma.order.update({ where: { id: cash.orderId }, data: { status: "CANCELLED" } });

    const monthlyBuyer = await createUser(t, { kycVerified: true });
    const split = await createOrder(createOrderSchema.parse({ productId: product.id, paymentMode: "INSTALLMENTS" }), { actorId: monthlyBuyer.id });
    track(t, "orderIds", split.orderId);
    expect(split.amount).toBe(60_000);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: split.orderId } });
    expect(payment.amount).toBe(10_000); // l'apport
  });
});
