import "dotenv/config";
import { env } from "./env.js";
import { buildApp } from "./app.js";
import { prisma } from "@misterdou/db";
import { logger } from "./lib/logger.js";
import { startInstallmentJobs } from "./modules/installments/service.js";
import { startPromotionJobs } from "./modules/promotions/service.js";
import { startSellerPayoutJobs } from "./modules/orders/fulfillment.js";
import { startShiftDigestJob } from "./lib/shift-digest.js";
import { ensureDefaultSettings } from "./modules/settings/service.js";
import { startProofCleanupJob } from "./modules/payments/proofs.js";
import { startContractJobs } from "./modules/seller/contract.js";

async function main() {
  await ensureDefaultSettings();
  const app = await buildApp();

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info(`API MISTERDOU démarrée sur ${env.API_PUBLIC_URL}`);
  // Services facultatifs : visibles au démarrage (et dans /api/v1/health).
  logger.info({ email: Boolean(env.SMTP_URL), google: Boolean(env.GOOGLE_OAUTH_CLIENT_ID) }, "Services facultatifs");
  // Adresse du site utilisée dans les e-mails (première de WEB_ORIGIN).
  logger.info({ site: env.WEB_ORIGIN[0], origines: env.WEB_ORIGIN.length }, "Adresse publique du site");
  logger.info(`Docs OpenAPI : ${env.API_PUBLIC_URL}/docs`);

  // Échéanciers : retards (OVERDUE) + rappels J-3 (idempotents, anti-doublon).
  startInstallmentJobs();

  // Promotions & mises en avant : expiration + synchronisation des statuts.
  startPromotionJobs();

  // Fonds vendeurs : libération automatique après le délai de sécurité ;
  // commandes jamais réglées annulées après le délai configuré.
  startSellerPayoutJobs();
  // Rappel aux managers au début de leur créneau (contrôle en mémoire, sans réveiller la base).
  startShiftDigestJob();

  // Captures de paiement et d'envoi : supprimées une fois devenues inutiles.
  startProofCleanupJob();

  // Contrats revendeur : rappel 7 jours avant la fin, puis retour à la commission.
  startContractJobs();

  // Réglages manquants qui rendent une fonction inopérante en production.
  if (env.NODE_ENV === "production") {
    if (!env.R2_PUBLIC_BUCKET) {
      logger.warn("[config] R2_PUBLIC_BUCKET absent : les photos des offres sont gardées sur le disque du serveur et perdues à son redémarrage.");
    }
    if (!env.SMTP_URL) {
      logger.warn("[config] SMTP_URL absent : aucun e-mail n'est envoyé (mot de passe oublié, alertes de sécurité, paiements).");
    }
  }

  const shutdown = async (signal: string) => {
    logger.info(`Signal ${signal} reçu — arrêt propre…`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Échec au démarrage de l'API");
  process.exit(1);
});