import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth } from "../../lib/auth-context.js";
import { badRequest } from "../../lib/errors.js";
import { chatImageUploadUrl } from "./service.js";

const uploadBody = z.object({ mimeType: z.string().max(60), sizeBytes: z.number().int().positive() });

export async function registerChatImageRoutes(app: FastifyInstance) {
  // Lien d'envoi d'une image à joindre à un message (discussion ou support).
  app.post(
    "/chat-images/upload-url",
    {
      schema: { tags: ["Messagerie"], summary: "Lien d'envoi d'une image de message", security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const parsed = uploadBody.safeParse(request.body);
      if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Type ou taille d’image invalide.");
      return sendOk(reply, await chatImageUploadUrl(auth.user.id, parsed.data.mimeType, parsed.data.sizeBytes));
    },
  );
}
