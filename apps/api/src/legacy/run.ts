import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { prisma } from "@misterdou/db";
import { loadLegacyConfig, requireKeys, targetHost } from "./config.js";
import { importSupabaseUsers, readSupabaseUsers, type UserImportLine } from "./supabase-users.js";

// ---------------------------------------------------------------------------
// Reprise des données de l'ancien site.
//   pnpm --filter @misterdou/api legacy:import              → simulation (rien n'est écrit)
//   pnpm --filter @misterdou/api legacy:import -- --apply   → écrit dans la base visée
// Base visée : DATABASE_URL. Par sécurité, seule une base locale est acceptée ;
// la production exige en plus --production (après validation de l'essai local).
// L'ancien site n'est jamais modifié (lecture seule).
// ---------------------------------------------------------------------------

const SOURCE = "supabase";
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

/** a***@gmail.com : assez pour se repérer, sans recopier les adresses à l'écran. */
function mask(email: string | null): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  return `${local!.slice(0, 1)}***@${domain ?? ""}`;
}

async function main() {
  const target = targetHost(process.env.DATABASE_URL);
  if (!target.local && !args.has("--production")) {
    throw new Error(
      `Base visée : ${target.host} (pas une base locale). Lancez d'abord l'essai sur la base de test ` +
        "(DATABASE_URL=postgresql://…@localhost:5433/…), ou ajoutez --production une fois l'essai validé.",
    );
  }
  const config = loadLegacyConfig();
  const { SUPABASE_DB_URL } = requireKeys(config, ["SUPABASE_DB_URL"]);

  console.log(`Ancien site : Supabase (lecture seule) → nouveau site : ${target.host}`);
  console.log(apply ? "MODE ÉCRITURE" : "SIMULATION — rien ne sera écrit (ajoutez --apply pour écrire)");

  const source = new pg.Client({
    connectionString: SUPABASE_DB_URL,
    // Supabase impose TLS ; son certificat n'est pas dans le magasin de Node.
    ssl: targetHost(SUPABASE_DB_URL).local ? undefined : { rejectUnauthorized: false },
  });
  await source.connect();
  let users: UserImportLine[];
  try {
    const legacy = await readSupabaseUsers(source);
    console.log(`Comptes lus sur l'ancien site : ${legacy.length}`);
    users = await importSupabaseUsers(legacy, { apply, source: SOURCE });
  } finally {
    await source.end();
  }

  const count = (o: UserImportLine["outcome"]) => users.filter((l) => l.outcome === o).length;
  console.log("\nComptes clients");
  for (const o of ["créé", "fusionné", "mis à jour", "inchangé", "ignoré"] as const) console.log(`  ${o.padEnd(11)} ${count(o)}`);
  const skipped = users.filter((l) => l.outcome === "ignoré");
  for (const l of skipped.slice(0, 15)) console.log(`  · ${mask(l.email)} — ${l.reason}`);
  if (skipped.length > 15) console.log(`  · … et ${skipped.length - 15} autres (voir le rapport)`);

  // Rapport complet à côté du fichier d'accès (hors dépôt, hors OneDrive).
  mkdirSync(config.reportDir, { recursive: true });
  const file = path.join(config.reportDir, `import-${new Date().toISOString().replace(/[:.]/g, "-")}${apply ? "" : "-simulation"}.json`);
  writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), apply, target: target.host, users }, null, 2));
  console.log(`\nRapport détaillé : ${file}`);
}

main()
  .catch((err) => {
    console.error(`\nArrêt : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
