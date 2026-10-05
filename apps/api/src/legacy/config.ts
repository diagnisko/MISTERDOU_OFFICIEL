import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "dotenv";

// ---------------------------------------------------------------------------
// Accès à l'ancien site, lus dans un fichier local hors dépôt (jamais dans le
// code ni dans la discussion). Le fichier peut être le .env de l'ancien site
// tel quel : ses noms (DATABASE_URL, S3_BUCKET_PUBLIC…) sont reconnus.
// Emplacements cherchés : LEGACY_ENV_FILE, C:\ancien-site, Bureau\ancien-site.
// ---------------------------------------------------------------------------

export const LEGACY_ENV_CANDIDATES = [
  "C:/ancien-site/migration.env",
  path.join(os.homedir(), "Desktop", "ancien-site", "migration.env"),
];

export interface LegacyConfig {
  file: string;
  reportDir: string;
  /** Base de l'ancien site (PostgreSQL), lue en lecture seule. */
  dbUrl?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  publicBucket?: string;
  privateBucket?: string;
}

const first = (env: Record<string, string>, ...keys: string[]) => keys.map((k) => env[k]?.trim()).find((v) => v) || undefined;

export function loadLegacyConfig(file = process.env.LEGACY_ENV_FILE ?? LEGACY_ENV_CANDIDATES.find((f) => existsSync(f))): LegacyConfig {
  if (!file || !existsSync(file)) {
    throw new Error(
      `Fichier d'accès introuvable (${file ?? LEGACY_ENV_CANDIDATES.join(" ou ")}). ` +
        "Voir docs/14-reprise-ancien-site.md, ou indiquez LEGACY_ENV_FILE.",
    );
  }
  const env = parse(readFileSync(file));
  const dbUrl = first(env, "LEGACY_DB_URL", "SUPABASE_DB_URL", "DATABASE_URL");
  if (dbUrl && !/^postgres(ql)?:\/\//.test(dbUrl)) {
    // Le message cite la clé fautive, jamais sa valeur.
    throw new Error("Fichier d'accès invalide : l'adresse de la base doit commencer par postgresql://");
  }
  return {
    file,
    reportDir: path.join(path.dirname(file), "rapports"),
    dbUrl,
    awsRegion: first(env, "AWS_REGION"),
    awsAccessKeyId: first(env, "AWS_ACCESS_KEY_ID"),
    awsSecretAccessKey: first(env, "AWS_SECRET_ACCESS_KEY"),
    publicBucket: first(env, "S3_PUBLIC_BUCKET", "S3_BUCKET_PUBLIC"),
    privateBucket: first(env, "S3_PRIVATE_BUCKET", "S3_BUCKET_PRIVATE"),
  };
}

export function requireKeys<K extends keyof LegacyConfig>(config: LegacyConfig, keys: K[]): Required<Pick<LegacyConfig, K>> {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) throw new Error(`À compléter dans ${config.file} : ${missing.join(", ")}`);
  return config as unknown as Required<Pick<LegacyConfig, K>>;
}

/** Hôte de la base visée, sans identifiants (pour l'affichage et le garde-fou). */
export function targetHost(databaseUrl: string | undefined): { host: string; local: boolean } {
  try {
    const url = new URL(databaseUrl ?? "");
    const host = url.hostname;
    return { host: `${host}:${url.port || "5432"}${url.pathname}`, local: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) };
  } catch {
    return { host: "inconnue", local: false };
  }
}
