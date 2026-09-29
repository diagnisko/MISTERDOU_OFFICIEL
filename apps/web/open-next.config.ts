import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Réglages par défaut : pas de cache incrémental partagé (le site interroge
// l'API à chaque rendu serveur ; les pages ne sont pas générées à l'avance).
export default defineCloudflareConfig({});
