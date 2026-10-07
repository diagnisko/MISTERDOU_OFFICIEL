import path from "node:path";
import type { NextConfig } from "next";

const API_INTERNAL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  transpilePackages: ["@misterdou/shared"],
  devIndicators: false,
  // Perf : pas d’en-tête X-Powered-By, compression HTTP activée (défaut rendu
  // explicite), source maps navigateur désactivées en production.
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  // Cloudflare Workers : pas de service d'optimisation d'images (les deux
  // visuels concernés sont déjà dimensionnés).
  images: { unoptimized: true },
  async rewrites() {
    // Le navigateur appelle /api/* en same-origin → l'API est en proxy (pas de CORS, cookies OK)
    return [{ source: "/api/:path*", destination: `${API_INTERNAL}/api/:path*` }];
  },
  async headers() {
    return [
      // Hash content-addressé : le navigateur peut garder les assets Next en cache
      // immuablement (défaut de `next start`, ici explicite pour tout hébergeur).
      // Production seulement : en développement les noms ne changent pas et le
      // navigateur garderait d'anciennes versions des pages.
      ...(process.env.NODE_ENV === "production"
        ? [{ source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }]
        : []),
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;