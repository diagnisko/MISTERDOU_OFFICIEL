import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_ORIGIN: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.split(",").map((o) => o.trim())),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET doit faire au moins 32 caractères"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().max(60 * 60 * 4).default(60 * 60 * 2),
  ADMIN_SETUP_SESSION_TTL_SECONDS: z.coerce.number().int().positive().max(15 * 60).default(10 * 60),
  STORAGE_MASTER_KEY: z.string().min(32, "STORAGE_MASTER_KEY doit faire au moins 32 caractères"),
  STORAGE_DIR: z.string().default("./.storage"),
  FILE_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  DATABASE_URL: z.string().min(1, "DATABASE_URL requise"),

  PAYTECH_API_KEY: z.string().optional(),
  PAYTECH_API_SECRET: z.string().optional(),
  PAYTECH_WEBHOOK_SECRET: z.string().optional(),
  PAYTECH_SANDBOX: z.coerce.boolean().default(true),
  PAYTECH_BASE_URL: z.string().url().default("https://paytech.sn"),
  PAYTECH_CALLBACK_URL: z.string().url().optional(),
  PAYTECH_WEBHOOK_PATH: z.string().default("/api/v1/webhooks/paytech"),
  // Allowlist d'IPs webhook (CSV, optionnelle) — vide = contrôle d'IP désactivé.
  PAYTECH_WEBHOOK_IPS: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  SMTP_URL: z.string().optional(),
  SMS_PROVIDER: z.string().default("log"),
  SMS_API_KEY: z.string().optional(),

  // Swagger /docs : "true" | "false". Absent → ouvert en dev, FERMÉ en prod
  // (A05 — exposer le plan d'API en production aide l'attaquant).
  SWAGGER_ENABLED: z.enum(["true", "false"]).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // N'exporte jamais la valeur des secrets en erreur.
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  // eslint-disable-next-line no-console
  console.error("[env] Variables d'environnement invalides :\n  " + issues.join("\n  "));
  process.exit(1);
}

export const env: AppEnv = parsed.data;