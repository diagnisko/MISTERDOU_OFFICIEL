// Stockage privé chiffré au repos (AES-256-GCM).
// Les fichiers ne sont JAMAIS servis en statique : uniquement via
// GET /api/v1/files/:token (ticket signé + courte durée) après vérification
// des permissions (docs/05). L'objectKey embarque le userId propriétaire
// (`kyc/<userId>/...`, `products/<ownerId>/...`) pour le contrôle d'accès.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../env.js";
import { badRequest } from "./errors.js";

export interface StoredFile {
  buffer: Buffer;
  mime: string;
  size: number;
}

const ENCRYPTION_KEY = createHash("sha256").update(env.STORAGE_MASTER_KEY).digest();
const HMAC_KEY = createHash("sha256").update(env.STORAGE_MASTER_KEY + ":hmac").digest();
const METADATA_HEADER = "md2/1\n"; // préfixe v1 : JSON de métadonnées avant le chiffré

function resolvePath(objectKey: string): string {
  // Key absolue interdite, pas de traversée de répertoire.
  if (!objectKey || path.isAbsolute(objectKey) || objectKey.startsWith("..") || objectKey.includes("\0")) {
    throw badRequest("FILE_ACCESS_DENIED", "Clé objet invalide");
  }
  return path.join(env.STORAGE_DIR, ...objectKey.split("/"));
}

export async function ensureStorageDir(): Promise<void> {
  await fs.mkdir(env.STORAGE_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Écriture / lecture / suppression
// ---------------------------------------------------------------------------

export async function putFile(objectKey: string, buffer: Buffer, mime: string): Promise<{ key: string; size: number }> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const header = Buffer.from(METADATA_HEADER + JSON.stringify({ mime, size: buffer.length }) + "\n", "utf8");
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([header, iv, tag, ciphertext]);

  const target = resolvePath(objectKey);
  await ensureStorageDir();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, blob);
  return { key: objectKey, size: buffer.length };
}

export async function getFile(objectKey: string): Promise<StoredFile> {
  const target = resolvePath(objectKey);
  const blob = await fs.readFile(target).catch(() => {
    throw badRequest("FILE_ACCESS_DENIED", "Fichier introuvable");
  });

  let meta: { mime: string } = { mime: "application/octet-stream" };
  let offset = 0;
  const headerPrefix = Buffer.from(METADATA_HEADER, "utf8");
  if (blob.subarray(0, headerPrefix.length).equals(headerPrefix)) {
    const nl = blob.indexOf(0x0a, headerPrefix.length);
    if (nl !== -1) {
      try {
        meta = { mime: JSON.parse(blob.subarray(headerPrefix.length, nl).toString("utf8")).mime ?? meta.mime };
      } catch {
        /* header illisible → octet-stream */
      }
      offset = nl + 1;
    }
  }

  const iv = blob.subarray(offset, offset + 12);
  const tag = blob.subarray(offset + 12, offset + 28);
  const ciphertext = blob.subarray(offset + 28);
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  const buffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return { buffer, mime: meta.mime, size: buffer.length };
}

export async function deleteFile(objectKey: string): Promise<void> {
  const target = resolvePath(objectKey);
  await fs.rm(target, { force: true });
}

// ---------------------------------------------------------------------------
// Chiffrement de chaînes sensibles (snapshots bancaires, JSON…) — AES-256-GCM
// Format : base64(iv[12] ‖ tag[16] ‖ ciphertext)
// ---------------------------------------------------------------------------

export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptString(enc: string): string {
  const buf = Buffer.from(enc, "base64");
  if (buf.length < 28) throw badRequest("VALIDATION_ERROR", "Donnée chiffrée illisible");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Tickets d'accès signés (court TTL) — GET /api/v1/files/:token
// ---------------------------------------------------------------------------

export interface SignedTicket {
  key: string;
  purpose: string;
  expiresAt: number; // epoch seconds
  signature: string; // hex hmac
}

const SCI = ".";

function sign(message: string): string {
  return createHmac("sha256", HMAC_KEY).update(message).digest("hex");
}

export function createSignedTicket(
  key: string,
  purpose: string,
  ttlSeconds: number = env.FILE_ACCESS_TTL_SECONDS,
): { ticket: string; expiresInSeconds: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const message = `${key}|${purpose}|${expiresAt}`;
  const payload = Buffer.from(message, "utf8").toString("base64url");
  const ticket = `${payload}${SCI}${sign(message)}`;
  return { ticket, expiresInSeconds: ttlSeconds };
}

export function verifySignedTicket(ticket: string): { key: string; purpose: string } | null {
  try {
    const dot = ticket.lastIndexOf(SCI);
    if (dot <= 0) return null;
    const payload = ticket.slice(0, dot);
    const sig = ticket.slice(dot + 1);
    const message = Buffer.from(payload, "base64url").toString("utf8");
    const parts = message.split("|");
    if (parts.length !== 3) return null;
    const [key, purpose, expStr] = parts as [string, string, string];
    const expected = sign(message);
    const ok =
      expected.length === sig.length && timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
    if (!ok) return null;
    const expiresAt = Number(expStr);
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;
    return { key, purpose };
  } catch {
    return null;
  }
}

// Propriétaire d'une clé objet (format `<purposePrefix>/<userId>/...`).
export function keyOwner(key: string): string | null {
  const parts = key.split("/");
  return parts.length >= 2 ? parts[1] ?? null : null;
}