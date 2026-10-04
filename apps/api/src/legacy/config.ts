import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Accès à l'ancien site, lus dans un fichier local hors dépôt (jamais dans le
// code ni dans la discussion). Par défaut C:\ancien-site\migration.env.
// Seules les clés nécessaires à l'étape lancée sont exigées.
// ---------------------------------------------------------------------------

export const DEFAULT_LEGACY_ENV = "C:/ancien-site/migration.env";

const schema = z.object({
  SUPABASE_DB_URL: z.string().startsWith("postgres", "SUPABASE_DB_URL doit commencer par postgresql://").optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  S3_PUBLIC_BUCKET: z.string().min(1).optional(),
  S3_PRIVATE_BUCKET: z.string().min(1).optional(),
});

export type LegacyConfig = z.infer<typeof schema> & { file: string; reportDir: string };

export function loadLegacyConfig(file = process.env.LEGACY_ENV_FILE ?? DEFAULT_LEGACY_ENV): LegacyConfig {
  if (!existsSync(file)) {
    throw new Error(`Fichier d'accès introuvable : ${file}. Créez-le (voir docs/14-reprise-ancien-site.md) ou indiquez LEGACY_ENV_FILE.`);
  }
  const raw = parse(readFileSync(file));
  // Les lignes laissées vides comptent comme absentes.
  const filled = Object.fromEntries(Object.entries(raw).filter(([, v]) => v.trim() !== ""));
  const parsed = schema.safeParse(filled);
  if (!parsed.success) {
    // Le message cite la clé fautive, jamais sa valeur.
    throw new Error(`Fichier d'accès invalide : ${parsed.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join(" ; ")}`);
  }
  return { ...parsed.data, file, reportDir: path.join(path.dirname(file), "rapports") };
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
