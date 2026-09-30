import type { FastifyInstance } from "fastify";
import { getPublicMeta, getSupportContacts } from "./service.js";
import { sendPublicOk, PUBLIC_CACHE_CONTROL } from "../../lib/envelope.js";

export async function registerSettingsRoutes(app: FastifyInstance) {
  // Métadonnées publiques (catalogue) — aucun secret, computed depuis Settings.
  // Route PUBLIQUE idempotente : cache 60 s + ETag (sendPublicOk).
  app.route({
    method: "GET",
    url: "/meta",
    schema: { tags: ["Public"], summary: "Paramètres publics (configurs en base)" },
    handler: async (request, reply) => {
      reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
      return sendPublicOk(request, reply, await getPublicMeta());
    },
  });

  // Contacts du support (WhatsApp, e-mail) réglés dans Console > Paramètres.
  app.get("/support/contacts", { schema: { tags: ["Public"], summary: "Contacts du support" } }, async (request, reply) => {
    reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
    return sendPublicOk(request, reply, await getSupportContacts());
  });
}
