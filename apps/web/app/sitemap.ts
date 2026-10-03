import type { MetadataRoute } from "next";
import { fetchCatalogueServer } from "@/lib/lux-catalogue";
import { serverApiFetch } from "@/lib/server-api";
import { siteUrl } from "@/lib/site-url";

// Plan du site pour Google : pages publiques + chaque compte en vente.
export const dynamic = "force-dynamic";

const STATIC_PAGES = ["", "/offres", "/pret-ou-prestation", "/comment-ca-marche", "/a-propos", "/support", "/cgu", "/privacy", "/legal"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PAGES.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === "/offres" || path === "" ? "hourly" : "monthly",
    priority: path === "" ? 1 : path === "/offres" ? 0.9 : 0.5,
  }));

  // Comptes en vente (jusqu'à 10 pages de 48).
  try {
    for (let page = 1; page <= 10; page++) {
      const data = await fetchCatalogueServer(serverApiFetch, { page, perPage: 48 }, true);
      for (const item of data.items) {
        entries.push({ url: `${base}/catalogue/${item.slug}`, lastModified: now, changeFrequency: "daily", priority: 0.8 });
      }
      if (page >= data.meta.totalPages) break;
    }
  } catch {
    // Catalogue indisponible : le plan reste valide avec les pages fixes.
  }
  return entries;
}
