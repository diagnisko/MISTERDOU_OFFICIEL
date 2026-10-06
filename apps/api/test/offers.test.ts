// Création et modification des offres : vendeur (en ligne après validation de
// l'équipe) et équipe (offres MISTERDOU) ; promotions de l'équipe limitées à ses offres.
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
  reviewOffer,
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
  it("attend la validation de l'équipe avant d'être en ligne, identifiants chiffrés", async () => {
    const { user, seller } = await activeSeller();
    const created = await createOffer(offer(), { kind: "seller", sellerId: seller.id }, { actorId: user.id });
    track(t, "productIds", created.id);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: created.id }, include: { credential: true } });
    expect(row).toMatchObject({ status: "PENDING_REVIEW", ownerType: "VENDOR", sellerId: seller.id, basePrice: 45_000 });
    expect(row.publishedAt).toBeNull();
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
    const admin = await createAdmin(t);
    await reviewOffer(created.id, { decision: "approve" }, { actorId: admin.user.id, actorRole: "ADMIN" });

    // Modification sans nouveaux identifiants : les anciens restent ; l'offre repart en validation.
    await updateOffer(created.id, { ...offer({ basePrice: 40_000 }), credentials: undefined }, owner, { actorId: user.id });
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: created.id }, include: { credential: true } });
    expect(updated.basePrice).toBe(40_000);
    expect(updated.status).toBe("PENDING_REVIEW");
    expect(decryptString(updated.credential!.encryptedEmail)).toBe("joueur@example.com");
    await reviewOffer(created.id, { decision: "approve" }, { actorId: admin.user.id, actorRole: "ADMIN" });

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

describe("Validation des offres des vendeurs", () => {
  it("l'équipe valide (en ligne, vendeur prévenu) ou refuse avec un motif, une seule fois", async () => {
    const { user, seller } = await activeSeller();
    const owner = { kind: "seller", sellerId: seller.id } as const;
    const admin = await createAdmin(t);
    const by = { actorId: admin.user.id, actorRole: "ADMIN" as const };

    const refused = await createOffer(offer(), owner, { actorId: user.id });
    track(t, "productIds", refused.id);
    await reviewOffer(refused.id, { decision: "reject", reason: "Photos floues, merci d'en ajouter de nettes." }, by);
    const draft = await prisma.product.findUniqueOrThrow({ where: { id: refused.id } });
    expect(draft).toMatchObject({ status: "DRAFT", rejectedReason: "Photos floues, merci d'en ajouter de nettes.", publishedAt: null });
    expect((await getOfferForEdit(refused.id, owner)).rejectedReason).toContain("Photos floues");
    // Déjà traitée : pas de seconde décision.
    expect((await expectApiError(() => reviewOffer(refused.id, { decision: "approve" }, by))).code).toBe("ALREADY_REVIEWED");

    // Le vendeur corrige : l'offre repart en validation, motif effacé, puis elle est validée.
    await updateOffer(refused.id, { ...offer({ title: "Compte corrigé — 3 100 OVR" }), credentials: undefined }, owner, { actorId: user.id });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: refused.id } })).toMatchObject({ status: "PENDING_REVIEW", rejectedReason: null });
    await reviewOffer(refused.id, { decision: "approve" }, by);
    const live = await prisma.product.findUniqueOrThrow({ where: { id: refused.id } });
    expect(live.status).toBe("ACTIVE");
    expect(live.publishedAt).not.toBeNull();

    const notices = await prisma.notification.findMany({ where: { userId: user.id }, select: { title: true } });
    expect(notices.map((n) => n.title)).toEqual(expect.arrayContaining(["Offre à corriger", "Offre validée 🎉"]));
  });

  it("ne concerne que les offres des vendeurs", async () => {
    const admin = await createAdmin(t);
    const own = await createOffer(offer(), { kind: "team" }, { actorId: admin.user.id, actorRole: "ADMIN" });
    track(t, "productIds", own.id);
    const err = await expectApiError(() => reviewOffer(own.id, { decision: "approve" }, { actorId: admin.user.id }));
    expect(err.code).toBe("NOT_FOUND");
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
