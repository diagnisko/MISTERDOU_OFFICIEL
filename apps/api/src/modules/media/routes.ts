import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission } from "../../lib/auth-context.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { publicBucket } from "../../lib/r2.js";
import {
  MEDIA_LIMITS,
  MEDIA_TYPES,
  confirmUpload,
  createUpload,
  deleteMedia,
  maxBytes,
  mediaKind,
  publicUrl,
  readLocalMedia,
  verifyLocalUpload,
  writeLocalMedia,
} from "../../lib/media.js";

// ---------------------------------------------------------------------------
// Médias publics des offres (images, vidéos). Gérables par le vendeur
// propriétaire (compte vendeur actif) ou par l'équipe (permission PRODUCTS).
// ---------------------------------------------------------------------------

const mimeEnum = z.enum(Object.keys(MEDIA_TYPES) as [string, ...string[]]);
const uploadBody = z.object({ mimeType: mimeEnum, sizeBytes: z.number().int().positive() });
const confirmBody = z.object({ key: z.string().min(10).max(200), mimeType: mimeEnum });

async function manageable(request: FastifyRequest, productId: string) {
  const auth = requireAuth(request);
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, seller: { select: { userId: true, status: true } } },
  });
  if (!product) throw notFound("Offre introuvable.");
  if (product.seller?.userId === auth.user.id) {
    if (product.seller.status !== "ACTIVE") throw forbidden("Votre compte vendeur n’est pas actif.");
    return auth;
  }
  return requirePermission(request, "PRODUCTS");
}

function toDto(m: { id: string; objectKey: string; mimeType: string; sizeBytes: number; isPrimary: boolean; position: number }) {
  return {
    id: m.id,
    url: publicUrl(m.objectKey),
    mimeType: m.mimeType,
    kind: mediaKind(m.mimeType) ?? "image",
    sizeBytes: m.sizeBytes,
    isPrimary: m.isPrimary,
    position: m.position,
  };
}

async function countByKind(productId: string) {
  const rows = await prisma.productImage.findMany({ where: { productId }, select: { mimeType: true } });
  return {
    image: rows.filter((r) => mediaKind(r.mimeType) === "image").length,
    video: rows.filter((r) => mediaKind(r.mimeType) === "video").length,
  };
}

async function audit(request: FastifyRequest, action: string, productId: string, metadata: unknown) {
  const auth = requireAuth(request);
  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role?.name as RoleName | undefined,
    sessionId: auth.id,
    ip: request.ip,
    userAgent: request.headers["user-agent"],
    action,
    resourceType: "Product",
    resourceId: productId,
    metadata,
  });
}

