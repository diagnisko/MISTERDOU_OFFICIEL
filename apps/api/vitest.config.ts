import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    // Une seule suite à la fois : les tests partagent une base locale commune
    // (jobs globaux, notifications d'administration) — l'exécution séquentielle
    // garantit un nettoyage déterministe entre les fichiers.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // Hors mesure : points d'entrée exécutés uniquement au démarrage (§39
      // n'exclut que src/index.ts ; admin-bootstrap est un script admin).
      exclude: ["src/index.ts", "src/admin-bootstrap.ts", "src/types/**/*.ts"],
    },
  },
});
