// ---------------------------------------------------------------
// Catalogue public (Phase 3) — données GET /api/catalogue.
// Kabbalén't rien en dur : chaque valeur provient de l'API.
//
// - `fetchCatalogue`            → client Next (proxy /api via rewrite),
//   avec cache court (20 s, aligné Cache-Control serveur).
// - `fetchCatalogueServer`      → SSR : appel direct à l'API interne
//   (lib/server-api : liaison Cloudflare ou API_INTERNAL_URL), cache serveur court.
// - `fetchCatalogueDetail(Server)` → fiche produit (client / SSR).
// ---------------------------------------------------------------

import type { LuxCardData, LuxPaymentMode, LuxSchedule } from "./lux";

export type CatalogueSort = "newest" | "priceAsc" | "priceDesc" | "power" | "powerAsc";

export interface CatalogueMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  sort: CatalogueSort;
  q: string | null;
  division: string | null;
  paymentMode: LuxPaymentMode | null;
  divisions: string[];
}

export interface CatalogueItem extends LuxCardData {
  price: number;
  schedule: LuxSchedule | null;
  avgRating: number | null;
}

export interface CatalogueData {
  items: CatalogueItem[];
  meta: CatalogueMeta;
}

interface CatalogueEnvelope {
  ok: boolean;
  data?: CatalogueData["items"];
  meta?: CatalogueMeta;
  error?: { message?: string };
}

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; data: CatalogueData }>();

export interface CatalogueParams {
  division?: string;
  sort?: CatalogueSort;
  /** Recherche : nom de l'offre, ou un nombre = puissance minimale. */
  q?: string;
  /** Offres d'un seul vendeur (page profil). */
  seller?: string;
  page?: number;
  perPage?: number;
  /** ONE_TIME = tout le catalogue, INSTALLMENTS = « prêt ou prestation » seul. */
  paymentMode?: LuxPaymentMode;
}


function buildQuery(params: CatalogueParams = {}): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.seller) qs.set("seller", params.seller);
  if (params.division) qs.set("division", params.division);
  if (params.sort) qs.set("sort", params.sort);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  if (params.perPage) qs.set("perPage", String(params.perPage));
  if (params.paymentMode) qs.set("paymentMode", params.paymentMode);
  return qs.toString();
}

async function decodeCatalogue(res: Response, source: string, { cacheKey, store = true }: { cacheKey: string; store?: boolean }): Promise<CatalogueData> {
  let payload: CatalogueEnvelope;
  try {
    payload = (await res.json()) as CatalogueEnvelope;
  } catch {
    throw new Error("catalogue : réponse illisible");
  }
  if (!payload.ok || !payload.data || !payload.meta) {
    throw new Error(payload.error?.message ?? "catalogue : échec");
  }
  const data: CatalogueData = { items: payload.data, meta: payload.meta };
  if (store) {
    if (cache.size > 24) cache.clear();
    cache.set(cacheKey, { at: Date.now(), data });
  }
  return data;
}

/** Grille liste — rendu client (proxy /api/catalogue via rewrite Next). */
export async function fetchCatalogue(params: CatalogueParams = {}, force = false): Promise<CatalogueData> {
  const key = buildQuery(params);
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const res = await fetch(`/api/catalogue?${key}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return decodeCatalogue(res, "catalogue:list", { cacheKey: key });
}

/** Grille liste — Server Component (SSR), URL absolue API interne. */
// `fetchApi` : lib/server-api (fourni par l'appelant serveur, ce module étant aussi chargé côté navigateur).
export async function fetchCatalogueServer(
  fetchApi: (path: string, init?: RequestInit) => Promise<Response>,
  params: CatalogueParams = {},
  force = false,
): Promise<CatalogueData> {
  const key = buildQuery(params);
  const hit = cache.get(`srv:${key}`);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const res = await fetchApi(`/api/catalogue?${key}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return decodeCatalogue(res, "catalogue:ssr", { cacheKey: `srv:${key}` });
}

// ---------------------------------------------------------------
// Fiche produit détaillée.
// ---------------------------------------------------------------

/** Qui vend : MISTERDOU, ou un vendeur partenaire (code public, jamais son nom). */
export type CatalogueSeller =
  | { kind: "MISTERDOU"; sales: number }
  | { kind: "SELLER"; id: string; code: string; sales: number; since: string | null };

export interface CatalogueDetail {
  id: string;
  slug: string;
  title: string;
  division: string;
  teamPower: number;
  coins: number;
  basePrice: number;
  promoPrice: number | null;
  price: number;
  paymentMode: "ONE_TIME" | "INSTALLMENTS";
  installmentMonths: number | null;
  installmentDownPayment: number | null;
  canSplit: boolean;
  schedule: LuxSchedule | null;
  isFeatured: boolean;
  publishedAt: string | null;
  description: string;
  extraInfo: string | null;
  /** Note du vendeur (ou de MISTERDOU pour ses propres offres). */
  avgRating: number | null;
  reviewCount: number;
  seller?: CatalogueSeller;
  /** Captures et vidéos publiques (bucket public), couverture en premier. */
  media?: Array<{ id: string; url: string; kind: "image" | "video"; mimeType: string }>;
}

interface DetailEnvelope {
  ok: boolean;
  data?: CatalogueDetail;
  error?: { message?: string };
}

const detailCache = new Map<string, { at: number; data: CatalogueDetail }>();

async function decodeDetail(res: Response, source: string, { slug, store = true }: { slug: string; store?: boolean }): Promise<CatalogueDetail> {
  let payload: DetailEnvelope;
  try {
    payload = (await res.json()) as DetailEnvelope;
  } catch {
    throw new Error("fiche : réponse illisible");
  }
  if (!payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "fiche : introuvable");
  }
  if (store) {
    if (detailCache.size > 48) detailCache.clear();
    detailCache.set(slug, { at: Date.now(), data: payload.data });
  }
  return payload.data;
}

/** Fiche produit — rendu client (proxy /api/catalogue/:slug). */
export async function fetchCatalogueDetail(slug: string, force = false): Promise<CatalogueDetail> {
  const hit = detailCache.get(slug);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const res = await fetch(`/api/catalogue/${encodeURIComponent(slug)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return decodeDetail(res, "catalogue:detail", { slug });
}

