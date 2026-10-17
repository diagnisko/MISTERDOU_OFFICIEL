import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import { sendOk } from "../../lib/envelope.js";
import { requireAdminSession, requireAuth, requirePermission } from "../../lib/auth-context.js";
import { validationError } from "../../lib/validation-messages.js";
import {
  addSiteVideo,
  addVideoSchema,
  listSiteVideos,
  moveSiteVideo,
  moveVideoSchema,
  removeSiteVideo,
  updateSiteVideo,
  updateVideoSchema,
} from "./service.js";

const TAG = "Vidéos du site";
const secured = (summary: string) => ({ tags: [TAG], summary, security: [{ bearerAuth: [] }] });

function actor(request: FastifyRequest) {
  const auth = requireAuth(request);
  return { actorId: auth.user.id, ip: request.ip };
}

// Lecture : l'équipe qui voit les Paramètres ; modification : l'administrateur
// (session renforcée), comme les autres réglages du site.
async function canRead(request: FastifyRequest) {
  await requirePermission(request, "SETTINGS");
}
async function canWrite(request: FastifyRequest) {
  requireAdminSession(request);
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw validationError(result.error.issues);
  return result.data as z.infer<S>;
}

export async function registerSiteVideoRoutes(app: FastifyInstance) {
  // Public : vidéos de la page « Comment ça marche », dans l'ordre choisi.
  app.get("/site/videos", { schema: { tags: [TAG], summary: "Vidéos de la page « Comment ça marche »" } }, async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    return sendOk(reply, await listSiteVideos());
  });

  app.get("/admin/site/videos", { preHandler: canRead, schema: secured("Vidéos de la page « Comment ça marche »") }, async (_request, reply) =>
    sendOk(reply, await listSiteVideos()),
  );

  app.post("/admin/site/videos", { preHandler: canWrite, schema: secured("Ajouter une vidéo YouTube") }, async (request, reply) => {
    const input = parse(addVideoSchema, request.body);
    return reply.status(201).send({ ok: true, data: await addSiteVideo(input, actor(request)) });
  });

  app.patch("/admin/site/videos/:id", { preHandler: canWrite, schema: secured("Modifier le texte d'une vidéo") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendOk(reply, await updateSiteVideo(id, parse(updateVideoSchema, request.body), actor(request)));
  });

  app.post("/admin/site/videos/:id/move", { preHandler: canWrite, schema: secured("Changer l'ordre d'une vidéo") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendOk(reply, await moveSiteVideo(id, parse(moveVideoSchema, request.body).direction, actor(request)));
  });

  app.delete("/admin/site/videos/:id", { preHandler: canWrite, schema: secured("Retirer une vidéo") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendOk(reply, await removeSiteVideo(id, actor(request)));
  });
}
