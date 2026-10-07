import { Container } from "@cloudflare/containers";
import { env as workerEnv } from "cloudflare:workers";

// ---------------------------------------------------------------------------
// API MISTERDOU sur Cloudflare : ce Worker lance l'API (image apps/api/Dockerfile)
// dans un Container et lui transmet les requêtes. Il n'a pas d'adresse publique :
// le site (Worker misterdou-officiel) l'appelle par une liaison de service, pour
// /api/* comme pour ses rendus serveur.
// ---------------------------------------------------------------------------

interface Env {
  API: DurableObjectNamespace<ApiContainer>;
}

// Variables et secrets transmis au serveur (réglés dans Cloudflare, jamais dans le dépôt).
const FORWARDED = [
  "NODE_ENV",
  "API_PUBLIC_URL",
  "WEB_ORIGIN",
  "DATABASE_URL",
  "COOKIE_SECRET",
  "STORAGE_MASTER_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PRIVATE_BUCKET",
  "R2_PUBLIC_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "SMTP_URL",
  "EMAIL_FROM",
] as const;

function containerEnv(): Record<string, string> {
  const source = workerEnv as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of FORWARDED) {
    const value = source[key];
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

export class ApiContainer extends Container {
  defaultPort = 4000;
  // Les tâches de fond (échéances, forfaits, fonds vendeurs) tournent dans le
  // serveur : on le garde éveillé, le déclencheur périodique le relance au besoin.
  sleepAfter = "3h";
  envVars = containerEnv();
}

// Doit correspondre au second déclencheur de wrangler.jsonc.
const KEEP_DB_AWAKE_CRON = "*/4 12-19 * * *";

// Une seule instance : les tâches de fond ne doivent jamais tourner en double.
function api(env: Env) {
  return env.API.get(env.API.idFromName("misterdou-api"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Adresse réelle du visiteur pour les limites de débit et le journal.
    const headers = new Headers(request.headers);
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-forwarded-for", ip);
    return api(env).fetch(new Request(request, { headers }));
  },

  // Toutes les 30 min : garde le serveur allumé pour les tâches de fond — /healthz
  // ne touche pas à la base, qui peut dormir (forfait Neon gratuit préservé).
  // Toutes les 4 min aux heures de pointe : /health interroge la base, qui reste
  // éveillée (pas d'attente de réveil pour les visiteurs). Voir wrangler.jsonc.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const path = controller.cron === KEEP_DB_AWAKE_CRON ? "/api/v1/health" : "/api/v1/healthz";
    ctx.waitUntil(api(env).fetch(new Request(`https://api.internal${path}`)));
  },
} satisfies ExportedHandler<Env>;
