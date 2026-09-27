import { PrismaClient } from "../generated/client/index.js";

// Client singleton — réutilisé par l'API et les scripts/jobs.
// Ne jamais exposer les champs sensibles via les projections publiques des routes.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient } from "../generated/client/index.js";
export * from "../generated/client/index.js";