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
    requestHandler: { connectionTimeout: 15_000, requestTimeout: 600_000, throwOnRequestTimeout: true }, // grosses vidéos sur connexion lente
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
