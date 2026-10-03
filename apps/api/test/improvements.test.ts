// Améliorations d'octobre 2026 : recherche et tri du catalogue, offres mises en
// avant sur l'accueil, avis après « Reçu », profil public du vendeur,
// appareil de confiance pour la connexion admin, confirmation de l'e-mail,
// CSRF sans session (V-09).
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
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
import { confirmReceipt, createOrder, getMyOrder } from "../src/modules/orders/service.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { submitReview, sellerPublicProfile, reputations } from "../src/modules/reviews/service.js";
import { registerReviewRoutes } from "../src/modules/reviews/routes.js";
import { registerCatalogueRoutes } from "../src/modules/catalogue/routes.js";
import { registerSeedRoutes } from "../src/modules/seed/routes.js";
import { loginAdmin } from "../src/modules/admin-console/auth.js";
import { createTotpSecret } from "../src/modules/admin-console/totp.js";
import { encryptString } from "../src/lib/storage.js";
import { resendVerificationEmail, verificationLink, verifyEmail } from "../src/modules/auth/email-verification.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function vendor() {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  return { owner, seller };
}

/** Achat complet jusqu'à « Reçu ». */
async function completedPurchase(sellerId: string | null, price = 10_000) {
  const product = await createProduct(t, { sellerId, basePrice: price, withCredential: true });
  const buyer = await createUser(t, { kycVerified: true });
  const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
  track(t, "orderIds", order.orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
  await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
  await confirmReceipt(order.orderId, { actorId: buyer.id });
  return { product, buyer, orderId: order.orderId };
}

describe("Catalogue : recherche et tri par puissance", () => {
  it("cherche par nom ou par puissance minimale, trie dans les deux sens", async () => {
    const tag = `Zorglub${randomUUID().slice(0, 6)}`;
    const low = await createProduct(t, { title: `${tag} faible`, teamPower: 9_101 });
    const high = await createProduct(t, { title: `${tag} fort`, teamPower: 9_202 });
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerCatalogueRoutes, { prefix: "/api" });
    });

    const byName = (await app.inject({ method: "GET", url: `/api/catalogue?q=${tag.toLowerCase()}&sort=powerAsc` })).json();
    expect(byName.data.map((p: { id: string }) => p.id)).toEqual([low.id, high.id]);
    const desc = (await app.inject({ method: "GET", url: `/api/catalogue?q=${tag}&sort=power` })).json();
    expect(desc.data.map((p: { id: string }) => p.id)).toEqual([high.id, low.id]);

    const byPower = (await app.inject({ method: "GET", url: "/api/catalogue?q=9%20150&perPage=48" })).json();
    const ids = byPower.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(high.id);
    expect(ids).not.toContain(low.id);
    expect(byPower.meta.q).toBe("9 150");
    await app.close();
  });

  it("met les offres mises en avant en tête de l'accueil, avec leur badge", async () => {
    const boosted = await createProduct(t, { title: `Boost ${randomUUID().slice(0, 6)}` });
    await prisma.product.update({ where: { id: boosted.id }, data: { featuredUntil: new Date(Date.now() + 86_400_000), createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    const app = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerSeedRoutes, { prefix: "/api" });
    });
    const home = (await app.inject({ method: "GET", url: "/api/seed" })).json().data.home as Array<{ id: string; isFeatured: boolean }>;
    const index = home.findIndex((p) => p.id === boosted.id);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(home[index]?.isFeatured).toBe(true);
    expect(home.slice(0, index).every((p) => p.isFeatured)).toBe(true);
    await app.close();
  });
});

