// PHASE 13 — Mise en avant (§39 : « mise en avant »). Paiement par solde
// vendeur, repli Wave, activation, prolongation, activation admin offerte
// et jobs périodiques (expiration / synchronisation).
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createProduct,
  createSeller,
  createUser,
  expectApiError,
  tracker,
  track,
} from "./helpers.js";
import {
  FEATURED_MAX_DAYS,
  adminFeature,
  featuredDailyRate,
  listFeaturedPurchases,
  requestFeatured,
  runPromotionJobs,
} from "../src/modules/promotions/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { registerPromotionRoutes } from "../src/modules/promotions/routes.js";

const t = tracker();
// Fenêtre des jobs : aujourd'hui 06 h — largement avant l'expiration des
// mises en avant et des promotions du jeu de données dev.
const JOB_NOW = new Date(new Date().setHours(6, 0, 0, 0));
const DAY_MS = 86_400_000;

afterAll(async () => {
  await cleanup(t);
});

async function sellerProduct(opts: { balanceAvailable?: number; basePrice?: number } = {}) {
  const owner = await createUser(t, { role: "VENDOR" });
  const seller = await createSeller(t, owner, { balanceAvailable: opts.balanceAvailable ?? 0 });
  const product = await createProduct(t, {
    sellerId: seller.id,
    basePrice: opts.basePrice ?? 50_000,
  });
  return { owner, seller, product };
}

