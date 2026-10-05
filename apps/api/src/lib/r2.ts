import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../env.js";

// Client Cloudflare R2 (API S3). Instancié à la demande : sans configuration,
// les appelants retombent sur le stockage local de développement.

let client: S3Client | null = null;

export function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
      // Connexion muette > 2 min = échec, puis nouvel essai (5 au total) : un
      // transfert ne reste jamais figé indéfiniment sur une connexion lente.
      requestHandler: { connectionTimeout: 15_000, requestTimeout: 120_000, throwOnRequestTimeout: true },
      maxAttempts: 5,
    });
  }
  return client;
}

export const privateBucket = (): string | null => env.R2_PRIVATE_BUCKET ?? null;
export const publicBucket = (): string | null => env.R2_PUBLIC_BUCKET ?? null;