describe("Avis après « Reçu » et réputation du vendeur", () => {
  it("un seul avis par commande reçue ; la réputation et le profil le reflètent", async () => {
    const { owner, seller } = await vendor();
    const { buyer, orderId } = await completedPurchase(seller.id);

    expect((await getMyOrder(orderId, buyer.id)).canReview).toBe(true);
    const review = await submitReview(orderId, { rating: 4, comment: "Compte conforme, merci." }, { actorId: buyer.id });
    expect(review.rating).toBe(4);
    expect((await getMyOrder(orderId, buyer.id))).toMatchObject({ canReview: false, review: { rating: 4 } });
    expect((await expectApiError(() => submitReview(orderId, { rating: 5, comment: null }, { actorId: buyer.id }))).code).toBe("CONFLICT");

    const rep = (await reputations([seller.id])).get(seller.id);
    expect(rep).toMatchObject({ rating: 4, reviewCount: 1, sales: 1 });
    const profile = await sellerPublicProfile(seller.id);
    expect(profile.code).toMatch(/^V-[0-9A-F]{6}$/);
    expect(profile.reviews[0]).toMatchObject({ rating: 4, comment: "Compte conforme, merci." });
    expect(JSON.stringify(profile)).not.toContain(owner.email);

    const told = await prisma.notification.findFirst({ where: { userId: owner.id, title: { startsWith: "Nouvel avis" } } });
    expect(told?.message).toContain("4/5");
  });

  it("refuse un avis avant « Reçu » ou sur la commande d'un autre", async () => {
    const { seller } = await vendor();
    const product = await createProduct(t, { sellerId: seller.id, withCredential: true });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder({ productId: product.id, quantity: 1, paymentMode: "ONE_TIME" }, { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    expect((await expectApiError(() => submitReview(order.orderId, { rating: 5, comment: null }, { actorId: buyer.id }))).code).toBe("ORDER_NOT_DELIVERED");
    const stranger = await createUser(t);
    expect((await expectApiError(() => submitReview(order.orderId, { rating: 5, comment: null }, { actorId: stranger.id }))).code).toBe("NOT_FOUND");
  });

  it("routes : note invalide refusée, profil public sans session", async () => {
    const { seller } = await vendor();
    const { buyer, orderId } = await completedPurchase(seller.id);
    const app = await buildMiniApp({ auth: await authFor(buyer.id) }, async (instance) => {
      await instance.register(registerReviewRoutes, { prefix: "/api/v1" });
    });
    expect((await app.inject({ method: "POST", url: `/api/v1/orders/${orderId}/review`, payload: { rating: 9 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/v1/orders/${orderId}/review`, payload: { rating: 5 } })).statusCode).toBe(200);
    await app.close();

    const pub = await buildMiniApp({ auth: null }, async (instance) => {
      await instance.register(registerReviewRoutes, { prefix: "/api/v1" });
    });
    const res = await pub.inject({ method: "GET", url: `/api/v1/sellers/${seller.id}/profile` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ rating: 5, reviewCount: 1 });
    expect((await pub.inject({ method: "GET", url: "/api/v1/sellers/pas-un-id/profile" })).statusCode).toBe(400);
    await pub.close();
  });
});

// Code TOTP courant (même algorithme que l'application d'authentification).
function totpNow(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

describe("Connexion admin : se souvenir de cet appareil", () => {
  it("épargne le code pendant 30 jours, jamais le mot de passe, et meurt au changement de mot de passe", async () => {
    const { user } = await createAdmin(t);
    const secret = createTotpSecret();
    const key = `adminTotpSecret:${user.id}`;
    await prisma.settings.create({ data: { key, value: encryptString(secret), valueType: "string", group: "security" } });
    t.settingsKeys.push(key);

    const first = await loginAdmin({ email: user.email, password: "MotDePasse123!", totpCode: totpNow(secret), rememberDevice: true }, {});
    expect(first.trustToken).toEqual(expect.any(String));

    const again = await loginAdmin({ email: user.email, password: "MotDePasse123!", trustedToken: first.trustToken! }, {});
    expect(again.setupRequired).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "ADMIN_LOGIN_TRUSTED_DEVICE", userId: user.id } })).toBe(1);

    // Le mot de passe reste exigé.
    await expect(loginAdmin({ email: user.email, password: "mauvais", trustedToken: first.trustToken! }, {})).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    // Jeton modifié → code redemandé.
    const [id, exp, sig] = first.trustToken!.split(".");
    await expect(loginAdmin({ email: user.email, password: "MotDePasse123!", trustedToken: `${id}.${Number(exp) + 99}.${sig}` }, {})).rejects.toMatchObject({ code: "ACTION_REQUIRES_2FA" });
    // Mot de passe changé → l'appareil n'est plus de confiance.
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash + "x" } });
    await expect(loginAdmin({ email: user.email, password: "MotDePasse123!", trustedToken: first.trustToken! }, {})).rejects.toBeTruthy();
  });
});

describe("Confirmation de l'adresse e-mail", () => {
  it("renvoie un lien et confirme l'adresse ; un lien falsifié est refusé", async () => {
    const user = await createUser(t);
    expect(await resendVerificationEmail(user.id)).toEqual({ sent: true, alreadyVerified: false });
    const bad = await expectApiError(() => verifyEmail(`${user.id}.${Math.floor(Date.now() / 1000) + 600}.faux`, {}));
    expect(bad.code).toBe("VALIDATION_ERROR");
    const token = new URL(verificationLink({ id: user.id, email: user.email })).searchParams.get("token")!;
    await expect(verifyEmail(token, {})).resolves.toEqual({ verified: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    expect(await resendVerificationEmail(user.id)).toEqual({ sent: false, alreadyVerified: true });

    // Adresse changée : l'ancien lien ne vaut plus rien.
    await prisma.user.update({ where: { id: user.id }, data: { email: `autre-${user.email}`, emailVerifiedAt: null } });
    expect((await expectApiError(() => verifyEmail(token, {}))).code).toBe("VALIDATION_ERROR");
  });
});
