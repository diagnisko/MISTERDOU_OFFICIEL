// ---------------------------------------------------------------
// Landing — données serveur uniques (GET /api/seed).
// Cache client 30 s (réflection du Cache-Control serveur).
// AUCUNE valeur métier n'est figée ici : tout vient de la BDD.
// ---------------------------------------------------------------

export type LuxPaymentMode = "ONE_TIME" | "INSTALLMENTS";

/**
 * Échéancier tel que calculé par l'API (mêmes arrondis que la commande).
 * On ne le recalcule jamais côté client : la fiche doit annoncer exactement
 * ce qui sera débité.
 */
export interface LuxSchedule {
  months: number;
  downPayment: number;
  monthlyAmount: number;
  lastMonthAmount: number;
  restAmount: number;
}

export interface LuxProduct {
  id: string;
  slug: string;
  title: string;
  division: string;
  teamPower: number;
  coins: number;
  basePrice: number;
  promoPrice: number | null;
  paymentMode: LuxPaymentMode;
  installmentMonths: number | null;
  installmentDownPayment: number | null;
  canSplit: boolean;
  schedule: LuxSchedule | null;
  isFeatured: boolean;
  featuredUntil?: string | null;
}

// Carte produit partagée (landing + catalogue).
export interface LuxCardData {
  id: string;
  slug: string;
  title: string;
  division: string;
  teamPower: number;
  coins: number;
  basePrice: number;
  promoPrice: number | null;
  isFeatured: boolean;
  paymentMode: LuxPaymentMode;
  installmentMonths: number | null;
  schedule?: LuxSchedule | null;
  price?: number;
  avgRating?: number | null;
  /** Image de couverture (bucket public) ; absente → visuel dégradé par division. */
  coverUrl?: string | null;
}

export interface LuxSeed {
  stats: {
    productsInStock: number;
    productsSold: number;
    avgRating: number;
  };
  featured: LuxProduct[];
  /** Sélection de l'accueil posée par l'admin (ordre manuel). */
  home: LuxProduct[];
  pricing: {
    currency: string;
    maxInstallments: number;
    sample: { total: number; months: number; apport: number; monthly: number } | null;
  };
  promo: { title: string; endsAt: string; productSlug: string } | null;
}

interface SeedEnvelope {
  ok: boolean;
  data?: LuxSeed;
  error?: { message?: string };
}

const TTL_MS = 30_000;
let cache: { at: number; data: LuxSeed } | null = null;
let inFlight: Promise<LuxSeed> | null = null;

function isFresh(data: LuxSeed): boolean {
  // La promo est datée côté serveur : invalide dès qu'elle est expirée ou à 10 s de la fin.
  if (data.promo && Date.now() > Date.parse(data.promo.endsAt) - 10_000) return false;
  return true;
}

export async function fetchLuxSeed(force = false): Promise<LuxSeed> {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS && isFresh(cache.data)) {
    return cache.data;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch("/api/seed", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    let payload: SeedEnvelope;
    try {
      payload = (await res.json()) as SeedEnvelope;
    } catch {
      throw new Error("seed: réponse illisible");
    }
    if (!payload.ok || !payload.data) {
      throw new Error(payload.error?.message ?? "seed: échec");
    }
    cache = { at: Date.now(), data: payload.data };
    return payload.data;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function invalidateLuxSeed(): void {
  cache = null;
}

// ---- Affichage (jamais de calcul métier) ----
const nfFcfa = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatFcfa(amount: number): string {
  return `${nfFcfa.format(amount)} FCFA`;
}

export function formatInt(n: number): string {
  return nfFcfa.format(n);
}

export function formatRating(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}/5`;
}

// ---- Badge de division : tuile 6×6 (couleurs fixes du spec) ----
export type LuxTier = "gold" | "platinum" | "silver" | "bronze";

export function divisionTier(division: string): LuxTier {
  const d = division.toLowerCase();
  if (d.includes("legend")) return "platinum";
  if (d.includes("ikon")) return "platinum";
  if (d.includes("epic")) return "silver";
  if (d.includes("division 1") || d.includes("élite") || d.includes("1")) return "gold";
  return "bronze";
}

export function tierTileClass(tier: LuxTier): string {
  return `lux-tile-${tier}`;
}

export function tierLabel(tier: LuxTier): string {
  switch (tier) {
    case "platinum":
      return "Platine";
    case "silver":
      return "Argent";
    case "gold":
      return "Or";
    default:
      return "Bronze";
  }
}