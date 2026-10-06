// Médias PUBLICS des comptes (images, vidéos) — bucket R2 public.
// Envoi direct navigateur → R2 par URL présignée (type et taille signés),
// puis vérification serveur des octets de tête avant enregistrement.
// Sans R2 (développement) : même parcours, servi par l'API depuis le disque.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";
import { badRequest } from "./errors.js";
import { publicBucket, r2 } from "./r2.js";

export type MediaKind = "image" | "video";

export const MEDIA_TYPES: Record<string, { kind: MediaKind; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/webm": { kind: "video", ext: "webm" },
  // MOV d'iPhone : normalement converti en MP4 par le navigateur avant l'envoi
  // (lib/media-prepare côté site) ; accepté tel quel si le navigateur ne sait pas convertir.
  "video/quicktime": { kind: "video", ext: "mov" },
};

export const MEDIA_LIMITS = { image: 10, video: 2 } as const;
const UPLOAD_TTL_SECONDS = 600;
const LOCAL_URL_KEY = createHmac("sha256", env.STORAGE_MASTER_KEY).update("media-local-upload").digest();

export function mediaKind(mime: string): MediaKind | null {
  return MEDIA_TYPES[mime]?.kind ?? null;
}

export function maxBytes(kind: MediaKind): number {
  return Math.round((kind === "image" ? env.MEDIA_MAX_IMAGE_MB : env.MEDIA_MAX_VIDEO_MB) * 1024 * 1024);
}

function localPath(key: string): string {
  if (!/^(products|avatars)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$/.test(key)) {
    throw badRequest("FILE_ACCESS_DENIED", "Clé média invalide");
  }
  return path.join(env.STORAGE_DIR, "public", ...key.split("/"));
}

export function publicUrl(key: string): string {
  const base = env.R2_PUBLIC_BASE_URL;
  return publicBucket() && base ? `${base.replace(/\/$/, "")}/${key}` : `/api/v1/media/${key}`;
}

// --- Signature des envois locaux (développement) ---------------------------

function localSignature(key: string, mime: string, size: number, exp: number) {
  return createHmac("sha256", LOCAL_URL_KEY).update(`${key}|${mime}|${size}|${exp}`).digest("hex");
}

export function verifyLocalUpload(key: string, mime: string, size: number, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(localSignature(key, mime, size, exp), "utf8");
  const received = Buffer.from(sig, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function writeLocalMedia(key: string, body: Buffer) {
  const target = localPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

/** Dépose un média public déjà contrôlé (reprise de l'ancien site) : R2, ou disque en local. */
export async function putPublicMedia(key: string, body: Buffer, mime: string): Promise<void> {
  const bucket = publicBucket();
  if (bucket) {
    await r2().send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mime, CacheControl: "public, max-age=31536000, immutable" }),
    );
    return;
  }
  await writeLocalMedia(key, body);
}

export async function readLocalMedia(key: string): Promise<Buffer> {
  return fs.readFile(localPath(key)).catch(() => {
    throw badRequest("FILE_ACCESS_DENIED", "Média introuvable");
  });
}

// --- Parcours d'envoi ------------------------------------------------------

export interface UploadRules {
  kinds?: MediaKind[];
  maxBytes?: number;
}

function limitFor(kind: MediaKind, rules?: UploadRules) {
  return rules?.maxBytes ?? maxBytes(kind);
}

// keyPrefix : "products/<productId>" ou "avatars/<userId>".
export async function createUpload(keyPrefix: string, mime: string, size: number, rules?: UploadRules) {
  const type = MEDIA_TYPES[mime];
  if (!type || (rules?.kinds && !rules.kinds.includes(type.kind))) {
    const imagesOnly = rules?.kinds?.length === 1 && rules.kinds[0] === "image";
    throw badRequest("FILE_TYPE_INVALID", imagesOnly ? "Formats acceptés : JPEG, PNG, WebP." : "Formats acceptés : JPEG, PNG, WebP, MP4, WebM, MOV.");
  }
  const limit = limitFor(type.kind, rules);
  if (!Number.isInteger(size) || size <= 0 || size > limit) {
    throw badRequest(
      "FILE_TOO_LARGE",
      `Taille maximale : ${Math.round(limit / 1024 / 1024)} Mo pour une ${type.kind === "image" ? "image" : "vidéo"}.`,
    );
  }
  const key = `${keyPrefix}/${randomUUID()}.${type.ext}`;
  const bucket = publicBucket();
  if (bucket) {
    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: mime,
        ContentLength: size,
        CacheControl: "public, max-age=31536000, immutable",
      }),
      { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    return { key, uploadUrl, headers: { "Content-Type": mime }, expiresIn: UPLOAD_TTL_SECONDS };
  }
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
  const qs = new URLSearchParams({ mime, size: String(size), exp: String(exp), sig: localSignature(key, mime, size, exp) });
  return { key, uploadUrl: `/api/v1/media/upload/${key}?${qs.toString()}`, headers: { "Content-Type": mime }, expiresIn: UPLOAD_TTL_SECONDS };
}

function magicMatches(mime: string, head: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/webp":
      return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
    case "video/mp4":
      return head.toString("ascii", 4, 8) === "ftyp";
    case "video/webm":
      return head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case "video/quicktime":
      // QuickTime : première boîte « ftyp » (iPhone), ou une boîte de tête classique.
      return ["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(head.toString("ascii", 4, 8));
    default:
      return false;
  }
}

// Vérifie l'objet réellement déposé ; le supprime s'il ne correspond pas.
export async function confirmUpload(key: string, mime: string, rules?: UploadRules): Promise<{ sizeBytes: number }> {
  const type = MEDIA_TYPES[mime];
  if (!type) throw badRequest("FILE_TYPE_INVALID", "Format non pris en charge.");
  const bucket = publicBucket();
  let size: number;
  let head: Buffer;
  if (bucket) {
    const meta = await r2()
      .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => {
        throw badRequest("FILE_ACCESS_DENIED", "Fichier non reçu : relancez l’envoi.");
      });
    size = meta.ContentLength ?? 0;
    const part = await r2().send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-31" }));
    head = Buffer.from(await part.Body!.transformToByteArray());
  } else {
    const file = await readLocalMedia(key);
    size = file.length;
    head = file.subarray(0, 32);
  }
  if (size <= 0 || size > limitFor(type.kind, rules) || !magicMatches(mime, head)) {
    await deleteMedia(key);
    throw badRequest("FILE_TYPE_INVALID", "Le fichier reçu ne correspond pas au format annoncé.");
  }
  return { sizeBytes: size };
}

export async function deleteMedia(key: string): Promise<void> {
  const bucket = publicBucket();
  if (bucket) await r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else await fs.rm(localPath(key), { force: true });
}
