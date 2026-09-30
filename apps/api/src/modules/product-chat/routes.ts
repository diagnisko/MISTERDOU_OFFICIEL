import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
    if (isMember) {
      const inbox = await listInbox(viewer).catch(() => null);
      if (inbox) {
        side = inbox.side;
        selling = inbox.items.reduce((n, t) => n + t.unread, 0);
      }
    }
    const href = selling > 0 && buying === 0 ? "/seller/messages" : "/account/messages";
    return sendOk(reply, { total: buying + selling, href, seller: side === "seller" });
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
