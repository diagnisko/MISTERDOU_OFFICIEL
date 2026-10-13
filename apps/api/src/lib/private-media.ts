// Médias PRIVÉS (vidéos des demandes d'échange, images des messages) : bucket
// R2 privé, jamais servi en public. Envoi direct navigateur → R2 par URL
// présignée, puis contrôle serveur ; lecture par une URL signée de courte durée,
// délivrée seulement après le contrôle d'accès de l'appelant.
// Sans R2 (développement, tests) : même parcours, servi par l'API depuis le disque.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";
import { badRequest } from "./errors.js";
import { MEDIA_TYPES, magicMatches, type MediaKind } from "./media.js";
import { privateBucket, r2 } from "./r2.js";

const UPLOAD_TTL_SECONDS = 600;
const READ_TTL_SECONDS = 600;
const SIGN_KEY = createHmac("sha256", env.STORAGE_MASTER_KEY).update("private-media").digest();
const KEY_RE = /^(exchange|chat)\/[0-9a-z-]{1,40}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$/;

export interface PrivateRules {
  kinds: MediaKind[];
  maxBytes: number;
}

function assertKey(key: string) {
  if (!KEY_RE.test(key)) throw badRequest("FILE_ACCESS_DENIED", "Référence de fichier invalide.");
}

function localPath(key: string): string {
  assertKey(key);
  return path.join(env.STORAGE_DIR, "private-media", ...key.split("/"));
}

function sign(parts: string): string {
  return createHmac("sha256", SIGN_KEY).update(parts).digest("hex");
}

function sameSignature(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPrivateType(mime: string, size: number, rules: PrivateRules) {
  const type = MEDIA_TYPES[mime];
  if (!type || !rules.kinds.includes(type.kind)) {
    throw badRequest(
      "FILE_TYPE_INVALID",
      rules.kinds.length === 1 && rules.kinds[0] === "image" ? "Images seulement : JPEG, PNG ou WebP." : "Vidéo seulement : MP4, WebM ou MOV.",
    );
  }
  if (!Number.isInteger(size) || size <= 0 || size > rules.maxBytes) {
    throw badRequest("FILE_TOO_LARGE", `Taille maximale : ${Math.round(rules.maxBytes / 1024 / 1024)} Mo.`);
  }
  return type;
}

/** Lien d'envoi d'un fichier privé. keyPrefix : « exchange/<userId> » ou « chat/<fil> ». */
export async function createPrivateUpload(keyPrefix: string, mime: string, size: number, rules: PrivateRules) {
  const type = checkPrivateType(mime, size, rules);
  const key = `${keyPrefix}/${randomUUID()}.${type.ext}`;
  assertKey(key);
  const bucket = privateBucket();
  if (bucket) {
    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: size }),
      { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    return { key, uploadUrl, headers: { "Content-Type": mime }, expiresIn: UPLOAD_TTL_SECONDS };
  }
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
  const qs = new URLSearchParams({ mime, size: String(size), exp: String(exp), sig: sign(`put|${key}|${mime}|${size}|${exp}`) });
  return { key, uploadUrl: `/api/v1/private-media/upload/${key}?${qs.toString()}`, headers: { "Content-Type": mime }, expiresIn: UPLOAD_TTL_SECONDS };
}

export function verifyLocalPrivateUpload(key: string, mime: string, size: number, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return sameSignature(sign(`put|${key}|${mime}|${size}|${exp}`), sig);
}

export async function writeLocalPrivate(key: string, body: Buffer) {
  const target = localPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

export function verifyLocalPrivateRead(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return sameSignature(sign(`get|${key}|${exp}`), sig);
}

export async function readLocalPrivate(key: string): Promise<Buffer> {
  return fs.readFile(localPath(key)).catch(() => {
    throw badRequest("FILE_ACCESS_DENIED", "Fichier introuvable.");
  });
}

/** URL de lecture valable 10 minutes (à ne délivrer qu'après le contrôle d'accès). */
export async function privateReadUrl(key: string): Promise<string> {
  assertKey(key);
  const bucket = privateBucket();
  if (bucket) {
    return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: READ_TTL_SECONDS });
  }
  const exp = Math.floor(Date.now() / 1000) + READ_TTL_SECONDS;
  const qs = new URLSearchParams({ exp: String(exp), sig: sign(`get|${key}|${exp}`) });
  return `/api/v1/private-media/file/${key}?${qs.toString()}`;
}

async function openStream(key: string): Promise<Readable> {
  const bucket = privateBucket();
  if (bucket) {
    const res = await r2().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return res.Body as Readable;
  }
  return createReadStream(localPath(key));
}

/** Empreinte SHA-256 d'un fichier privé, lue en flux (jamais chargé entier en mémoire). */
export async function hashPrivate(key: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of await openStream(key)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Contrôle du fichier réellement déposé (taille, octets de tête) ; supprimé s'il ne correspond pas. */
export async function confirmPrivateUpload(key: string, mime: string, rules: PrivateRules): Promise<{ sizeBytes: number }> {
  assertKey(key);
  checkPrivateType(mime, 1, rules);
  const bucket = privateBucket();
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
    const file = await readLocalPrivate(key);
    size = file.length;
    head = file.subarray(0, 32);
  }
  if (size <= 0 || size > rules.maxBytes || !magicMatches(mime, head)) {
    await deletePrivate(key);
    throw badRequest("FILE_TYPE_INVALID", "Le fichier reçu ne correspond pas au format annoncé.");
  }
  return { sizeBytes: size };
}

export async function deletePrivate(key: string): Promise<void> {
  assertKey(key);
  const bucket = privateBucket();
  if (bucket) await r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else await fs.rm(localPath(key), { force: true });
}

export function privateMime(key: string): string {
  const ext = key.split(".").pop() ?? "";
  return Object.entries(MEDIA_TYPES).find(([, t]) => t.ext === ext)?.[0] ?? "application/octet-stream";
}
