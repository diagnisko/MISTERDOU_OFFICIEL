import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { getThread, listInbox, listMyThreads, messageSchema, myThreadForProduct, postInThread, sendToSeller } from "./service.js";

const TAG = "Discussions produit";
const idParams = z.object({ id: z.string().uuid() });
const secured = (summary: string) => ({ tags: [TAG], summary, security: [{ bearerAuth: [] }] });
const rate = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

export async function registerProductChatRoutes(app: FastifyInstance) {
  // --- Client : fil existant sur un compte (fiche produit) ---
  app.get("/products/:id/thread", { schema: secured("Ma discussion sur ce compte (ou null)") }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await myThreadForProduct(id, requireAuth(request)));
  });

  // --- Client : écrire au vendeur d'un compte (ouvre le fil au besoin) ---
  app.post("/products/:id/thread", { schema: secured("Écrire au vendeur d'un compte"), config: rate(20) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { content } = messageSchema.parse(request.body);
    return sendOk(reply, await sendToSeller(id, requireAuth(request), content));
  });

  // --- Client : mes discussions ---
  app.get("/threads/mine", { schema: secured("Mes discussions sur des comptes") }, async (request, reply) => {
    return sendOk(reply, await listMyThreads(requireAuth(request)));
  });

  // --- En-tête du site : messages non lus (achats + ventes) et page à ouvrir ---
  app.get("/threads/unread", { schema: secured("Nombre de messages non lus") }, async (request, reply) => {
    const viewer = requireAuth(request);
    const mine = await listMyThreads(viewer);
    const buying = mine.reduce((n, t) => n + t.unread, 0);
    let selling = 0;
    let side: "seller" | "team" | null = null;
    const isMember = viewer.user.role?.name !== "ADMIN" && viewer.user.role?.name !== "STAFF";
    if (!isMember) {
      // Équipe : discussions des comptes à traiter dans la console.
      const inbox = await listInbox(viewer).catch(() => null);
      const total = inbox ? inbox.items.reduce((n, t) => n + t.unread, 0) : 0;
      return sendOk(reply, { total, href: "/admin/discussions", seller: false });
    }
    {
      const inbox = await listInbox(viewer).catch(() => null);
      if (inbox) {
        side = inbox.side;
        selling = inbox.items.reduce((n, t) => n + t.unread, 0);
      }
    }
    const href = selling > 0 && buying === 0 ? "/seller/messages" : "/account/messages";
    return sendOk(reply, { total: buying + selling, href, seller: side === "seller" });
  });

  // --- En-tête : aperçu des dernières discussions (fenêtre de l'icône messages) ---
  // Discussions sur des comptes (achats, ventes ou équipe) et conversations avec
  // le support, triées par dernier message ; chaque ligne ouvre la bonne discussion.
  app.get("/threads/recent", { schema: secured("Dernières discussions (aperçu de l'icône messages)") }, async (request, reply) => {
    const viewer = requireAuth(request);
    const role = viewer.user.role?.name;
    const team = role === "ADMIN" || role === "STAFF";
    type Item = {
      key: string;
      kind: "product" | "support";
      title: string;
      counterpart: string;
      preview: string | null;
      at: string;
      unread: number;
      href: string;
      /** Photo de l'interlocuteur (vendeur ou client) ; null = initiale ou logo MISTERDOU. */
      imageUrl: string | null;
      counterpartKind: "seller" | "client" | "platform";
    };
    const items: Item[] = [];
    const fromThread = (t: Awaited<ReturnType<typeof listMyThreads>>[number], base: string): Item => ({
      key: `t:${t.id}`,
      kind: "product",
      title: t.product.title,
      counterpart: t.counterpart,
      preview: t.lastMessage?.preview ?? null,
      at: t.lastMessage?.createdAt ?? t.lastMessageAt,
      unread: t.unread,
      href: `${base}?thread=${t.id}`,
      imageUrl: t.counterpartAvatarUrl,
      counterpartKind: t.counterpartKind,
    });

    if (!team) for (const t of await listMyThreads(viewer)) items.push(fromThread(t, "/account/messages"));
    const inbox = await listInbox(viewer).catch(() => null);
    if (inbox) for (const t of inbox.items) items.push(fromThread(t, team ? "/admin/discussions" : "/seller/messages"));

    const convos = await prisma.conversation.findMany({
      where: { OR: [{ participantAUserId: viewer.user.id }, { participantBUserId: viewer.user.id }] },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        updatedAt: true,
        message: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } },
        _count: { select: { message: { where: { senderId: { not: viewer.user.id }, readAt: null } } } },
      },
    });
    for (const c of convos) {
      const last = c.message[0];
      items.push({
        key: `c:${c.id}`,
        kind: "support",
        title: "Support MISTERDOU",
        counterpart: team ? "Client" : "Équipe MISTERDOU",
        preview: last ? last.content.slice(0, 120) : null,
        at: (last?.createdAt ?? c.updatedAt).toISOString(),
        unread: c._count.message,
        href: `/messages?c=${c.id}`,
        imageUrl: null,
        counterpartKind: team ? "client" : "platform",
      });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    const total = items.reduce((n, i) => n + i.unread, 0);
    const href = team ? "/admin/discussions" : items.find((i) => i.unread > 0)?.href.split("?")[0] ?? "/account/messages";
    return sendOk(reply, { total, href, items: items.slice(0, 8) });
  });

  // --- Vendeur (ses comptes) ou équipe (tout) : boîte de réception ---
  app.get("/threads/inbox", { schema: secured("Discussions à traiter côté vente") }, async (request, reply) => {
    return sendOk(reply, await listInbox(requireAuth(request)));
  });

  app.get("/threads/:id", { schema: secured("Lire une discussion (marque comme lu)") }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await getThread(id, requireAuth(request)));
  });

  app.post("/threads/:id/messages", { schema: secured("Répondre dans une discussion"), config: rate(30) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { content } = messageSchema.parse(request.body);
    return sendOk(reply, await postInThread(id, requireAuth(request), content));
  });
}
