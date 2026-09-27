import { randomUUID } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { RoleName, VerificationStatus } from "@misterdou/db";
import { kycSubmitSchema } from "@misterdou/shared";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { getFile, keyOwner } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser, notifyActiveAdmins } from "../../lib/notify.js";

export type KycActor = { actorId: string; actorRole?: RoleName; ip?: string; userAgent?: string };

export async function assertVerifiedPhone(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true } });
  if (!user?.phoneNumber) throw badRequest("PHONE_NOT_VERIFIED", "Ajoutez et vérifiez votre numéro de téléphone.");
  const verification = await prisma.phoneVerification.findFirst({
    where: { userId, phoneNumber: user.phoneNumber, status: "VERIFIED" },
    select: { id: true },
  });
  if (!verification) throw badRequest("PHONE_NOT_VERIFIED", "Vérifiez votre numéro de téléphone avant de continuer.");
}

type VerificationRecord = {
  id: string;
  status: VerificationStatus;
  documentType: string;
  firstName: string;
  lastName: string;
  birthDate: Date | null;
  country: string | null;
  city: string | null;
  address: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  histories?: Array<{
    previousStatus: VerificationStatus | null;
    newStatus: VerificationStatus;
    reason: string | null;
    createdAt: Date;
  }>;
};

function publicRecord(record: VerificationRecord) {
  return {
    id: record.id,
    status: record.status,
    documentType: record.documentType,
    firstName: record.firstName,
    lastName: record.lastName,
    birthDate: record.birthDate?.toISOString().slice(0, 10) ?? null,
    country: record.country,
    city: record.city,
    address: record.address,
    submittedAt: record.submittedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    rejectionReason: record.rejectionReason,
    history: record.histories?.map((entry) => ({
      previousStatus: entry.previousStatus,
      status: entry.newStatus,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    })) ?? [],
  };
}

async function assertOwnedFile(key: string, userId: string, purpose: string) {
  if (keyOwner(key) !== userId || !key.startsWith(`kyc/${userId}/${purpose}/`)) {
    throw forbidden("Le document ne correspond pas à votre compte.");
  }
  await getFile(key);
}

