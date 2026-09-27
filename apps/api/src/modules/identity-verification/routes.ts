import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RoleName } from "@misterdou/db";
import { kycAdminActionSchema, kycSubmitSchema } from "@misterdou/shared";
import { sendOk } from "../../lib/envelope.js";
import { requireAuth, requirePermission } from "../../lib/auth-context.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { putFile } from "../../lib/storage.js";
import { createUploadKey, getMyVerification, getVerificationFile, listPendingVerifications, reviewVerification, submitVerification, validateUploadPurpose } from "./service.js";

const reviewSchema = kycAdminActionSchema.extend({ status: z.enum(["VERIFIED", "REJECTED"]) });

function actor(request: FastifyRequest) {
  const auth = requireAuth(request);
  return { actorId: auth.user.id, actorRole: auth.user.role?.name as RoleName | undefined, ip: request.ip, userAgent: request.headers["user-agent"] };
}

function validFile(buffer: Buffer, mime: string) {
  if (mime === "image/jpeg") return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp") return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (mime === "application/pdf") return buffer.toString("ascii", 0, 5) === "%PDF-";
  return false;
}

export async function registerIdentityVerificationRoutes(app: FastifyInstance) {
  await app.register(import("@fastify/multipart"), { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1 } });
  app.post("/uploads", { bodyLimit: 9 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = requireAuth(request);
    let purpose: string | undefined;
    let file: { buffer: Buffer; mimetype: string } | undefined;
    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "purpose") purpose = String(part.value);
      if (part.type === "file") {
        if (file) throw badRequest("VALIDATION_ERROR", "Un seul fichier est accepté.");
        file = { buffer: await part.toBuffer(), mimetype: part.mimetype };
      }
    }
    if (!purpose || !file) throw badRequest("VALIDATION_ERROR", "Document manquant.");
    const allowedPurpose = validateUploadPurpose(purpose);
    if (!validFile(file.buffer, file.mimetype) || (allowedPurpose === "kyc_selfie" && file.mimetype === "application/pdf")) throw badRequest("FILE_TYPE_INVALID", "Format de document invalide.");
    const stored = await putFile(createUploadKey(auth.user.id, allowedPurpose), file.buffer, file.mimetype);
    return sendOk(reply, { key: stored.key, mime: file.mimetype, sizeBytes: stored.size, purpose: allowedPurpose });
  });

  app.get("/kyc/me", async (request, reply) => sendOk(reply, await getMyVerification(requireAuth(request).user.id)));
  app.post("/kyc", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => sendOk(reply, await submitVerification(kycSubmitSchema.parse(request.body), actor(request))));

  app.get("/admin/kyc", async (request, reply) => {
    const auth = await requirePermission(request, "KYC");
    return sendOk(reply, await listPendingVerifications({ actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip, userAgent: request.headers["user-agent"] }));
  });
  app.post("/admin/kyc/:id/review", async (request, reply) => {
    const auth = await requirePermission(request, "KYC");
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest("VALIDATION_ERROR", "Décision ou motif invalide.");
    const { id } = request.params as { id: string };
    return sendOk(reply, await reviewVerification(id, parsed.data.status, parsed.data.reason, { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip, userAgent: request.headers["user-agent"] }));
  });
  app.get("/admin/kyc/:id/files/:kind", async (request, reply) => {
    const auth = await requirePermission(request, "KYC");
    const { id, kind } = request.params as { id: string; kind: string };
    if (!z.enum(["front", "back", "passport", "selfie"]).safeParse(kind).success) throw notFound("Document introuvable.");
    const file = await getVerificationFile(id, kind, { actorId: auth.user.id, actorRole: auth.user.role?.name, ip: request.ip, userAgent: request.headers["user-agent"] });
    reply.header("Content-Type", file.mime).header("Content-Length", file.size).header("Content-Disposition", "inline").header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    return reply.send(file.buffer);
  });
}
