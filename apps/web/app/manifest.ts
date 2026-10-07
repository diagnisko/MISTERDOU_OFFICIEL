import type { MetadataRoute } from "next";

// Application installable (« Sur l'écran d'accueil ») : nécessaire sur iPhone
// pour recevoir les notifications dans le centre de notifications.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MISTERDOU",
    short_name: "MISTERDOU",
    description: "Comptes eFootball certifiés — achat, vente et suivi.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0605",
    theme_color: "#0b0605",
    lang: "fr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
