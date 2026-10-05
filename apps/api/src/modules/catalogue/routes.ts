import type { FastifyInstance } from "fastify";
import { prisma } from "@misterdou/db";
import type { Prisma } from "@misterdou/db";
import { sendError, sendPublicOk, PUBLIC_CACHE_CONTROL } from "../../lib/envelope.js";

import { buildSchedule } from "../installments/service.js";
import { promoRelationSelect, resolvePrice } from "../../lib/pricing.js";
import { mediaKind, publicUrl } from "../../lib/media.js";
import { PLATFORM_KEY, PLATFORM_PROFILE_ID, reputations, sellerCode, sellerIdentities } from "../reviews/service.js";

// ---------------------------------------------------------------------------
// Catalogue public (Phase 3) — GET /api/catalogue  &  GET /api/catalogue/:slug
// Projections strictes : jamais de credentials/selfie/keys. Prix effectif
// calculé côté serveur (promotion à fenêtre prioritaire), note moyenne
// agrégée en base. isFeatured = Product.featuredUntil encore valide.
// ---------------------------------------------------------------------------

const MAX_PAGES = 300;
const DEFAULT_PER_PAGE = 12;
// « power » = puissance décroissante (valeur historique), « powerAsc » = croissante.
const VALID_SORTS = ["newest", "priceAsc", "priceDesc", "power", "powerAsc"] as const;
type SortKey = (typeof VALID_SORTS)[number];

const SELECT_PUBLIC = {
  id: true,
  slug: true,
  title: true,
  division: true,
  teamPower: true,
  coins: true,
  basePrice: true,
  featuredPriceOverride: true,
  paymentMode: true,
  installmentMonths: true,
  installmentDownPayment: true,
  publishedAt: true,
  createdAt: true,
  // Sert à la réputation affichée ; jamais renvoyé tel quel au public.
  sellerId: true,
} as const;

/** Projection publique + mise en avant + promotion active à l'instant T. */
function publicSelect(now: Date) {
  return {
    ...SELECT_PUBLIC,
    featuredUntil: true,
    ...promoRelationSelect(now),
    // Couverture : première image (la principale d'abord). Les vidéos restent sur la fiche.
    images: {
      where: { mimeType: { startsWith: "image/" } },
      orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }],
      take: 1,
      select: { objectKey: true },
    },
  };
}

interface CatalogueQuery {
  q?: string;
  seller?: string;
  division?: string;
  sort?: string;
  page?: string;
  perPage?: string;
  paymentMode?: string;
}