export async function submitVerification(input: unknown, actor: KycActor) {
  const data = kycSubmitSchema.parse(input);
  await assertVerifiedPhone(actor.actorId);
  if (data.documentType === "NATIONAL_ID") {
    await assertOwnedFile(data.documentFrontKey, actor.actorId, "kyc_front");
    await assertOwnedFile(data.documentBackKey!, actor.actorId, "kyc_back");
  } else {
    await assertOwnedFile(data.passportKey ?? data.documentFrontKey, actor.actorId, "kyc_passport");
  }
  await assertOwnedFile(data.selfieKey, actor.actorId, "kyc_selfie");

  const record = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.actorId} FOR UPDATE`;
    const latest = await tx.identityVerification.findFirst({
      where: { userId: actor.actorId }, orderBy: { submittedAt: "desc" }, select: { status: true },
    });
    if (latest?.status === "VERIFIED") throw conflict("KYC_ALREADY_VERIFIED", "Votre identité est déjà vérifiée.");
    if (latest && ["PENDING", "IN_PROGRESS"].includes(latest.status)) throw conflict("KYC_ALREADY_PENDING", "Votre dossier est déjà en cours de vérification.");
    const location = data.location ? await tx.location.create({
      data: {
        id: randomUUID(),
        userId: actor.actorId,
        latitude: data.location.latitude,
        longitude: data.location.longitude,
        approximateAddress: data.location.approximateAddress,
        consentGivenAt: new Date(),
        capturedAt: new Date(),
        captureMethod: "BROWSER_GEOLOCATION",
      },
      select: { id: true },
    }) : null;
    const created = await tx.identityVerification.create({
      data: {
        userId: actor.actorId,
        documentType: data.documentType,
        documentFrontKey: data.documentFrontKey,
        documentBackKey: data.documentType === "NATIONAL_ID" ? data.documentBackKey : null,
        passportKey: data.documentType === "PASSPORT" ? (data.passportKey ?? data.documentFrontKey) : null,
        selfieKey: data.selfieKey,
        firstName: data.firstName,
        lastName: data.lastName,
        birthDate: data.birthDate ? new Date(`${data.birthDate}T00:00:00.000Z`) : null,
        country: data.country ?? "",
        city: data.city ?? null,
        address: data.address ?? null,
        locationId: location?.id,
      },
    });
    await tx.user.update({ where: { id: actor.actorId }, data: { kycStatus: "PENDING", verifiedAt: null } });
    await tx.verificationHistory.create({ data: { verificationId: created.id, changedBy: actor.actorId, newStatus: "PENDING", reason: "Dossier soumis" } });
    return created;
  });
  await logAudit({ actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip, userAgent: actor.userAgent, action: "KYC_SUBMITTED", resourceType: "IdentityVerification", resourceId: record.id });
  await notifyActiveAdmins("ADMIN_ALERT", {
    title: "Nouvelle vérification",
    message: "Un dossier de vérification d'identité attend une revue.",
    actionUrl: "/admin/kyc",
    priority: "NORMAL",
  });
  return publicRecord(record);
}

export async function getMyVerification(userId: string) {
  const records = await prisma.identityVerification.findMany({ where: { userId }, orderBy: { submittedAt: "desc" }, take: 10, include: { histories: { orderBy: { createdAt: "asc" } } } });
  return { status: records[0]?.status ?? "NOT_SUBMITTED", records: records.map(publicRecord) };
}

export async function listPendingVerifications(actor: KycActor) {
  const records = await prisma.identityVerification.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } }, orderBy: { submittedAt: "asc" }, take: 100,
    include: { user: { select: { id: true, email: true, phoneNumber: true } }, histories: { orderBy: { createdAt: "asc" } } },
  });
  await logAudit({ actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip, action: "KYC_QUEUE_VIEWED", resourceType: "IdentityVerification", metadata: { count: records.length } });
  return records.map((record) => ({ ...publicRecord(record), user: record.user }));
}

export async function reviewVerification(id: string, status: "VERIFIED" | "REJECTED", reason: string, actor: KycActor) {
  const record = await prisma.identityVerification.findUnique({ where: { id } });
  if (!record) throw notFound("Dossier introuvable.");
  if (!["PENDING", "IN_PROGRESS"].includes(record.status)) throw conflict("INVALID_STATE", "Ce dossier a déjà été traité.");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.identityVerification.updateMany({
      where: { id, status: { in: ["PENDING", "IN_PROGRESS"] } },
      data: { status, reviewedAt: new Date(), reviewedById: actor.actorId, rejectionReason: status === "VERIFIED" ? null : reason },
    });
    if (updated.count !== 1) throw conflict("INVALID_STATE", "Ce dossier a déjà été traité.");
    await tx.user.update({
      where: { id: record.userId },
      data: { kycStatus: status, verifiedAt: status === "VERIFIED" ? new Date() : null },
    });
    await tx.verificationHistory.create({ data: { verificationId: id, changedBy: actor.actorId, previousStatus: record.status, newStatus: status, reason } });
  });
  await logAudit({ actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip, userAgent: actor.userAgent, action: `KYC_${status}`, resourceType: "IdentityVerification", resourceId: id, metadata: { userId: record.userId, reason }, severity: "WARNING" });
  await notifyUser(record.userId, status === "VERIFIED" ? "KYC_VERIFIED" : "KYC_REJECTED", { title: status === "VERIFIED" ? "Identité vérifiée" : "Action requise sur votre dossier", message: status === "VERIFIED" ? "Votre identité est vérifiée." : reason, actionUrl: "/identity-verification", priority: "CRITICAL" });
  return { id, status };
}

export async function getVerificationFile(id: string, kind: string, actor: KycActor) {
  const record = await prisma.identityVerification.findUnique({ where: { id }, select: { userId: true, documentFrontKey: true, documentBackKey: true, passportKey: true, selfieKey: true } });
  if (!record) throw notFound("Dossier introuvable.");
  const key = ({ front: record.documentFrontKey, back: record.documentBackKey, passport: record.passportKey, selfie: record.selfieKey } as Record<string, string | null>)[kind];
  if (!key) throw notFound("Document introuvable.");
  const file = await getFile(key);
  await logAudit({ actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip, userAgent: actor.userAgent, action: "SENSITIVE_DATA_ACCESS", resourceType: "IdentityVerification", resourceId: id, metadata: { ownerId: record.userId, document: kind }, severity: "WARNING" });
  return file;
}

export function createUploadKey(userId: string, purpose: string) { return `kyc/${userId}/${purpose}/${randomUUID()}`; }
export function validateUploadPurpose(purpose: string) {
  if (!["kyc_front", "kyc_back", "kyc_passport", "kyc_selfie"].includes(purpose)) throw badRequest("VALIDATION_ERROR", "Type de document non autorisé.");
  return purpose;
}
