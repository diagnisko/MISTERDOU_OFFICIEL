import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Les moteurs de recherche indexent les pages publiques ; les espaces privés
// (compte, vendeur, console, paiement) restent hors index.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/console", "/account", "/seller", "/checkout", "/messages", "/notifications", "/identity-verification", "/mot-de-passe-oublie", "/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
