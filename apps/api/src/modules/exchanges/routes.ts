import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission } from "../../lib/auth-context.js";
import { validationError } from "../../lib/validation-messages.js";
import {
  acceptExchange,
  acceptSchema,
  cancelExchange,
  codeSchema,
  createExchange,
  createExchangeSchema,
  custodyDecisionSchema,
  declineExchange,
  decideCustody,
  exchangeVideoUploadUrl,
  getExchange,
  listMyExchanges,
  listSellerExchanges,
  listTeamExchanges,
  prepareExchange,
  provideCustodyCode,
  replySchema,
  replyToExchange,
  reportExchange,
  reportSchema,
  requestCustodyCode,
  revealClientAccount,
  teamListQuery,
} from "./service.js";

const TAG = "Échanges";
const idParams = z.object({ id: z.string().uuid() });
const secured = (summary: string) => ({ tags: [TAG], summary, security: [{ bearerAuth: [] }] });
const rate = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });
const uploadBody = z.object({ mimeType: z.string().max(60), sizeBytes: z.number().int().positive() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

export async function registerExchangeRoutes(app: FastifyInstance) {
  // --- Client ---------------------------------------------------------------
  app.get("/exchanges/prepare", { schema: secured("Préparer une demande d'échange (code à filmer)") }, async (request, reply) => {
    const { productId } = parse(z.object({ productId: z.string().uuid() }), request.query);
    return sendOk(reply, await prepareExchange(productId, requireAuth(request)));
  });

  app.post("/exchanges/video/upload-url", { schema: secured("Lien d'envoi de la vidéo du compte"), config: rate(10) }, async (request, reply) => {
    const { mimeType, sizeBytes } = parse(uploadBody, request.body);
    return sendOk(reply, await exchangeVideoUploadUrl(requireAuth(request), mimeType, sizeBytes));
  });

  app.post("/exchanges", { schema: secured("Envoyer une demande d'échange"), config: rate(5) }, async (request, reply) => {
    const created = await createExchange(parse(createExchangeSchema, request.body), requireAuth(request), request.ip);
    return reply.status(201).send({ ok: true, data: created });
  });

  app.get("/exchanges/mine", { schema: secured("Mes demandes d'échange") }, async (request, reply) => {
    return sendOk(reply, await listMyExchanges(requireAuth(request)));
  });

  app.post("/exchanges/:id/accept", { schema: secured("Accepter le complément et confier son compte"), config: rate(10) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await acceptExchange(id, parse(acceptSchema, request.body), requireAuth(request), request.ip));
  });

  app.post("/exchanges/:id/decline", { schema: secured("Décliner la proposition"), config: rate(10) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await declineExchange(id, requireAuth(request), request.ip));
  });

  app.post("/exchanges/:id/cancel", { schema: secured("Annuler sa demande"), config: rate(10) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await cancelExchange(id, requireAuth(request), request.ip));
  });

  app.post("/exchanges/:id/custody-code", { schema: secured("Donner le code de connexion demandé"), config: rate(10) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { code } = parse(codeSchema, request.body);
    return sendOk(reply, await provideCustodyCode(id, code, requireAuth(request), request.ip));
  });

  // --- Vendeur ----------------------------------------------------------------
  app.get("/seller/exchanges", { schema: secured("Demandes d'échange reçues") }, async (request, reply) => {
    return sendOk(reply, await listSellerExchanges(requireAuth(request)));
  });

  app.post("/exchanges/:id/reply", { schema: secured("Annoncer le complément ou refuser"), config: rate(20) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await replyToExchange(id, parse(replySchema, request.body), requireAuth(request), request.ip));
  });

  app.post("/exchanges/:id/report", { schema: secured("Signaler un problème sur le compte reçu"), config: rate(5) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { message } = parse(reportSchema, request.body);
    return sendOk(reply, await reportExchange(id, message, requireAuth(request), request.ip));
  });

  // --- Commun (client, vendeur, équipe) -------------------------------------------
  app.get("/exchanges/:id", { schema: secured("Détail d'un échange") }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await getExchange(id, requireAuth(request)));
  });

  app.get("/exchanges/:id/client-account", { schema: secured("Identifiants du compte du client (tracé)"), config: rate(20) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await revealClientAccount(id, requireAuth(request), request.ip));
  });

  // --- Équipe (permission « Échanges ») ------------------------------------------
  app.get("/admin/exchanges", { schema: secured("Échanges (console)") }, async (request, reply) => {
    await requirePermission(request, "EXCHANGES");
    const { status } = parse(teamListQuery, request.query);
    return sendOk(reply, await listTeamExchanges(status));
  });

  app.post("/admin/exchanges/:id/code-request", { schema: secured("Demander un code de connexion au client"), config: rate(20) }, async (request, reply) => {
    await requirePermission(request, "EXCHANGES");
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await requestCustodyCode(id, requireAuth(request), request.ip));
  });

  app.post("/admin/exchanges/:id/custody", { schema: secured("Valider ou refuser le compte du client"), config: rate(20) }, async (request, reply) => {
    await requirePermission(request, "EXCHANGES");
    const { id } = idParams.parse(request.params);
    return sendOk(reply, await decideCustody(id, parse(custodyDecisionSchema, request.body), requireAuth(request), request.ip));
  });
}
