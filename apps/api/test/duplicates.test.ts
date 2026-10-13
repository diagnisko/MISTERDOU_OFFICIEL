// Anti-doublon : un même compte eFootball (ID) ne peut pas être en vente deux
// fois sur le site ; un même fichier envoyé sur deux offres est signalé à
// l'équipe, sans jamais bloquer.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { cleanup, createAdmin, createProduct, createSeller, createUser, expectApiError, track, tracker } from "./helpers.js";
import {
  createOffer,
  getOfferForReview,
  reviewOffer,
  setOfferExchange,
  updateOffer,
  type CreateOfferInput,
} from "../src/modules/offers/service.js";
import { normalizeGameId, parseGameId } from "../src/modules/offers/game-id.js";
import { backfillFingerprints, duplicateMediaFor, fingerprintProductMedia, productIdsWithDuplicateMedia } from "../src/modules/media/fingerprint.js";
import { deleteMedia, writeLocalMedia } from "../src/lib/media.js";

const t = tracker();
const mediaKeys: string[] = [];

afterAll(async () => {
  for (const key of mediaKeys) await deleteMedia(key).catch(() => undefined);
  await cleanup(t);
});

const gameId = () => `D${randomUUID().replaceAll("-", "").slice(0, 10)}`.toUpperCase();

function offer(id: string, overrides: Partial<CreateOfferInput> = {}): CreateOfferInput {
  return {
    gameAccountId: id,
    acceptsExchange: false,
    title: "Compte Division 2 — 2 900 OVR",
    description: "Compte propre, e-mail de récupération fourni après l’achat.",
    division: "Division 2",
    teamPower: 2900,
    coins: 300,
    basePrice: 30_000,
    paymentMode: "ONE_TIME",
    credentials: { loginId: "joueur@example.com", password: "secret" },
    ...overrides,
  };
}

async function newSeller() {
  const user = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, user);
  return { user, seller, owner: { kind: "seller" as const, sellerId: seller.id } };
}

describe("ID eFootball", () => {
  it("se compare sans espaces, tirets ni casse ; trop court = refusé", async () => {
    expect(normalizeGameId(" 12 34-ab ")).toBe("1234AB");
    expect(parseGameId("abcd-1234")).toBe("ABCD1234");
    expect((await expectApiError(async () => parseGameId("a-1"))).code).toBe("VALIDATION_ERROR");
  });

  it("un compte déjà en vente est refusé à un autre vendeur (équipe prévenue) comme au même vendeur", async () => {
    const admin = await createAdmin(t);
    const a = await newSeller();
    const b = await newSeller();
    const id = gameId();
    const first = await createOffer(offer(id), a.owner, { actorId: a.user.id });
    track(t, "productIds", first.id);

    // Autre vendeur, même compte écrit autrement : refusé, l'équipe est alertée.
    const spaced = id.slice(0, 4) + " " + id.slice(4).toLowerCase();
    const err = await expectApiError(() => createOffer(offer(spaced), b.owner, { actorId: b.user.id }));
    expect(err.code).toBe("GAME_ID_IN_USE");
    expect(err.message).toContain("déjà publié sur MISTERDOU");
    expect(await prisma.notification.count({ where: { userId: admin.user.id, title: "Compte déjà en ligne : tentative refusée" } })).toBe(1);

    // Même vendeur (doublon par erreur) : refusé aussi, sans alerte.
    const again = await expectApiError(() => createOffer(offer(id), a.owner, { actorId: a.user.id }));
    expect(again.code).toBe("GAME_ID_IN_USE");
    expect(again.message).toContain("une de vos offres");
    expect(await prisma.notification.count({ where: { userId: admin.user.id, title: "Compte déjà en ligne : tentative refusée" } })).toBe(1);

    // L'équipe non plus ne peut pas publier ce compte en offre MISTERDOU.
    expect((await expectApiError(() => createOffer(offer(id), { kind: "team" }, { actorId: admin.user.id }))).code).toBe("GAME_ID_IN_USE");
  });

  it("deux publications simultanées du même compte : une seule passe", async () => {
    const a = await newSeller();
    const b = await newSeller();
    const id = gameId();
    const results = await Promise.allSettled([
      createOffer(offer(id), a.owner, { actorId: a.user.id }),
      createOffer(offer(id), b.owner, { actorId: b.user.id }),
    ]);
    for (const r of results) if (r.status === "fulfilled") track(t, "productIds", r.value.id);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.product.count({ where: { gameAccountId: id } })).toBe(1);
  });

  it("une modification ne peut pas reprendre l'ID d'une autre offre", async () => {
    const a = await newSeller();
    const taken = gameId();
    const other = await createProduct(t, { sellerId: (await newSeller()).seller.id, gameAccountId: taken });
    expect(other.id).toBeTruthy();
    const mine = await createOffer(offer(gameId()), a.owner, { actorId: a.user.id });
    track(t, "productIds", mine.id);
    const err = await expectApiError(() => updateOffer(mine.id, { ...offer(taken), credentials: undefined }, a.owner, { actorId: a.user.id }));
    expect(err.code).toBe("GAME_ID_IN_USE");
  });

  it("une fois vendu, le compte peut être republié ; l'équipe voit son historique", async () => {
    const id = gameId();
    const seller = await newSeller();
    const sold = await createProduct(t, { sellerId: seller.seller.id, gameAccountId: id, status: "SOLD" });
    const buyer = await createUser(t, { kycVerified: true });
    const order = await prisma.order.create({
      data: {
        orderNumber: `MD-T-${randomUUID().slice(0, 8)}`,
        buyerId: buyer.id,
        status: "COMPLETED",
        totalAmount: 30_000,
        deliveredAt: new Date(),
        items: { create: { productId: sold.id, title: sold.title, division: "Division 2", teamPower: 2900, coins: 300, unitPrice: 30_000 } },
      },
    });
    track(t, "orderIds", order.id);

    // L'acheteur, devenu vendeur, remet le compte en vente.
    const reseller = await newSeller();
    const again = await createOffer(offer(id), reseller.owner, { actorId: reseller.user.id });
    track(t, "productIds", again.id);
    const review = await getOfferForReview(again.id);
    expect(review.gameAccountId).toBe(id);
    expect(review.gameIdHistory).toEqual([expect.objectContaining({ kind: "sale", reference: order.orderNumber })]);
  });

  it("« Échange accepté » seul ne renvoie pas l'offre en validation", async () => {
    const admin = await createAdmin(t);
    const a = await newSeller();
    const input = offer(gameId());
    const created = await createOffer(input, a.owner, { actorId: a.user.id });
    track(t, "productIds", created.id);
    await reviewOffer(created.id, { decision: "approve" }, { actorId: admin.user.id, actorRole: "ADMIN" });

    // Même contenu, échange activé : reste en ligne.
    await updateOffer(created.id, { ...input, acceptsExchange: true, credentials: undefined }, a.owner, { actorId: a.user.id });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ status: "ACTIVE", acceptsExchange: true });
    // Interrupteur seul.
    await setOfferExchange(created.id, false, a.owner, { actorId: a.user.id });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ status: "ACTIVE", acceptsExchange: false });
    // Un autre vendeur ne peut pas toucher l'interrupteur.
    const b = await newSeller();
    expect((await expectApiError(() => setOfferExchange(created.id, true, b.owner, { actorId: b.user.id }))).code).toBe("FORBIDDEN");
    // Changer le prix, lui, repasse en validation.
    await updateOffer(created.id, { ...input, basePrice: 28_000, credentials: undefined }, a.owner, { actorId: a.user.id });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("PENDING_REVIEW");
  });
});

