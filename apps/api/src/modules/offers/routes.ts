import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RoleName } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission } from "../../lib/auth-context.js";
import {
  activeSellerId,
  createOffer,
  createOfferSchema,
  getOfferForEdit,
  parseOffer,
  removeOffer,
  updateOffer,
  updateOfferSchema,
  type OfferActor,
} from "./service.js";

function actor(request: FastifyRequest): OfferActor {
  const auth = requireAuth(request);
  return { actorId: auth.user.id, actorRole: auth.user.role?.name as RoleName | undefined, ip: request.ip };
}

const limited = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

export async function registerOfferRoutes(app: FastifyInstance) {
  // --- Vendeur : ses propres offres, publiées sans validation ---------------
  const sellerOwner = async (request: FastifyRequest) =>
    ({ kind: "seller", sellerId: await activeSellerId(requireAuth(request).user.id) }) as const;

  app.post("/seller/offers", limited, async (request, reply) => {
    const owner = await sellerOwner(request);
    const product = await createOffer(parseOffer(createOfferSchema, request.body), owner, actor(request));
    return reply.status(201).send({ ok: true, data: product });
  });

  app.get("/seller/offers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendOk(reply, await getOfferForEdit(id, await sellerOwner(request)));
  });

  app.put("/seller/offers/:id", limited, async (request, reply) => {
    const { id } = request.params as { id: string };
    const owner = await sellerOwner(request);
    return sendOk(reply, await updateOffer(id, parseOffer(updateOfferSchema, request.body), owner, actor(request)));
  });

  app.delete("/seller/offers/:id", limited, async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendOk(reply, await removeOffer(id, await sellerOwner(request), actor(request)));
  });

  // --- Équipe : offres MISTERDOU ------------------------------------------
  const team = { kind: "team" } as const;

  app.post("/admin/offerings", limited, async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const product = await createOffer(parseOffer(createOfferSchema, request.body), team, actor(request));
    return reply.status(201).send({ ok: true, data: product });
  });

  app.get("/admin/offerings/:id", async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const { id } = request.params as { id: string };
    return sendOk(reply, await getOfferForEdit(id, team));
  });

  app.put("/admin/offerings/:id", limited, async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const { id } = request.params as { id: string };
    return sendOk(reply, await updateOffer(id, parseOffer(updateOfferSchema, request.body), team, actor(request)));
  });

  app.delete("/admin/offerings/:id", limited, async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const { id } = request.params as { id: string };
    return sendOk(reply, await removeOffer(id, team, actor(request)));
  });
}