describe("Demande de mise en avant", () => {
  it("valide la durée et l'existence de l'offre", async () => {
    const { owner, product } = await sellerProduct();
    const ctx = { actorId: owner.id, actorRole: "VENDOR" as const, ip: "127.0.0.1" };

    await expect(requestFeatured(product.id, 0, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(requestFeatured(product.id, FEATURED_MAX_DAYS + 1, ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(requestFeatured("00000000-0000-4000-8000-000000000000", 3, ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const draft = await createProduct(t, { sellerId: null, status: "DRAFT" });
    await expect(requestFeatured(draft.id, 3, { actorId: owner.id, actorRole: "ADMIN" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuse la mise en avant d'une offre qui n'est pas la sienne", async () => {
    const { product } = await sellerProduct({ balanceAvailable: 10_000 });
    const stranger = await createUser(t, { role: "VENDOR" });

    const err = await expectApiError(() =>
      requestFeatured(product.id, 3, { actorId: stranger.id, actorRole: "VENDOR", ip: "127.0.0.1" }),
    );
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("propriétaire");
  });

  it("débite le solde vendeur et active la mise en avant immédiatement", async () => {
    const { owner, seller, product } = await sellerProduct({ balanceAvailable: 5_000 });

    const result = await requestFeatured(product.id, 5, {
      actorId: owner.id,
      actorRole: "VENDOR",
      ip: "127.0.0.1",
    });

    expect(result).toMatchObject({ activated: true, amount: 1_000, days: 5, token: null });
    expect(result.dailyRate).toBe(200);

    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(balance.balanceAvailable).toBe(4_000);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: (await prisma.featuredProduct.findUniqueOrThrow({ where: { id: result.purchaseId } })).paymentId! },
    });
    expect(payment).toMatchObject({ type: "FEATURED", status: "SUCCESS", provider: "BALANCE", amount: 1_000 });

    const purchase = await prisma.featuredProduct.findUniqueOrThrow({ where: { id: result.purchaseId } });
    expect(purchase.status).toBe("ACTIVE");
    expect(purchase.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.featuredUntil).not.toBeNull();
    expect(result.featuredUntil).toBe(row.featuredUntil?.toISOString());

    const notification = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "FEATURED_ACTIVATED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.message).toContain("5 jours");

    const audit = await prisma.auditLog.findFirst({
      where: { userId: owner.id, action: "FEATURED_PAID_BALANCE", resourceId: result.purchaseId },
    });
    expect(audit?.severity).toBe("WARNING");
  });

  it("refuse un solde insuffisant quand le paiement par solde est imposé", async () => {
    const { owner, product } = await sellerProduct({ balanceAvailable: 100 });

    const err = await expectApiError(() =>
      requestFeatured(product.id, 3, { actorId: owner.id, actorRole: "VENDOR" }, { paymentMethod: "BALANCE" }),
    );
    expect(err.code).toBe("INSUFFICIENT_BALANCE");
    expect(err.message).toContain("600 FCFA requis");

    const balance = await prisma.sellerBalance.findFirstOrThrow({
      where: { seller: { userId: owner.id } },
    });
    expect(balance.balanceAvailable).toBe(100);
  });

  it("replie sur Wave quand le solde ne suffit pas (AUTO) ou si Wave est demandé", async () => {
    const { owner, product } = await sellerProduct({ balanceAvailable: 0 });

    const auto = await requestFeatured(product.id, 4, { actorId: owner.id, actorRole: "VENDOR" });
    expect(auto).toMatchObject({ activated: false, amount: 800, token: expect.stringMatching(/^mdpay_/) });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: (await prisma.featuredProduct.findUniqueOrThrow({ where: { id: auto.purchaseId } })).paymentId! },
    });
    expect(payment).toMatchObject({ status: "PENDING", provider: "WAVE_LINK", transactionToken: auto.token });

    const purchase = await prisma.featuredProduct.findUniqueOrThrow({ where: { id: auto.purchaseId } });
    expect(purchase.status).toBe("PENDING");
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.featuredUntil).toBeNull();

    const rich = await sellerProduct({ balanceAvailable: 10_000 });
    const forced = await requestFeatured(
      rich.product.id,
      2,
      { actorId: rich.owner.id, actorRole: "VENDOR" },
      { paymentMethod: "WAVE" },
    );
    expect(forced.activated).toBe(false);
    expect(forced.token).not.toBeNull();
    const stillRich = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: rich.seller.id } });
    expect(stillRich.balanceAvailable).toBe(10_000);
  });

  it("active la mise en avant à l'encaissement Wave et prolonge sans perte de jours", async () => {
    const { owner, product } = await sellerProduct({ balanceAvailable: 0 });

    const first = await requestFeatured(product.id, 3, { actorId: owner.id, actorRole: "VENDOR" });
    const firstPurchase = await prisma.featuredProduct.findUniqueOrThrow({ where: { id: first.purchaseId } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: firstPurchase.paymentId! } });
    const settled = await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
    expect(settled.status).toBe("SUCCESS");

    const afterFirst = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterFirst.featuredUntil).not.toBeNull();
    expect(afterFirst.featuredUntil?.getTime()).toBeGreaterThanOrEqual(Date.now() + 3 * DAY_MS - 60_000);

    const purchaseRow = await prisma.featuredProduct.findUniqueOrThrow({ where: { id: first.purchaseId } });
    expect(purchaseRow.status).toBe("ACTIVE");

    // Seconde activation : la prolongation part de la fin en cours.
    const second = await requestFeatured(product.id, 5, { actorId: owner.id, actorRole: "VENDOR" });
    const secondPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: (await prisma.featuredProduct.findUniqueOrThrow({ where: { id: second.purchaseId } })).paymentId! },
    });
    await settlePayment({ id: secondPayment.id }, "SUCCESS", { source: "MANUAL" });

    const afterSecond = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    const expected = (afterFirst.featuredUntil?.getTime() ?? 0) + 5 * DAY_MS;
    expect(Math.abs((afterSecond.featuredUntil?.getTime() ?? 0) - expected)).toBeLessThan(60_000);
  });
});

