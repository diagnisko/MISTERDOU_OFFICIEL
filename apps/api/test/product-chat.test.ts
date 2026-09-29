// Discussion client ↔ côté vente sur un compte : le client ne voit jamais qui
// répond, le vendeur voit « Équipe MISTERDOU », l'équipe voit l'auteur réel.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createProduct, createSeller, createStaff, createUser, tracker } from "./helpers.js";
import { registerProductChatRoutes } from "../src/modules/product-chat/routes.js";
import type { ActiveSession } from "../src/lib/auth-context.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function chatApp(auth: ActiveSession) {
  return buildMiniApp({ auth }, async (instance) => {
    await instance.register(registerProductChatRoutes, { prefix: "/api/v1" });
  });
}

async function vendorProduct() {
  const owner = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, owner);
  const product = await createProduct(t, { sellerId: seller.id });
  return { owner, product };
}

describe("Discussion sur un compte", () => {
  it("client, vendeur et manager échangent ; chacun voit les auteurs selon son rôle", async () => {
    const { owner, product } = await vendorProduct();
    const buyer = await createUser(t);
    const client = await chatApp(await authFor(buyer.id));

    const opened = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "Le compte a-t-il Messi ?" } });
    expect(opened.statusCode).toBe(200);
    const threadId = opened.json().data.threadId;

    // Un second message réutilise le même fil.
    const again = await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "Et combien de coins ?" } });
    expect(again.json().data.threadId).toBe(threadId);

    // Le vendeur est prévenu et voit le fil avec le nom du client.
    expect(await prisma.notification.findFirst({ where: { userId: owner.id, type: "NEW_MESSAGE" } })).not.toBeNull();
    const seller = await chatApp(await authFor(owner.id));
    const inbox = (await seller.inject({ method: "GET", url: "/api/v1/threads/inbox" })).json().data;
    expect(inbox.side).toBe("seller");
    const row = inbox.items.find((i: { id: string }) => i.id === threadId);
    expect(row.unread).toBe(2);
    expect(row.counterpart.startsWith(buyer.firstName)).toBe(true);

    await seller.inject({ method: "POST", url: `/api/v1/threads/${threadId}/messages`, payload: { content: "Oui, Messi est là." } });

    const manager = await createStaff(t, ["SUPPORT"]);
    const team = await chatApp(manager.session);
    const reply = await team.inject({ method: "POST", url: `/api/v1/threads/${threadId}/messages`, payload: { content: "Environ 1 million de coins." } });
    expect(reply.statusCode).toBe(200);

    // Client : les deux réponses viennent du « Vendeur », sans distinction.
    const clientView = (await client.inject({ method: "GET", url: `/api/v1/threads/${threadId}` })).json().data;
    expect(clientView.side).toBe("client");
    expect(clientView.messages.map((m: { author: string }) => m.author)).toEqual(["Vous", "Vous", "Vendeur", "Vendeur"]);
    expect(JSON.stringify(clientView)).not.toContain(manager.user.firstName);
    expect(JSON.stringify(clientView)).not.toContain(owner.firstName);

    // Vendeur : la réponse du manager apparaît comme « Équipe MISTERDOU ».
    const sellerView = (await seller.inject({ method: "GET", url: `/api/v1/threads/${threadId}` })).json().data;
    const sellerAuthors = sellerView.messages.map((m: { author: string }) => m.author);
    expect(sellerAuthors.slice(2)).toEqual(["Vous", "Équipe MISTERDOU"]);
    expect(sellerAuthors[0].startsWith(buyer.firstName)).toBe(true);

    // Admin : auteur réel et rôle.
    const admin = await createAdmin(t);
    const adminApp = await chatApp(admin.session);
    const adminView = (await adminApp.inject({ method: "GET", url: `/api/v1/threads/${threadId}` })).json().data;
    expect(adminView.side).toBe("team");
    expect(adminView.messages[2].author.startsWith(owner.firstName)).toBe(true);
    expect(adminView.messages[2].author.endsWith(" · Vendeur")).toBe(true);
    expect(adminView.messages[3].author.startsWith(manager.user.firstName)).toBe(true);
    expect(adminView.messages[3].author.endsWith(" · Manager")).toBe(true);

    // Le client a été prévenu des réponses et n'a plus de non-lus après lecture.
    expect(await prisma.notification.count({ where: { userId: buyer.id, type: "NEW_MESSAGE" } })).toBe(2);
    const mine = (await client.inject({ method: "GET", url: "/api/v1/threads/mine" })).json().data;
    expect(mine.find((i: { id: string }) => i.id === threadId)).toMatchObject({ counterpart: "Vendeur", unread: 0 });

    await Promise.all([client.close(), seller.close(), team.close(), adminApp.close()]);
  });

  it("personne d'autre ne lit le fil : autre client, autre vendeur, manager sans SUPPORT", async () => {
    const { product } = await vendorProduct();
    const buyer = await createUser(t);
    const client = await chatApp(await authFor(buyer.id));
    const threadId = (await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "Bonjour" } })).json().data.threadId;

    const intruder = await chatApp(await authFor((await createUser(t)).id));
    expect((await intruder.inject({ method: "GET", url: `/api/v1/threads/${threadId}` })).statusCode).toBe(404);
    expect((await intruder.inject({ method: "POST", url: `/api/v1/threads/${threadId}/messages`, payload: { content: "x" } })).statusCode).toBe(404);
    expect((await intruder.inject({ method: "GET", url: "/api/v1/threads/inbox" })).statusCode).toBe(403);

    const other = await vendorProduct();
    const otherSeller = await chatApp(await authFor(other.owner.id));
    expect((await otherSeller.inject({ method: "GET", url: `/api/v1/threads/${threadId}` })).statusCode).toBe(404);
    const otherInbox = (await otherSeller.inject({ method: "GET", url: "/api/v1/threads/inbox" })).json().data;
    expect(otherInbox.items.map((i: { id: string }) => i.id)).not.toContain(threadId);

    const orders = await createStaff(t, ["ORDERS"]);
    const noSupport = await chatApp(orders.session);
    expect((await noSupport.inject({ method: "GET", url: `/api/v1/threads/${threadId}` })).statusCode).toBe(404);

    await Promise.all([client.close(), intruder.close(), otherSeller.close(), noSupport.close()]);
  });

  it("refuse de s'écrire sur son propre compte, ou d'ouvrir un fil sur un compte vendu", async () => {
    const { owner, product } = await vendorProduct();
    const self = await chatApp(await authFor(owner.id));
    expect((await self.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "test" } })).statusCode).toBe(400);

    const sold = await createProduct(t, { status: "SOLD" });
    const buyer = await chatApp(await authFor((await createUser(t)).id));
    expect((await buyer.inject({ method: "POST", url: `/api/v1/products/${sold.id}/thread`, payload: { content: "Encore dispo ?" } })).statusCode).toBe(400);
    expect((await buyer.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "  " } })).statusCode).toBe(400);
    await Promise.all([self.close(), buyer.close()]);
  });

  it("un compte de la plateforme affiche « MISTERDOU » et alerte l'équipe", async () => {
    await createAdmin(t);
    const product = await createProduct(t);
    const buyer = await createUser(t);
    const client = await chatApp(await authFor(buyer.id));
    const threadId = (await client.inject({ method: "POST", url: `/api/v1/products/${product.id}/thread`, payload: { content: "Disponible ?" } })).json().data.threadId;
    const alert = await prisma.notification.findFirst({ where: { type: "NEW_MESSAGE", actionUrl: `/admin/discussions?thread=${threadId}` } });
    expect(alert).not.toBeNull();
    const view = (await client.inject({ method: "GET", url: `/api/v1/products/${product.id}/thread` })).json().data;
    expect(view.counterpart).toBe("MISTERDOU");
    await client.close();
  });
});