function parseIntSafe(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isSort(value: string | undefined): value is SortKey {
  return VALID_SORTS.includes(value as SortKey);
}

interface SortableProduct {
  createdAt: Date;
  teamPower: number;
  basePrice: number;
  featuredPriceOverride: number | null;
  featuredUntil: Date | null;
  promotions: ReadonlyArray<{ id: string; promoPrice: number | null; discountPercent: number | null }>;
}

function isFeatured(p: SortableProduct, now: Date): boolean {
  return p.featuredUntil !== null && p.featuredUntil.getTime() > now.getTime();
}

/**
 * Détail de l'échéancier renvoyé au public. Calculé par le MÊME code que la
 * commande (buildSchedule) : si le client refaisait l'arrondi de son côté,
 * la mensualité affichée et la mensualité débitée divergeraient d'une centaine
 * de francs — et le client verrait « 4 100 » sur la fiche, « 4 200 » au
 * moment de payer. Une seule source de vérité, ici.
 */
function scheduleFor(p: {
  installmentMonths: number | null;
  installmentDownPayment: number | null;
}, price: number) {
  if (p.installmentMonths === null || p.installmentMonths < 2) return null;
  const down = Math.max(0, Math.min(p.installmentDownPayment ?? 0, price));
  const plan = buildSchedule({ total: price, downPayment: down, months: p.installmentMonths, from: new Date(0) });
  return {
    months: p.installmentMonths,
    downPayment: plan.downPayment,
    monthlyAmount: plan.monthly,
    lastMonthAmount: plan.last,
    restAmount: price - plan.downPayment,
  };
}

function sortCatalogue<T extends SortableProduct>(rows: T[], sort: SortKey, now: Date): T[] {
  // Les offres encore en mise en avant passent en tête, puis le tri demandé.
  const rank = (t: T) => (isFeatured(t, now) ? 0 : 1);
  return rows.sort((a, b) => {
    const featured = rank(a) - rank(b);
    if (featured !== 0) return featured;
    switch (sort) {
      case "priceAsc":
        return resolvePrice(a).price - resolvePrice(b).price;
      case "priceDesc":
        return resolvePrice(b).price - resolvePrice(a).price;
      case "power":
        return b.teamPower - a.teamPower;
      case "powerAsc":
        return a.teamPower - b.teamPower;
      case "newest":
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });
}

export async function registerCatalogueRoutes(app: FastifyInstance) {
  app.route({
    method: "GET",
    url: "/catalogue",
    schema: {
      tags: ["Public"],
      summary: "Catalogue paginé : recherche (nom ou puissance), division, tris",
      querystring: {
        type: "object",
        properties: {
          q: { type: "string", maxLength: 60 },
          seller: { type: "string", maxLength: 36 },
          division: { type: "string" },
          sort: { type: "string", enum: [...VALID_SORTS] },
          page: { type: "string" },
          perPage: { type: "string" },
          paymentMode: { type: "string", enum: ["ONE_TIME", "INSTALLMENTS"] },
        },
      },
    },
    handler: async (request, reply) => {
      const q = request.query as CatalogueQuery;
      const sort = isSort(q.sort) ? q.sort : "newest";
      const page = parseIntSafe(q.page, 1, 1, MAX_PAGES);
      const perPage = parseIntSafe(q.perPage, DEFAULT_PER_PAGE, 4, 48);
      const division = q.division?.trim() || undefined;
      // « Offres » = tout, payé en un seul coup. « Prêt ou prestation » =
      // uniquement ce qui est éligible au paiement en tranches. Filtre demandé
      // explicitement, sinon l'offre apparaît dans les deux pages et l'acheteur
      // voit deux prix différents pour le même compte.
      const paymentMode: "ONE_TIME" | "INSTALLMENTS" | undefined =
        q.paymentMode === "ONE_TIME" || q.paymentMode === "INSTALLMENTS" ? q.paymentMode : undefined;

      // Recherche : un nombre = puissance minimale (« 3200 » → 3 200 et plus),
      // sinon le nom de l'offre ou sa division.
      const search = q.q?.trim().slice(0, 60) || undefined;
      const minPower = search && /^\d[\d\s.]*$/.test(search) ? Number(search.replace(/\D/g, "")) : null;

      // seller=<id> : un vendeur ; seller=misterdou : les offres maison (sans vendeur).
      const sellerId = q.seller === PLATFORM_PROFILE_ID ? null : q.seller && /^[0-9a-f-]{36}$/i.test(q.seller) ? q.seller : undefined;

      const where: Prisma.ProductWhereInput = {
        status: "ACTIVE" as const,
        deletedAt: null,
        ...(sellerId !== undefined ? { sellerId } : {}),
        ...(division ? { division } : {}),
        ...(paymentMode ? { paymentMode } : {}),
        ...(search
          ? minPower !== null
            ? { teamPower: { gte: minPower } }
            : {
                OR: [
                  { title: { contains: search, mode: "insensitive" as const } },
                  { division: { contains: search, mode: "insensitive" as const } },
                ],
              }
          : {}),
      };

      const now = new Date();
      const [rows, total, divisions] = await Promise.all([
        prisma.product.findMany({ where, orderBy: { createdAt: "desc" }, select: publicSelect(now), take: 300 }),
        prisma.product.count({ where }),
        prisma.product.findMany({
          where: { status: "ACTIVE", deletedAt: null },
          distinct: ["division"],
          select: { division: true },
        }),
      ]);

      const ordered = sortCatalogue(rows, sort, now);
      const pageRows = ordered.slice((page - 1) * perPage, page * perPage);

      // Note affichée : réputation du vendeur (un compte n'est vendu qu'une
      // fois, il n'a jamais d'avis propre avant sa vente). Requêtes groupées
      // restreintes aux vendeurs de la page renvoyée.
      const [rep, identities] = await Promise.all([
        reputations(pageRows.map((p) => p.sellerId)),
        sellerIdentities(pageRows.map((p) => p.sellerId)),
      ]);

      const items = pageRows.map((p) => {
        const { price, promoPrice } = resolvePrice(p);
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          division: p.division,
          teamPower: p.teamPower,
          coins: p.coins,
          basePrice: p.basePrice,
          promoPrice,
          price,
          paymentMode: p.paymentMode,
          installmentMonths: p.installmentMonths,
          installmentDownPayment: p.installmentDownPayment,
          canSplit: p.installmentMonths !== null,
          isFeatured: isFeatured(p, now),
          schedule: scheduleFor(p, price),
          avgRating: rep.get(p.sellerId ?? PLATFORM_KEY)?.rating ?? null,
          coverUrl: p.images[0] ? publicUrl(p.images[0].objectKey) : null,
          // Qui vend : MISTERDOU, ou le vendeur (prénom + initiale, photo) → sa page.
          seller: p.sellerId
            ? { kind: "SELLER" as const, id: p.sellerId, name: identities.get(p.sellerId)?.name ?? sellerCode(p.sellerId), avatarUrl: identities.get(p.sellerId)?.avatarUrl ?? null }
            : { kind: "MISTERDOU" as const },
        };
      });

      const totalPages = Math.max(1, Math.ceil(total / perPage));
      const meta = {
        page,
        perPage,
        total,
        totalPages,
        sort,
        q: search ?? null,
        division: division ?? null,
        paymentMode: paymentMode ?? null,
        divisions: divisions.map((d) => d.division).sort((a, b) => a.localeCompare(b, "fr")),
      };

      // Route PUBLIQUE idempotente : cache navigateur 60 s + revalidation
      // différée, ETag fort (voir sendPublicOk). Le hook global de sécurité
      // remet `no-store` si la requête porte une session.
      reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
      return sendPublicOk(request, reply, items, meta);
    },
  });

  app.route({
    method: "GET",
    url: "/catalogue/:slug",
    schema: {
      tags: ["Public"],
      summary: "Fiche produit publique (jamais de credentials)",
      params: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
    },
    handler: async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const now = new Date();
      const p = await prisma.product.findFirst({
        where: { slug, status: "ACTIVE", deletedAt: null },
        select: {
          ...publicSelect(now),
          description: true,
          extraInfo: true,
        },
      });
      if (!p) return sendError(reply, 404, "NOT_FOUND", "Compte introuvable ou retiré.");

      const media = await prisma.productImage.findMany({
        where: { productId: p.id },
        orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
        select: { id: true, objectKey: true, mimeType: true },
      });
      const [repMap, identities] = await Promise.all([reputations([p.sellerId]), sellerIdentities([p.sellerId])]);
      const rep = repMap.get(p.sellerId ?? PLATFORM_KEY);
      const { price, promoPrice } = resolvePrice(p);

      const data = {
        id: p.id,
        slug: p.slug,
        title: p.title,
        division: p.division,
        teamPower: p.teamPower,
        coins: p.coins,
        basePrice: p.basePrice,
        promoPrice,
        price,
        paymentMode: p.paymentMode,
        installmentMonths: p.installmentMonths,
        installmentDownPayment: p.installmentDownPayment,
        canSplit: p.installmentMonths !== null,
        isFeatured: isFeatured(p, now),
        schedule: scheduleFor(p, price),
        publishedAt: p.publishedAt?.toISOString() ?? null,
        description: p.description,
        extraInfo: p.extraInfo ?? null,
        avgRating: rep?.rating ?? null,
        reviewCount: rep?.reviewCount ?? 0,
        // Vendeur : MISTERDOU ou « Vendeur partenaire » avec sa réputation (jamais son nom).
        seller: p.sellerId
          ? {
              kind: "SELLER" as const,
              id: p.sellerId,
              code: sellerCode(p.sellerId),
              name: identities.get(p.sellerId)?.name ?? sellerCode(p.sellerId),
              avatarUrl: identities.get(p.sellerId)?.avatarUrl ?? null,
              sales: rep?.sales ?? 0,
              since: rep?.since ?? null,
            }
          : { kind: "MISTERDOU" as const, sales: rep?.sales ?? 0 },
        media: media.map((m) => ({
          id: m.id,
          url: publicUrl(m.objectKey),
          kind: mediaKind(m.mimeType) ?? "image",
          mimeType: m.mimeType,
        })),
      };

      reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
      return sendPublicOk(request, reply, data);
    },
  });
}