describe("Empreinte des fichiers", () => {
  async function media(productId: string, bytes: Buffer) {
    const key = `products/${productId}/${randomUUID()}.png`;
    await writeLocalMedia(key, bytes);
    mediaKeys.push(key);
    return prisma.productImage.create({ data: { productId, objectKey: key, mimeType: "image/png", sizeBytes: bytes.length } });
  }

  it("un même fichier sur deux offres : alerte à l'équipe, rien n'est bloqué ; nom différent, même empreinte", async () => {
    const admin = await createAdmin(t);
    const a = await createProduct(t, { title: "Offre A empreinte" });
    const b = await createProduct(t, { title: "Offre B empreinte" });
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(randomUUID())]);
    const first = await media(a.id, bytes);
    expect(await fingerprintProductMedia(first.id)).toEqual([]);

    const copy = await media(b.id, bytes);
    const refs = await fingerprintProductMedia(copy.id);
    expect(refs).toEqual([expect.objectContaining({ kind: "offer", productId: a.id })]);
    const rows = await prisma.productImage.findMany({ where: { id: { in: [first.id, copy.id] } }, select: { contentHash: true } });
    expect(rows[0]!.contentHash).toHaveLength(64);
    expect(rows[0]!.contentHash).toBe(rows[1]!.contentHash);
    expect(await prisma.notification.count({ where: { userId: admin.user.id, title: "Même fichier sur plusieurs offres" } })).toBe(1);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "ACTIVE" });

    // Fiche à valider : le doublon est indiqué sur le média.
    const dup = await duplicateMediaFor([copy.id]);
    expect(dup.get(copy.id)?.[0]).toMatchObject({ productId: a.id });
    expect(await productIdsWithDuplicateMedia()).toEqual(expect.arrayContaining([a.id, b.id]));

    // Un fichier différent n'est pas confondu.
    const other = await media(b.id, Buffer.concat([bytes, Buffer.from("x")]));
    expect(await fingerprintProductMedia(other.id)).toEqual([]);
  });

  it("rattrapage des médias déjà en ligne, sans alerte par fichier", async () => {
    const p = await createProduct(t);
    const image = await media(p.id, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(randomUUID())]));
    const result = await backfillFingerprints(500);
    expect(result.hashed).toBeGreaterThanOrEqual(1);
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } })).contentHash).toHaveLength(64);
  });
});
