// PHASE 13 — Promotions (§39 : « promotion »). Fenêtre de dates, contrôles
// de prix, anti-chevauchement, annulation, liste admin et routes.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createProduct, createUser, expectApiError, tracker, track } from "./helpers.js";
import {
  cancelPromotion,
  createPromotion,
  listPromotions,
} from "../src/modules/promotions/service.js";
import { registerPromotionRoutes } from "../src/modules/promotions/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

function window(offsetStart = -3_600_000, offsetEnd = 3 * 86_400_000) {
  return { startsAt: new Date(Date.now() + offsetStart), endsAt: new Date(Date.now() + offsetEnd) };
}

describe("Création d'une promotion", () => {
  it("crée une promo à prix fixe déjà commencée (ACTIVE) et journalise", async () => {
    const admin = await createAdmin(t);
    const product = await createProduct(t, { basePrice: 60_000 });

    const created = await createPromotion(
      { productId: product.id, promoPrice: 45_000, ...window() },
      { actorId: admin.user.id, actorRole: "ADMIN", ip: "127.0.0.1" },
    );
    track(t, "promotionIds", created.id);
    expect(created.status).toBe("ACTIVE");

    const row = await prisma.promotion.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ promoPrice: 45_000, discountPercent: null, productId: product.id });
    expect(row.title).toBe(product.title);

    const audit = await prisma.auditLog.findFirst({
      where: { userId: admin.user.id, action: "PROMOTION_CREATED", resourceId: created.id },
    });
    expect(audit?.metadata).toMatchObject({ productId: product.id, promoPrice: 45_000 });
  });

  it("crée une promo planifiée (SCHEDULED) avec un pourcentage de remise", async () => {
    const admin = await createAdmin(t);
    const product = await createProduct(t, { basePrice: 80_000 });

    const created = await createPromotion(
      { productId: product.id, title: "  P13 Black Friday  ", discountPercent: 25, ...window(86_400_000, 4 * 86_400_000) },
      { actorId: admin.user.id, actorRole: "ADMIN" },
    );
    track(t, "promotionIds", created.id);
    expect(created.status).toBe("SCHEDULED");

    const row = await prisma.promotion.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.title).toBe("P13 Black Friday");
    expect(row.discountPercent).toBe(25);
  });

  it("valide le produit, les prix, les bornes de remise et la fenêtre", async () => {
    const admin = await createAdmin(t);
    const ctx = { actorId: admin.user.id, actorRole: "ADMIN" as const };
    const product = await createProduct(t, { basePrice: 50_000 });

    await expect(
      createPromotion({ productId: "00000000-0000-4000-8000-000000000000", promoPrice: 10_000, ...window() }, ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      createPromotion({ productId: product.id, ...window() }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createPromotion({ productId: product.id, promoPrice: 50_000, ...window() }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createPromotion({ productId: product.id, promoPrice: -5, ...window() }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createPromotion({ productId: product.id, discountPercent: 0, ...window() }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createPromotion({ productId: product.id, discountPercent: 120, ...window() }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createPromotion({ productId: product.id, promoPrice: 40_000, startsAt: new Date(Date.now() + 10_000), endsAt: new Date(Date.now()) }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createPromotion({ productId: product.id, promoPrice: 40_000, ...window(-86_400_000, -3_600_000) }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("interdit deux promos qui se chevauchent sur la même offre", async () => {
    const admin = await createAdmin(t);
    const ctx = { actorId: admin.user.id, actorRole: "ADMIN" as const };
    const product = await createProduct(t, { basePrice: 70_000 });

    const first = await createPromotion({ productId: product.id, promoPrice: 55_000, ...window() }, ctx);
    track(t, "promotionIds", first.id);

    const err = await expectApiError(() =>
      createPromotion(
        { productId: product.id, promoPrice: 50_000, ...window(2 * 86_400_000, 6 * 86_400_000) },
        ctx,
      ),
    );
    expect(err.code).toBe("PROMO_OVERLAP");

    // Une promo annulée ne bloque plus la fenêtre.
    await cancelPromotion(first.id, { actorId: admin.user.id, actorRole: "ADMIN" });
    const second = await createPromotion({ productId: product.id, promoPrice: 50_000, ...window() }, ctx);
    track(t, "promotionIds", second.id);
    expect(second.status).toBe("ACTIVE");
  });
});

describe("Annulation et liste", () => {
  it("annule une promotion une fois (audit WARNING) puis refuse un second appel", async () => {
    const admin = await createAdmin(t);
    const product = await createProduct(t, { basePrice: 40_000 });
    const promo = await createPromotion(
      { productId: product.id, promoPrice: 30_000, ...window() },
      { actorId: admin.user.id, actorRole: "ADMIN" },
    );
    track(t, "promotionIds", promo.id);

    const cancelled = await cancelPromotion(promo.id, {
      actorId: admin.user.id,
      actorRole: "ADMIN",
      ip: "127.0.0.1",
    });
    expect(cancelled).toEqual({ id: promo.id, status: "CANCELLED" });

    const audit = await prisma.auditLog.findFirst({
      where: { action: "PROMOTION_CANCELLED", resourceId: promo.id },
    });
    expect(audit?.severity).toBe("WARNING");

    await expect(
      cancelPromotion(promo.id, { actorId: admin.user.id, actorRole: "ADMIN" }),
    ).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
    await expect(
      cancelPromotion("00000000-0000-4000-8000-000000000000", { actorId: admin.user.id, actorRole: "ADMIN" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("liste les promotions paginées avec leur créateur", async () => {
    const admin = await createAdmin(t);
    const product = await createProduct(t, { title: "Offre promotion-test", basePrice: 90_000 });
    const promo = await createPromotion(
      { productId: product.id, title: "P13 promo à lister", discountPercent: 15, ...window() },
      { actorId: admin.user.id, actorRole: "ADMIN" },
    );
    track(t, "promotionIds", promo.id);

    const all = await listPromotions({ page: 1, perPage: 100 });
    expect(all.total).toBeGreaterThan(0);
    expect(all.items.some((row) => row.id === promo.id)).toBe(true);

    const filtered = await listPromotions({ page: 1, perPage: 100, q: "P13 promo à lister" });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.createdBy?.id).toBe(admin.user.id);
  });
});

describe("Routes promotions (inject)", () => {
  it("exige la permission PRODUCTS puis crée, liste et annule", async () => {
    const client = await createUser(t);
    const clientSession = await authFor(client.id);
    const denied = await buildMiniApp({ auth: clientSession }, async (app) => {
      await app.register(registerPromotionRoutes, { prefix: "/api/v1" });
    });
    const forbidden = await denied.inject({ method: "GET", url: "/api/v1/admin/promotions" });
    expect(forbidden.statusCode).toBe(403);
    await denied.close();

    const admin = await createAdmin(t);
    const app = await buildMiniApp({ auth: admin.session }, async (instance) => {
      await instance.register(registerPromotionRoutes, { prefix: "/api/v1" });
    });

    const product = await createProduct(t, { basePrice: 75_000 });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/promotions",
      payload: { productId: product.id, startsAt: new Date().toISOString(), endsAt: new Date().toISOString() },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/promotions",
      payload: {
        productId: product.id,
        title: "P13 promo route",
        promoPrice: 60_000,
        startsAt: new Date(Date.now() - 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const promoId = created.json().data.id as string;
    track(t, "promotionIds", promoId);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/promotions?page=1&perPage=10" });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((row: { id: string }) => row.id === promoId)).toBe(true);

    const cancelled = await app.inject({ method: "POST", url: `/api/v1/admin/promotions/${promoId}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.status).toBe("CANCELLED");

    const badQuery = await app.inject({ method: "GET", url: "/api/v1/admin/promotions?page=0" });
    expect(badQuery.statusCode).toBe(400);

    await app.close();
  });
});
