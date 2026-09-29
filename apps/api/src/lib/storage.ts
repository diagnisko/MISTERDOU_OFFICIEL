// Stockage PRIVÉ des pièces d'identité : chiffré AES-256-GCM côté serveur
// avant écriture, puis rangé dans le bucket R2 privé (ou sur disque local en
// développement). Jamais servi en statique : la lecture passe par l'API
// (GET /admin/kyc/:id/files/:kind), qui contrôle la permission, journalise
// l'accès et déchiffre. La clé objet embarque le propriétaire
// (`kyc/<userId>/<purpose>/<uuid>`) pour le contrôle d'accès.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../env.js";
import { badRequest } from "./errors.js";
import { privateBucket, r2 } from "./r2.js";

export interface StoredFile {
  buffer: Buffer;
  mime: string;
  size: number;
}

const ENCRYPTION_KEY = createHash("sha256").update(env.STORAGE_MASTER_KEY).digest();
const METADATA_HEADER = "md2/1\n"; // préfixe v1 : JSON de métadonnées avant le chiffré

function assertKey(objectKey: string) {
  if (!objectKey || path.isAbsolute(objectKey) || objectKey.includes("..") || objectKey.includes("\0")) {
    throw badRequest("FILE_ACCESS_DENIED", "Clé objet invalide");
  }
}

function localPath(objectKey: string): string {
  return path.join(env.STORAGE_DIR, ...objectKey.split("/"));
}

function seal(buffer: Buffer, mime: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const header = Buffer.from(METADATA_HEADER + JSON.stringify({ mime, size: buffer.length }) + "\n", "utf8");
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

function open(blob: Buffer): StoredFile {
  let mime = "application/octet-stream";
  let offset = 0;
  const prefix = Buffer.from(METADATA_HEADER, "utf8");
  if (blob.subarray(0, prefix.length).equals(prefix)) {
    const nl = blob.indexOf(0x0a, prefix.length);
    if (nl !== -1) {
      try {
        mime = JSON.parse(blob.subarray(prefix.length, nl).toString("utf8")).mime ?? mime;
      } catch {
        /* en-tête illisible → octet-stream */
      }
      offset = nl + 1;
    }
  }
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, blob.subarray(offset, offset + 12));
  decipher.setAuthTag(blob.subarray(offset + 12, offset + 28));
  const buffer = Buffer.concat([decipher.update(blob.subarray(offset + 28)), decipher.final()]);
  return { buffer, mime, size: buffer.length };
}

export async function putFile(objectKey: string, buffer: Buffer, mime: string): Promise<{ key: string; size: number }> {
  assertKey(objectKey);
  const blob = seal(buffer, mime);
  const bucket = privateBucket();
  if (bucket) {
    await r2().send(
      new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: blob, ContentType: "application/octet-stream" }),
    );
  } else {
    const target = localPath(objectKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, blob);
  }
  return { key: objectKey, size: buffer.length };
}

export async function getFile(objectKey: string): Promise<StoredFile> {
  assertKey(objectKey);
  const bucket = privateBucket();
  let blob: Buffer;
  if (bucket) {
    try {
      const res = await r2().send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      blob = Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey) throw badRequest("FILE_ACCESS_DENIED", "Fichier introuvable");
      throw err;
    }
  } else {
    blob = await fs.readFile(localPath(objectKey)).catch(() => {
      throw badRequest("FILE_ACCESS_DENIED", "Fichier introuvable");
    });
  }
  return open(blob);
}

export async function deleteFile(objectKey: string): Promise<void> {
  assertKey(objectKey);
  const bucket = privateBucket();
  if (bucket) await r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  else await fs.rm(localPath(objectKey), { force: true });
}

// ---------------------------------------------------------------------------
// Chiffrement de chaînes sensibles (snapshots bancaires, identifiants…) — AES-256-GCM
// Format : base64(iv[12] ‖ tag[16] ‖ ciphertext)
// ---------------------------------------------------------------------------

export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptString(enc: string): string {
  const buf = Buffer.from(enc, "base64");
  if (buf.length < 28) throw badRequest("VALIDATION_ERROR", "Donnée chiffrée illisible");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

// Propriétaire d'une clé objet (format `<purposePrefix>/<userId>/...`).
export function keyOwner(key: string): string | null {
  const parts = key.split("/");
  return parts.length >= 2 ? parts[1] ?? null : null;
}
