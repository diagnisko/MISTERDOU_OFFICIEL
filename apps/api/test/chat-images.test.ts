// Images dans les messages : bouton « + » (images seulement, 5 au plus),
// rangées dans l'espace privé, lues par lien signé, effacées après 30 jours
// sauf signalement ouvert.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createProduct, createSeller, createUser, track, tracker } from "./helpers.js";
import { registerProductChatRoutes } from "../src/modules/product-chat/routes.js";
import { registerMessagingRoutes } from "../src/modules/messaging/routes.js";
import { registerChatImageRoutes } from "../src/modules/chat-images/routes.js";
import { registerMediaRoutes } from "../src/modules/media/routes.js";
import { purgeChatImages } from "../src/modules/chat-images/service.js";
import { deletePrivate } from "../src/lib/private-media.js";
import type { ActiveSession } from "../src/lib/auth-context.js";

const t = tracker();
const keys: string[] = [];

afterAll(async () => {
  for (const key of keys) await deletePrivate(key).catch(() => undefined);
  await cleanup(t);
});

const png = () => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(randomUUID())]);

async function app(auth: ActiveSession) {
  return buildMiniApp({ auth }, async (instance) => {
    await instance.register(
      async (api) => {
        await registerProductChatRoutes(api);
        await registerMessagingRoutes(api);
        await registerChatImageRoutes(api);
        await registerMediaRoutes(api);
      },
      { prefix: "/api/v1" },
    );
  });
}

type App = Awaited<ReturnType<typeof app>>;

/** Envoi réel : lien d'envoi, dépôt du fichier, puis référence à joindre au message. */
async function upload(client: App, bytes = png(), mimeType = "image/png") {
  const res = await client.inject({ method: "POST", url: "/api/v1/chat-images/upload-url", payload: { mimeType, sizeBytes: bytes.length } });
  expect(res.statusCode).toBe(200);
  const { key, uploadUrl } = res.json().data as { key: string; uploadUrl: string };
  const put = await client.inject({ method: "PUT", url: uploadUrl, payload: bytes, headers: { "content-type": mimeType } });
  expect(put.statusCode).toBe(200);
  keys.push(key);
  return { key, mimeType };
}

async function setup() {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id });
  const buyer = await createUser(t, { kycVerified: true });
  return { owner, product, buyer, client: await app(await authFor(buyer.id)), vendor: await app(await authFor(owner.id)) };
}

describe("Images dans la discussion d'un compte", () => {
  it("photo seule ou avec texte ; visible par les deux côtés, par lien signé", async () => {
    const { product, client, vendor } = await setup();
    const image = await upload(client);
    const sent = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { images: [image] } });
    expect(sent.statusCode).toBe(200);
    const threadId = sent.json().data.threadId as string;

    const thread = await vendor.inject({ method: "GET", url: `/api/v1/threads/${threadId}` });
    const message = thread.json().data.messages[0];
    expect(message.content).toBe("");
    expect(message.images).toHaveLength(1);
    expect(message.images[0].expired).toBe(false);
    const file = await vendor.inject({ method: "GET", url: message.images[0].url });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    // Lien falsifié : refusé.
    const forged = await vendor.inject({ method: "GET", url: message.images[0].url.replace(/sig=[0-9a-f]+/, "sig=" + "0".repeat(64)) });
    expect(forged.statusCode).toBe(403);
    // Aperçu de la liste et de la notification : « 📷 Photo ».
    expect(thread.json().data.lastMessage.preview).toBe("📷 Photo");

    const reply = await vendor.inject({ method: "POST", url: `/api/v1/threads/${threadId}/messages`, payload: { content: "Voici une capture.", images: [await upload(vendor)] } });
    expect(reply.statusCode).toBe(200);
  });

  it("images seulement, 5 au plus, envoyées par soi-même ; message vide refusé", async () => {
    const { product, client, buyer } = await setup();
    const video = await client.inject({ method: "POST", url: "/api/v1/chat-images/upload-url", payload: { mimeType: "video/mp4", sizeBytes: 1000 } });
    expect(video.json().error.code).toBe("FILE_TYPE_INVALID");
    const big = await client.inject({ method: "POST", url: "/api/v1/chat-images/upload-url", payload: { mimeType: "image/png", sizeBytes: 6 * 1024 * 1024 } });
    expect(big.json().error.code).toBe("FILE_TOO_LARGE");

    const empty = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "  " } });
    expect(empty.statusCode).toBe(400);
    const six = Array.from({ length: 6 }, () => ({ key: `chat/${buyer.id}/${randomUUID()}.png`, mimeType: "image/png" }));
    expect((await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { images: six } })).statusCode).toBe(400);

    // Image d'un autre utilisateur : refusée.
    const other = await app(await authFor((await createUser(t)).id));
    const theirs = await upload(other);
    const stolen = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { images: [theirs] } });
    expect(stolen.json().error.code).toBe("VALIDATION_ERROR");

    // Fichier qui n'est pas l'image annoncée : refusé.
    const fake = await upload(client, Buffer.from("ce n'est pas une image"), "image/jpeg");
    const bad = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { images: [fake] } });
    expect(bad.json().error.code).toBe("FILE_TYPE_INVALID");
  });
});

