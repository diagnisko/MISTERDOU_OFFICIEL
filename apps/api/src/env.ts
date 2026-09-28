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
  // Repli local (développement uniquement) quand R2 n'est pas configuré.
  STORAGE_DIR: z.string().default("./.storage"),

  // Cloudflare R2 (API compatible S3).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  // Bucket PRIVÉ : pièces d'identité (chiffrées AES-256-GCM avant envoi), jamais d'accès public.
  R2_PRIVATE_BUCKET: z.string().optional(),
  // Bucket PUBLIC : images et vidéos des comptes, servies par R2_PUBLIC_BASE_URL.
  R2_PUBLIC_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  MEDIA_MAX_IMAGE_MB: z.coerce.number().positive().max(20).default(8),
  MEDIA_MAX_VIDEO_MB: z.coerce.number().positive().max(200).default(60),

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
  EMAIL_FROM: z.string().default("MISTERDOU <no-reply@misterdou.local>"),

  // Swagger /docs : "true" | "false". Absent → ouvert en dev, FERMÉ en prod
  // (A05 — exposer le plan d'API en production aide l'attaquant).
  SWAGGER_ENABLED: z.enum(["true", "false"]).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

const r2Credentials = (e: z.infer<typeof envSchema>) => Boolean(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY);

const parsed = envSchema
  .superRefine((e, ctx) => {
    if ((e.R2_PRIVATE_BUCKET || e.R2_PUBLIC_BUCKET) && !r2Credentials(e)) {
      ctx.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "identifiants R2 incomplets (compte, clé, secret)" });
    }
    if (e.R2_PUBLIC_BUCKET && !e.R2_PUBLIC_BASE_URL) {
      ctx.addIssue({ code: "custom", path: ["R2_PUBLIC_BASE_URL"], message: "URL publique requise avec R2_PUBLIC_BUCKET" });
    }
    // Les pièces d'identité ne doivent jamais dormir sur le disque d'un serveur de production.
    if (e.NODE_ENV === "production" && !e.R2_PRIVATE_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["R2_PRIVATE_BUCKET"], message: "bucket privé R2 obligatoire en production" });
    }
  })
  .safeParse(process.env);
if (!parsed.success) {
  // N'exporte jamais la valeur des secrets en erreur.
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  // eslint-disable-next-line no-console
  console.error("[env] Variables d'environnement invalides :\n  " + issues.join("\n  "));
  process.exit(1);
}

export const env: AppEnv = parsed.data;