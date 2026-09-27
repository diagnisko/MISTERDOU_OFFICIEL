import { pino } from "pino";
import { env } from "../env.js";

export const isDev = env.NODE_ENV === "development";

// Chemins de redaction (partagés : logger Fastify + logger autonome).
export const REDACT_PATHS = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "token",
  "tokenHash",
  "sid",
  "otpCode",
  "otpCodeHash",
  "credential",
  "*.encryptedPassword",
  "iban",
] as const;

// Logger autonome pour la couche applicative (services, index, scripts).
export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: { paths: REDACT_PATHS as unknown as string[], censor: "[REDACTED]" },
  transport: isDev
    ? {
        target: "pino-pretty",
        options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      }
    : undefined,
});