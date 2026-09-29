import "dotenv/config";
import { env } from "./env.js";
import { buildApp } from "./app.js";
import { prisma } from "@misterdou/db";
import { logger } from "./lib/logger.js";
import { startPaymentReconciliation } from "./modules/payments/service.js";
import { startInstallmentJobs } from "./modules/installments/service.js";
import { startPromotionJobs } from "./modules/promotions/service.js";
import { startSellerPayoutJobs } from "./modules/orders/fulfillment.js";

async function main() {
  const app = await buildApp();

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info(`API MISTERDOU démarrée sur ${env.API_PUBLIC_URL}`);
  logger.info(`Docs OpenAPI : ${env.API_PUBLIC_URL}/docs`);

  // Réconciliation des paiements (webhook perdu → vérification périodique).
  startPaymentReconciliation();

  // Échéanciers : retards (OVERDUE) + rappels J-3 (idempotents, anti-doublon).
  startInstallmentJobs();

  // Promotions & mises en avant : expiration + synchronisation des statuts.
  startPromotionJobs();

  // Fonds vendeurs : libération automatique après le délai de sécurité.
  startSellerPayoutJobs();

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