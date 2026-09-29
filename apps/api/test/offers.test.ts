// Création et modification des offres : vendeur (publiée sans validation) et
// équipe (offres MISTERDOU) ; promotions de l'équipe limitées à ses offres.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { cleanup, createAdmin, createProduct, createSeller, createUser, expectApiError, track, tracker } from "./helpers.js";
import {
  activeSellerId,
  createOffer,
  createOfferSchema,
  getOfferForEdit,
  parseOffer,
  removeOffer,
  updateOffer,
  type CreateOfferInput,
} from "../src/modules/offers/service.js";
import { createPromotion } from "../src/modules/promotions/service.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";
import { decryptString } from "../src/lib/storage.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

function offer(overrides: Partial<CreateOfferInput> = {}): CreateOfferInput {
  return {
    title: "Compte Division 1 — 3 100 OVR",
    description: "Compte propre, e-mail de récupération fourni après l’achat.",
    division: "Division 1",
    teamPower: 3100,
    coins: 800,
    extraInfo: "Messi, Mbappé",
    basePrice: 45_000,
    paymentMode: "ONE_TIME",
    credentials: { loginId: "joueur@example.com", password: "secret-du-compte" },
    ...overrides,
  };
}

async function activeSeller(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const user = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, user, { status });
  return { user, seller };
}

describe("Offre d'un vendeur", () => {
  it("est publiée tout de suite, identifiants chiffrés", async () => {
    const { user, seller } = await activeSeller();
    const created = await createOffer(offer(), { kind: "seller", sellerId: seller.id }, { actorId: user.id });
    track(t, "productIds", created.id);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: created.id }, include: { credential: true } });
    expect(row).toMatchObject({ status: "ACTIVE", ownerType: "VENDOR", sellerId: seller.id, basePrice: 45_000 });
    expect(row.publishedAt).not.toBeNull();
    expect(row.slug).toMatch(/^compte-division-1-3-100-ovr-[0-9a-f]{6}$/);
    expect(row.credential?.encryptedPassword).not.toContain("secret");
    expect(decryptString(row.credential!.encryptedPassword)).toBe("secret-du-compte");

    const forEdit = await getOfferForEdit(created.id, { kind: "seller", sellerId: seller.id });
    expect(forEdit.hasCredentials).toBe(true);
    expect(JSON.stringify(forEdit)).not.toContain("secret");
  });

  it("refuse un vendeur inactif ou un client", async () => {
    const { user } = await activeSeller("SUSPENDED");
    expect((await expectApiError(() => activeSellerId(user.id))).code).toBe("FORBIDDEN");
    const client = await createUser(t);
    expect((await expectApiError(() => activeSellerId(client.id))).code).toBe("FORBIDDEN");
  });

  it("valide les champs et les mensualités", async () => {
    const { user, seller } = await activeSeller();
    const owner = { kind: "seller", sellerId: seller.id } as const;
    expect((await expectApiError(async () => parseOffer(createOfferSchema, { ...offer(), basePrice: 10 }))).code).toBe("VALIDATION_ERROR");
    expect(
      (await expectApiError(() => createOffer(offer({ paymentMode: "INSTALLMENTS", installmentMonths: null }), owner, { actorId: user.id }))).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      (await expectApiError(() =>
        createOffer(offer({ paymentMode: "INSTALLMENTS", installmentMonths: 4, installmentDownPayment: 45_000 }), owner, { actorId: user.id }),
      )).code,
    ).toBe("VALIDATION_ERROR");

    const split = await createOffer(
      offer({ paymentMode: "INSTALLMENTS", installmentMonths: 4, installmentDownPayment: 5_000 }),
      owner,
      { actorId: user.id },
    );
    track(t, "productIds", split.id);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: split.id } });
    expect(row).toMatchObject({ paymentMode: "INSTALLMENTS", installmentMonths: 4, installmentDownPayment: 5_000 });
  });

  it("se modifie et se retire par son vendeur seulement, pas pendant un achat", async () => {
    const { user, seller } = await activeSeller();
    const owner = { kind: "seller", sellerId: seller.id } as const;
    const created = await createOffer(offer(), owner, { actorId: user.id });
    track(t, "productIds", created.id);

    // Modification sans nouveaux identifiants : les anciens restent.
    await updateOffer(created.id, { ...offer({ basePrice: 40_000 }), credentials: undefined }, owner, { actorId: user.id });
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: created.id }, include: { credential: true } });
    expect(updated.basePrice).toBe(40_000);
    expect(decryptString(updated.credential!.encryptedEmail)).toBe("joueur@example.com");

    const other = await activeSeller();
    const err = await expectApiError(() => removeOffer(created.id, { kind: "seller", sellerId: other.seller.id }, { actorId: other.user.id }));
    expect(err.code).toBe("FORBIDDEN");

    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder(createOrderSchema.parse({ productId: created.id }), { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    expect((await expectApiError(() => removeOffer(created.id, owner, { actorId: user.id }))).code).toBe("PRODUCT_RESERVED");

    await prisma.order.update({ where: { id: order.orderId }, data: { status: "CANCELLED" } });
    await removeOffer(created.id, owner, { actorId: user.id });
    const removed = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
    expect(removed.status).toBe("ARCHIVED");
    expect(removed.deletedAt).not.toBeNull();
  });
});

describe("Offres MISTERDOU et promotions de l'équipe", () => {
  it("l'équipe crée une offre sans vendeur et ne touche pas celles des vendeurs", async () => {
    const admin = await createAdmin(t);
    const created = await createOffer(offer(), { kind: "team" }, { actorId: admin.user.id, actorRole: "ADMIN" });
    track(t, "productIds", created.id);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ ownerType: "ADMIN", sellerId: null, status: "ACTIVE" });

    const { seller } = await activeSeller();
    const sellerOffer = await createProduct(t, { sellerId: seller.id });
    const err = await expectApiError(() => getOfferForEdit(sellerOffer.id, { kind: "team" }));
    expect(err.code).toBe("NOT_FOUND");

    const window = { startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000) };
    const promoErr = await expectApiError(() =>
      createPromotion({ productId: sellerOffer.id, discountPercent: 10, ...window }, { actorId: admin.user.id, actorRole: "ADMIN" }),
    );
    expect(promoErr.code).toBe("FORBIDDEN");
  });
});