describe("Images dans la messagerie du support", () => {
  it("le membre envoie une photo à l'équipe", async () => {
    const member = await createUser(t);
    const admin = await createAdmin(t);
    const convo = await prisma.conversation.create({
      data: { kind: "CLIENT_TO_ADMIN", participantAUserId: member.id, participantBUserId: admin.user.id },
    });
    track(t, "conversationIds", convo.id);
    const memberApp = await app(await authFor(member.id));
    const sent = await memberApp.inject({ method: "POST", url: `/api/v1/conversations/${convo.id}/messages`, payload: { images: [await upload(memberApp)] } });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().data.images).toHaveLength(1);

    const adminApp = await app(admin.session);
    const list = await adminApp.inject({ method: "GET", url: `/api/v1/conversations/${convo.id}/messages` });
    expect(list.json().data.items[0].images[0].url).toContain("/api/v1/private-media/file/chat/");
  });
});

describe("Conservation des images", () => {
  it("effacées après 30 jours (« image expirée »), sauf signalement ouvert", async () => {
    const { product, client, vendor, buyer } = await setup();
    const sent = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "Preuve", images: [await upload(client)] } });
    const threadId = sent.json().data.threadId as string;
    const image = await prisma.chatImage.findFirstOrThrow({ where: { productMessage: { threadId } } });
    await prisma.chatImage.update({ where: { id: image.id }, data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } });

    // Signalement ouvert sur une commande de ce client pour ce compte : l'image reste.
    const order = await prisma.order.create({
      data: {
        orderNumber: `MD-T-${randomUUID().slice(0, 8)}`,
        buyerId: buyer.id,
        status: "DELIVERED",
        totalAmount: 1000,
        items: { create: { productId: product.id, title: "x", division: "x", teamPower: 1, coins: 1, unitPrice: 1000 } },
      },
    });
    track(t, "orderIds", order.id);
    const ticket = await prisma.supportTicket.create({
      data: { orderId: order.id, reporterId: buyer.id, category: "SELLER_REPORT", subject: "Problème", description: "Le compte ne marche pas." },
    });
    await purgeChatImages();
    expect((await prisma.chatImage.findUniqueOrThrow({ where: { id: image.id } })).purgedAt).toBeNull();

    // Signalement clos : l'image est effacée et s'affiche comme expirée.
    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "RESOLVED" } });
    await purgeChatImages();
    expect((await prisma.chatImage.findUniqueOrThrow({ where: { id: image.id } })).purgedAt).not.toBeNull();
    const thread = await vendor.inject({ method: "GET", url: `/api/v1/threads/${threadId}` });
    expect(thread.json().data.messages[0].images[0]).toMatchObject({ url: null, expired: true });
  });
});
