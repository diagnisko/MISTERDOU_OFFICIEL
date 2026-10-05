import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

// ---------------------------------------------------------------------------
// Copie de l'ancien site (Vanta) dans le nouveau site.
//   pnpm --filter @misterdou/api legacy:import                   → simulation (rien n'est écrit)
//   pnpm --filter @misterdou/api legacy:import -- --apply        → écrit dans la base visée
//   … -- --apply --bascule   → au changement de domaine : publie les offres encore
//                              en vente et rend les mensualités au nouveau site
// Base visée : DATABASE_URL. Seule une base locale est acceptée sans --production.
// Essai local : jamais d'écriture dans le stockage Cloudflare (R2), fichiers sur
// disque (STORAGE_DIR). L'ancien site n'est jamais modifié (lecture seule).
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const bascule = args.has("--bascule");
const withoutFiles = args.has("--sans-fichiers");

// Environnement réglé AVANT de charger l'API (src/env.ts le lit à l'import).
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: process.env.DOTENV_CONFIG_PATH ?? path.join(apiDir, ".env"), quiet: true });

const { targetHost } = await import("./config.js");
const target = targetHost(process.env.DATABASE_URL);
if (!target.local && !args.has("--production")) {
  console.error(
    `\nArrêt : base visée ${target.host} (pas une base locale). Lancez d'abord l'essai sur la base de test ` +
      "(DATABASE_URL=postgresql://…@localhost:5433/…), ou ajoutez --production une fois l'essai validé.",
  );
  process.exit(1);
}
if (target.local) {
  for (const key of Object.keys(process.env)) if (key.startsWith("R2_")) delete process.env[key];
  // src/env.ts relit le .env : on le pointe vers un fichier absent pour que R2 ne revienne pas.
  process.env.DOTENV_CONFIG_PATH = path.join(apiDir, ".env.essai-local-sans-fichier");
}

const { loadLegacyConfig, requireKeys } = await import("./config.js");
const { prisma } = await import("@misterdou/db");

/** a***@gmail.com : assez pour se repérer, sans recopier les adresses à l'écran. */
function mask(email: string | null): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  return `${local!.slice(0, 1)}***@${domain ?? ""}`;
}

async function main() {
  const legacy = loadLegacyConfig();
  const { dbUrl } = requireKeys(legacy, ["dbUrl"]);
  const pg = (await import("pg")).default;
  const { s3LegacyFiles } = await import("./files.js");
  const { readVanta } = await import("./vanta-read.js");
  const { copyVanta } = await import("./vanta-copy.js");

  // Production : les fichiers et identifiants chiffrés doivent l'être avec la clé
  // de la production, sinon le site ne pourrait plus les relire.
  if (!target.local && apply) await assertProductionKey();

  console.log(`Ancien site (lecture seule) → nouveau site : ${target.host}${target.local ? " (essai local)" : ""}`);
  console.log(apply ? `ÉCRITURE${bascule ? " + BASCULE" : ""}` : "SIMULATION — rien ne sera écrit (ajoutez --apply pour écrire)");

  const files =
    withoutFiles || !apply
      ? null
      : s3LegacyFiles(requireKeys(legacy, ["awsRegion", "awsAccessKeyId", "awsSecretAccessKey", "publicBucket", "privateBucket"]));
  const source = new pg.Client({ connectionString: dbUrl.replace(/sslmode=require/, "sslmode=no-verify"), ssl: { rejectUnauthorized: false } });
  await source.connect();
  let data;
  try {
    data = await readVanta(source);
  } finally {
    await source.end();
  }
  console.log(`Lu sur l'ancien site : ${data.users.length} comptes, ${data.products.length} offres, ${data.plans.length} échéanciers avec apport payé`);

  const report = await copyVanta(data, { apply, files, bascule });

  const tally = <T,>(items: T[], key: (i: T) => string) => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
    return [...counts].map(([k, n]) => `${k} ${n}`).join(" · ");
  };
  console.log(`\nClients : ${tally(report.users, (l) => l.outcome)}`);
  for (const l of report.users.filter((u) => u.outcome === "ignoré").slice(0, 8)) console.log(`  · ${mask(l.email)} — ${l.reason}`);
  for (const step of ["identité", "photo de profil", "offre", "média", "mensualités"] as const) {
    const lines = report.lines.filter((l) => l.step === step);
    if (lines.length === 0) continue;
    console.log(`${step.charAt(0).toUpperCase()}${step.slice(1)} : ${tally(lines, (l) => l.outcome)}`);
    for (const l of lines.filter((x) => x.outcome !== "inchangé" && (x.detail || x.reason)).slice(0, 12)) {
      console.log(`  · ${l.outcome} — ${l.detail ?? l.reason}`);
    }
  }

  // Rapport complet à côté du fichier d'accès (hors dépôt, hors OneDrive).
  mkdirSync(legacy.reportDir, { recursive: true });
  const file = path.join(legacy.reportDir, `copie-${new Date().toISOString().replace(/[:.]/g, "-")}${apply ? "" : "-simulation"}.json`);
  writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), apply, bascule, target: target.host, ...report }, null, 2));
  console.log(`\nRapport détaillé : ${file}`);
}

async function assertProductionKey() {
  const { decryptString } = await import("../lib/storage.js");
  const sample = await prisma.productCredential.findFirst({ select: { encryptedEmail: true } });
  if (!sample) throw new Error("Aucun identifiant chiffré en production pour vérifier la clé de chiffrement : vérification manuelle requise.");
  try {
    decryptString(sample.encryptedEmail);
  } catch {
    throw new Error("La clé de chiffrement locale (STORAGE_MASTER_KEY) n'est pas celle de la production : copie arrêtée.");
  }
}

main()
  .catch((err) => {
    console.error(`\nArrêt : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