export async function registerMediaRoutes(app: FastifyInstance) {
  app.get("/products/:id/media", async (request, reply) => {
    const { id } = request.params as { id: string };
    await manageable(request, id);
    const rows = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
    });
    return sendOk(reply, {
      items: rows.map(toDto),
      limits: { image: MEDIA_LIMITS.image, video: MEDIA_LIMITS.video, imageBytes: maxBytes("image"), videoBytes: maxBytes("video") },
    });
  });

  app.post(
    "/products/:id/media/upload-url",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await manageable(request, id);
      const input = uploadBody.safeParse(request.body);
      if (!input.success) throw badRequest("VALIDATION_ERROR", "Type ou taille de fichier invalide.");
      const kind = mediaKind(input.data.mimeType)!;
      if ((await countByKind(id))[kind] >= MEDIA_LIMITS[kind]) {
        throw conflict("MEDIA_LIMIT", `Maximum ${MEDIA_LIMITS[kind]} ${kind === "image" ? "images" : "vidéos"} par offre.`);
      }
      return sendOk(reply, await createUpload(`products/${id}`, input.data.mimeType, input.data.sizeBytes));
    },
  );

  app.post(
    "/products/:id/media",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await manageable(request, id);
      const input = confirmBody.safeParse(request.body);
      if (!input.success || !input.data.key.startsWith(`products/${id}/`)) {
        throw badRequest("VALIDATION_ERROR", "Référence de fichier invalide.");
      }
      const { key, mimeType } = input.data;
      if (await prisma.productImage.findFirst({ where: { objectKey: key }, select: { id: true } })) {
        throw conflict("MEDIA_EXISTS", "Ce fichier est déjà enregistré.");
      }
      const kind = mediaKind(mimeType)!;
      if ((await countByKind(id))[kind] >= MEDIA_LIMITS[kind]) {
        await deleteMedia(key);
        throw conflict("MEDIA_LIMIT", `Maximum ${MEDIA_LIMITS[kind]} ${kind === "image" ? "images" : "vidéos"} par offre.`);
      }
      const { sizeBytes } = await confirmUpload(key, mimeType);

      const created = await prisma.$transaction(async (tx) => {
        const last = await tx.productImage.aggregate({ where: { productId: id }, _max: { position: true } });
        const hasPrimary = await tx.productImage.count({ where: { productId: id, isPrimary: true } });
        return tx.productImage.create({
          data: {
            productId: id,
            objectKey: key,
            mimeType,
            sizeBytes,
            position: (last._max.position ?? -1) + 1,
            isPrimary: kind === "image" && hasPrimary === 0,
          },
        });
      });
      await audit(request, "PRODUCT_MEDIA_ADDED", id, { mediaId: created.id, mimeType, sizeBytes });
      return sendOk(reply, toDto(created));
    },
  );

  app.patch("/products/:id/media/:mediaId/primary", async (request, reply) => {
    const { id, mediaId } = request.params as { id: string; mediaId: string };
    await manageable(request, id);
    const media = await prisma.productImage.findFirst({ where: { id: mediaId, productId: id } });
    if (!media) throw notFound("Média introuvable.");
    if (mediaKind(media.mimeType) !== "image") throw badRequest("VALIDATION_ERROR", "Seule une image peut servir de couverture.");
    await prisma.$transaction([
      prisma.productImage.updateMany({ where: { productId: id }, data: { isPrimary: false } }),
      prisma.productImage.update({ where: { id: mediaId }, data: { isPrimary: true } }),
    ]);
    await audit(request, "PRODUCT_MEDIA_COVER", id, { mediaId });
    return sendOk(reply, { id: mediaId, isPrimary: true });
  });

  app.delete("/products/:id/media/:mediaId", async (request, reply) => {
    const { id, mediaId } = request.params as { id: string; mediaId: string };
    await manageable(request, id);
    const media = await prisma.productImage.findFirst({ where: { id: mediaId, productId: id } });
    if (!media) throw notFound("Média introuvable.");
    await prisma.productImage.delete({ where: { id: mediaId } });
    if (media.isPrimary) {
      const next = await prisma.productImage.findMany({ where: { productId: id }, orderBy: { position: "asc" } });
      const cover = next.find((m) => mediaKind(m.mimeType) === "image");
      if (cover) await prisma.productImage.update({ where: { id: cover.id }, data: { isPrimary: true } });
    }
    await deleteMedia(media.objectKey).catch((err) => request.log.warn({ err, key: media.objectKey }, "[media] suppression de l'objet échouée"));
    await audit(request, "PRODUCT_MEDIA_REMOVED", id, { mediaId, mimeType: media.mimeType });
    return sendOk(reply, { id: mediaId, deleted: true });
  });

  // --- Développement sans R2 : dépôt et service locaux -------------------
  if (!publicBucket()) {
    await app.register(async (local) => {
      local.addContentTypeParser(
        Object.keys(MEDIA_TYPES),
        { parseAs: "buffer", bodyLimit: maxBytes("video") },
        (_request, body, done) => done(null, body),
      );

      local.put("/media/upload/*", { bodyLimit: maxBytes("video") }, async (request, reply) => {
        const key = (request.params as { "*": string })["*"];
        const q = request.query as Record<string, string | undefined>;
        const mime = q.mime ?? "";
        const size = Number(q.size);
        if (!verifyLocalUpload(key, mime, size, Number(q.exp), q.sig ?? "")) throw forbidden("Lien d’envoi invalide ou expiré.");
        const body = request.body as Buffer;
        if (request.headers["content-type"] !== mime || !Buffer.isBuffer(body) || body.length !== size) {
          throw badRequest("VALIDATION_ERROR", "Le fichier ne correspond pas au lien d’envoi.");
        }
        await writeLocalMedia(key, body);
        return sendOk(reply, { key });
      });

      local.get("/media/*", async (request, reply) => {
        const key = (request.params as { "*": string })["*"];
        const ext = key.split(".").pop() ?? "";
        const mime = Object.entries(MEDIA_TYPES).find(([, t]) => t.ext === ext)?.[0] ?? "application/octet-stream";
        const body = await readLocalMedia(key);
        reply.header("Content-Type", mime).header("Cache-Control", "public, max-age=3600");
        return reply.send(body);
      });
    });
  }
}