describe("Mise en avant offerte (admin) et historique", () => {
  it("adminFeature prolonge l'offre sans paiement et journalise en WARNING", async () => {
    const admin = await createAdmin(t);
    const product = await createProduct(t);

    const result = await adminFeature(product.id, 7, {
      actorId: admin.user.id,
      actorRole: "ADMIN",
      ip: "127.0.0.1",
    });
    expect(new Date(result.featuredUntil).getTime()).toBeGreaterThanOrEqual(Date.now() + 7 * DAY_MS - 60_000);

    const purchase = await prisma.featuredProduct.findFirstOrThrow({
      where: { productId: product.id, purchasedById: admin.user.id },
    });
    expect(purchase).toMatchObject({ status: "ACTIVE", dailyRate: 0, totalPaid: 0, days: 7 });

    const audit = await prisma.auditLog.findFirst({
      where: { action: "FEATURED_ACTIVATED_ADMIN", resourceId: product.id },
    });
    expect(audit?.severity).toBe("WARNING");

    // Prolongation depuis la fin en cours (jamais de perte).
    const again = await adminFeature(product.id, 2, { actorId: admin.user.id, actorRole: "ADMIN" });
    const finalRow = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(Math.abs(finalRow.featuredUntil!.getTime() - new Date(again.featuredUntil).getTime())).toBeLessThan(1_000);
  });

  it("adminFeature refuse une durée invalide et une offre inconnue", async () => {
    const admin = await createAdmin(t);
    const product = await createProduct(t);
    const ctx = { actorId: admin.user.id, actorRole: "ADMIN" as const };

    await expect(adminFeature(product.id, 0, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(adminFeature(product.id, FEATURED_MAX_DAYS + 1, ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      adminFeature("00000000-0000-4000-8000-000000000000", 3, ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listFeaturedPurchases renvoie l'historique paginé avec l'acheteur", async () => {
    const admin = await createAdmin(t);
    const { owner, product } = await sellerProduct({ balanceAvailable: 5_000 });
    await requestFeatured(product.id, 2, { actorId: owner.id, actorRole: "VENDOR" });

    const list = await listFeaturedPurchases({ page: 1, perPage: 10 });
    expect(list.total).toBeGreaterThan(0);
    expect(list.items[0]).toHaveProperty("product");
    expect(list.items.some((row) => row.purchasedBy?.id === owner.id)).toBe(true);

    // L'offre d'un vendeur se met en avant par ses forfaits, pas par l'équipe.
    await expect(adminFeature(product.id, 1, { actorId: admin.user.id, actorRole: "ADMIN" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const mine = list.items.filter((row) => row.product.slug === product.slug);
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Jobs des mises en avant", () => {
  it("expire les mises en avant échues, retire la visibilité et synchronise les promos", async () => {
    const owner = await createUser(t, { role: "VENDOR" });
    const seller = await createSeller(t, owner);
    const product = await createProduct(t, { sellerId: seller.id });
    const expired = await createProduct(t, { sellerId: seller.id });
    // Échue une heure avant l'exécution simulée du job (JOB_NOW = 6 h) :
    // indépendant de l'heure à laquelle la suite est lancée.
    await prisma.product.update({
      where: { id: expired.id },
      data: { featuredUntil: new Date(JOB_NOW.getTime() - 3_600_000) },
    });
    const purchase = await prisma.featuredProduct.create({
      data: {
        productId: expired.id,
        sellerId: seller.id,
        purchasedById: owner.id,
        days: 1,
        dailyRate: 200,
        totalPaid: 200,
        startedAt: new Date(JOB_NOW.getTime() - 2 * DAY_MS),
        expiresAt: new Date(JOB_NOW.getTime() - DAY_MS),
        status: "ACTIVE",
      },
    });
    t.featuredIds.push(purchase.id);
    track(t, "featuredIds", purchase.id);

    const admin = await createAdmin(t);
    const endedPromo = await prisma.promotion.create({
      data: {
        productId: product.id,
        title: "P13 promo terminée",
        discountPercent: 10,
        startsAt: new Date(JOB_NOW.getTime() - 3 * DAY_MS),
        endsAt: new Date(JOB_NOW.getTime() - 3_600_000),
        status: "ACTIVE",
        createdById: admin.user.id,
      },
    });
    track(t, "promotionIds", endedPromo.id);
    const scheduled = await prisma.promotion.create({
      data: {
        productId: product.id,
        title: "P13 promo planifiée",
        promoPrice: 40_000,
        startsAt: new Date(JOB_NOW.getTime() - 3_600_000),
        endsAt: new Date(JOB_NOW.getTime() + 3 * DAY_MS),
        status: "SCHEDULED",
        createdById: admin.user.id,
      },
    });
    track(t, "promotionIds", scheduled.id);
    // Témoin : promo en cours au-delà de l'exécution du job, qui doit rester intacte.
    const running = await prisma.promotion.create({
      data: {
        productId: product.id,
        title: "P13 promo en cours",
        discountPercent: 5,
        startsAt: new Date(JOB_NOW.getTime() - DAY_MS),
        endsAt: new Date(JOB_NOW.getTime() + DAY_MS),
        status: "ACTIVE",
        createdById: admin.user.id,
      },
    });
    track(t, "promotionIds", running.id);

    const result = await runPromotionJobs(JOB_NOW);

    expect(result.expiredFeatured).toBeGreaterThanOrEqual(1);
    const expiredRow = await prisma.featuredProduct.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(expiredRow.status).toBe("EXPIRED");

    const cleared = await prisma.product.findUniqueOrThrow({ where: { id: expired.id } });
    expect(cleared.featuredUntil).toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "FEATURED_EXPIRED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.title).toBe("Mise en avant terminée");

    const promoRow = await prisma.promotion.findUniqueOrThrow({ where: { id: endedPromo.id } });
    expect(promoRow.status).toBe("EXPIRED");
    const scheduledRow = await prisma.promotion.findUniqueOrThrow({ where: { id: scheduled.id } });
    expect(scheduledRow.status).toBe("ACTIVE");

    // Ce qui court encore n'est pas touché : promo témoin et mises en avant futures.
    const runningRow = await prisma.promotion.findUniqueOrThrow({ where: { id: running.id } });
    expect(runningRow.status).toBe("ACTIVE");
    const devFeatured = await prisma.product.findMany({
      where: { featuredUntil: { not: null }, slug: { not: { startsWith: "p13-" } } },
      select: { featuredUntil: true },
    });
    expect(devFeatured.every((row) => (row.featuredUntil?.getTime() ?? 0) > JOB_NOW.getTime())).toBe(true);
  });

  it("lit le tarif journalier depuis les paramètres", async () => {
    expect(await featuredDailyRate()).toBeGreaterThan(0);
  });
});

describe("Routes mise en avant (inject)", () => {
  it("éligibilité et demande propriétaire, refus des tiers, puis côté admin", async () => {
    const { owner, product } = await sellerProduct({ balanceAvailable: 0 });
    const stranger = await createUser(t, { role: "VENDOR" });

    const opts = { auth: await authFor(owner.id) };
    const app = await buildMiniApp(opts, async (instance) => {
      await instance.register(registerPromotionRoutes, { prefix: "/api/v1" });
    });

    const eligibility = await app.inject({ method: "GET", url: `/api/v1/products/${product.id}/featured` });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().data).toMatchObject({ maxDays: FEATURED_MAX_DAYS, isOwner: true });

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/featured`,
      payload: { days: 0 },
    });
    expect(invalid.statusCode).toBe(400);

    const requested = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/featured`,
      payload: { days: 3, paymentMethod: "WAVE" },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().data).toMatchObject({ activated: false, days: 3 });
    expect(requested.json().data.checkoutUrl).toMatch(/^\/checkout\//);
    track(t, "featuredIds", requested.json().data.purchaseId);

    opts.auth = await authFor(stranger.id);
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/featured`,
      payload: { days: 3 },
    });
    expect(forbidden.statusCode).toBe(403);

    const notOwner = await app.inject({ method: "GET", url: `/api/v1/products/${product.id}/featured` });
    expect(notOwner.json().data.isOwner).toBe(false);
    await app.close();

    const admin = await createAdmin(t);
    const adminApp = await buildMiniApp({ auth: admin.session }, async (instance) => {
      await instance.register(registerPromotionRoutes, { prefix: "/api/v1" });
    });

    const deniedForClient = await adminApp.inject({ method: "GET", url: "/api/v1/admin/featured" });
    expect(deniedForClient.statusCode).toBe(200);

    // L'équipe ne met en avant que les offres MISTERDOU.
    const sellerOffer = await adminApp.inject({
      method: "POST",
      url: `/api/v1/admin/products/${product.id}/featured`,
      payload: { days: 4 },
    });
    expect(sellerOffer.statusCode).toBe(403);

    const house = await createProduct(t);
    const featured = await adminApp.inject({
      method: "POST",
      url: `/api/v1/admin/products/${house.id}/featured`,
      payload: { days: 4 },
    });
    expect(featured.statusCode).toBe(200);
    expect(new Date(featured.json().data.featuredUntil).getTime()).toBeGreaterThan(Date.now());

    const badDays = await adminApp.inject({
      method: "POST",
      url: `/api/v1/admin/products/${house.id}/featured`,
      payload: { days: 999 },
    });
    expect(badDays.statusCode).toBe(400);

    const history = await adminApp.inject({ method: "GET", url: "/api/v1/admin/featured" });
    expect(history.statusCode).toBe(200);
    expect(history.json().meta.total).toBeGreaterThan(0);
    await adminApp.close();
  });
});
