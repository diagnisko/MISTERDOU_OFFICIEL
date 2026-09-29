// Configuration globale des tests (exécutée AVANT tout fichier de test).
//
// Garde-fous obligatoires (§39) :
//  1. charger apps/api/.env AVANT l'import de src/env.ts (dotenv par défaut
//     lit le .env du CWD, insuffisant si vitest est lancé depuis la racine) ;
//  2. n'accepter QUE la base locale de développement (localhost:5433) —
//     une valeur NEON (base de recette/prod) fait échouer bruyamment la suite.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "..");

loadDotenv({ path: path.join(apiDir, ".env"), override: false, quiet: true });

const databaseUrl = process.env.DATABASE_URL ?? "";

if (databaseUrl.length === 0) {
  throw new Error("[tests] DATABASE_URL absente : apps/api/.env introuvable ou illisible.");
}
if (/neon/i.test(databaseUrl)) {
  throw new Error(
    "[tests] REFUS DE DÉMARRER : DATABASE_URL pointe vers une base distante (NEON détecté). " +
      "Les tests n'utilisent QUE la base locale docker (localhost:5433).",
  );
}
if (!databaseUrl.includes("localhost:5433")) {
  throw new Error(
    "[tests] REFUS DE DÉMARRER : DATABASE_URL doit cibler localhost:5433 (base de dev), reçu : " +
      databaseUrl.replace(/:[^:@/]*@/, ":***@"),
  );
}

// Les tests d'authentification Google verrouillent le gate de configuration :
// le client OAuth est MOCKÉ (google-auth-library), seule la variable doit être
// présente pour traverser `if (!env.GOOGLE_OAUTH_CLIENT_ID)`.
if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "1234567890-test.apps.googleusercontent.com";
}

process.env.NODE_ENV = "test";

// Aucun e-mail réel pendant les tests : l'envoi passe en mode journal seul.
process.env.SMTP_URL = "";
