import { PrismaClient } from "../generated/client/index.js";

// Client singleton — réutilisé par l'API et les scripts/jobs.
// Ne jamais exposer les champs sensibles via les projections publiques des routes.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Neon met la base en veille après quelques minutes d'inactivité et ferme les
// connexions ouvertes : une connexion gardée en réserve devient morte et la
// requête suivante échoue (« Server has closed the connection »). On recycle
// donc les connexions inactives avant la mise en veille, et on laisse le temps
// au réveil (démarrage à froid) lors d'une nouvelle connexion.
function datasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || !raw.includes(".neon.tech")) return undefined;
  const url = new URL(raw);
  if (!url.searchParams.has("max_idle_connection_lifetime")) url.searchParams.set("max_idle_connection_lifetime", "60");
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "15");
  return url.toString();
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    // Un règlement (paiement → livraison → crédit vendeur) enchaîne une
    // vingtaine de requêtes : 5 s par défaut est trop juste avec une base
    // distante (latence ~100 ms par requête).
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient } from "../generated/client/index.js";
export * from "../generated/client/index.js";