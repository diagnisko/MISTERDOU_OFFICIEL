import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Fichiers de l'ancien site sur AWS S3 (lecture seule) : bucket public
// (photos, vidéos, avatars) et bucket privé (pièces d'identité).
// Interface simple pour que les essais puissent fournir de faux fichiers.
// ---------------------------------------------------------------------------

export interface LegacyFile {
  buffer: Buffer;
  /** Type annoncé par S3 (peut manquer : on se rabat alors sur l'extension). */
  mime: string | null;
}

export interface LegacyFiles {
  readPublic(urlOrKey: string): Promise<LegacyFile>;
  readPrivate(key: string): Promise<LegacyFile>;
}

/** Clé objet à partir de l'URL publique S3 (https://bucket.s3.region.amazonaws.com/<clé>). */
export function keyFromUrl(urlOrKey: string): string {
  if (!/^https?:\/\//i.test(urlOrKey)) return urlOrKey.replace(/^\/+/, "");
  return decodeURIComponent(new URL(urlOrKey).pathname.replace(/^\/+/, ""));
}

export function s3LegacyFiles(cfg: {
  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
}): LegacyFiles {
  const client = new S3Client({
    region: cfg.awsRegion,
    credentials: { accessKeyId: cfg.awsAccessKeyId, secretAccessKey: cfg.awsSecretAccessKey },
    requestHandler: { connectionTimeout: 15_000, requestTimeout: 120_000 },
    maxAttempts: 5,
  });
  const read = async (bucket: string, key: string): Promise<LegacyFile> => {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`Fichier vide sur l'ancien site : ${key}`);
    return { buffer: Buffer.from(await res.Body.transformToByteArray()), mime: res.ContentType ?? null };
  };
  return {
    readPublic: (urlOrKey) => read(cfg.publicBucket, keyFromUrl(urlOrKey)),
    readPrivate: (key) => read(cfg.privateBucket, keyFromUrl(key)),
  };
}

/**
 * Vidéo .mov (iPhone) → .mp4 lisible partout, avec ffmpeg : d'abord sans
 * réencodage (rapide, sans perte), sinon réencodée en H.264/AAC.
 * null si ffmpeg est absent ou si la vidéo est illisible.
 */
export async function movToMp4(input: Buffer): Promise<Buffer | null> {
  const run = promisify(execFile);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reprise-video-"));
  const src = path.join(dir, `${randomUUID()}.mov`);
  const out = path.join(dir, `${randomUUID()}.mp4`);
  try {
    await fs.writeFile(src, input);
    const attempts = [
      ["-c", "copy"],
      ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac"],
    ];
    for (const codec of attempts) {
      try {
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, ...codec, "-movflags", "+faststart", out], { timeout: 300_000 });
        return await fs.readFile(out);
      } catch {
        // essai suivant
      }
    }
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
