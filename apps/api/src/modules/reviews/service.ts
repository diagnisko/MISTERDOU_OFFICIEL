import { z } from "zod";
import { prisma, Prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { conflict, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";
import { publicUrl } from "../../lib/media.js";

// ---------------------------------------------------------------------------
// Avis clients et réputation des vendeurs.
// Un compte n'est vendu qu'une fois : l'avis note donc la transaction, et la
// réputation se calcule par vendeur (ou pour MISTERDOU sur ses propres offres).
// Seul l'acheteur d'une commande dont il a confirmé la réception peut noter,
// une seule fois. L'identité du vendeur reste masquée (« Vendeur partenaire »).
// ---------------------------------------------------------------------------

export const reviewSchema = z.object({
  rating: z.number().int().min(1, "Note de 1 à 5.").max(5, "Note de 1 à 5."),
  comment: z
    .string()
    .trim()
    .max(500, "500 caractères maximum.")
    .optional()
    .transform((v) => (v ? v : null)),
});

export type ReviewInput = z.infer<typeof reviewSchema>;

/** Clé de réputation : l'id du vendeur, ou « MISTERDOU » pour les offres maison. */
export type ReputationKey = string;
export const PLATFORM_KEY = "MISTERDOU";

export type Reputation = { rating: number | null; reviewCount: number; sales: number; since: string | null };

/**
 * Une vente compte dès que le compte est remis : commande livrée, ou commande en
 * mensualités dont l'apport est validé (le client a déjà les identifiants).
 */
const SOLD_ORDER: Prisma.OrderWhereInput = {
  OR: [{ status: { in: ["DELIVERED", "COMPLETED"] } }, { status: "PARTIALLY_PAID", paymentMode: "INSTALLMENTS" }],
};

/** Identifiant public de la boutique officielle (offres sans vendeur). */
export const PLATFORM_PROFILE_ID = "misterdou";

/** Code public court d'un vendeur (ex. « V-3F9A2C ») : jamais son nom. */
export function sellerCode(sellerId: string): string {
  return `V-${sellerId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export type SellerIdentity = { name: string; avatarUrl: string | null };

/**
 * Nom public d'un vendeur : prénom + initiale du nom (« Moussa D. »), et la
 * photo de son profil. Le nom complet, l'e-mail et le téléphone restent privés.
 */
export async function sellerIdentities(sellerIds: Array<string | null | undefined>): Promise<Map<string, SellerIdentity>> {
  const ids = [...new Set(sellerIds.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, SellerIdentity>();
  if (ids.length === 0) return out;
  const rows = await prisma.seller.findMany({
    where: { id: { in: ids } },
    select: { id: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } },
  });
  for (const r of rows) {
    const first = r.user.firstName?.trim();
    const initial = r.user.lastName?.trim()[0];
    out.set(r.id, {
      name: first ? (initial ? `${first} ${initial.toUpperCase()}.` : first) : sellerCode(r.id),
      avatarUrl: r.user.avatarKey ? publicUrl(r.user.avatarKey) : null,
    });
  }
  return out;
}

/** Réputation de plusieurs vendeurs en 4 requêtes groupées (null = MISTERDOU). */
export async function reputations(sellerIds: Array<string | null>): Promise<Map<ReputationKey, Reputation>> {
  const ids = [...new Set(sellerIds.filter((id): id is string => Boolean(id)))];
  const wantsPlatform = sellerIds.some((id) => !id);
  const out = new Map<ReputationKey, Reputation>();

  const [sellerRatings, platformRating, sellerSales, platformSales, sellers] = await Promise.all([
    ids.length
      ? prisma.$queryRaw<Array<{ sellerId: string; avg: number | null; count: bigint }>>`
          SELECT p."sellerId", AVG(r.rating)::float AS avg, COUNT(*) AS count
          FROM "ProductReview" r JOIN "Product" p ON p.id = r."productId"
          WHERE p."sellerId" IN (${Prisma.join(ids)})
          GROUP BY p."sellerId"`
      : Promise.resolve([]),
    wantsPlatform
      ? prisma.productReview.aggregate({ where: { product: { sellerId: null } }, _avg: { rating: true }, _count: true })
      : Promise.resolve(null),
    ids.length
      ? prisma.orderItem.groupBy({
          by: ["sellerId"],
          where: { sellerId: { in: ids }, order: SOLD_ORDER },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    wantsPlatform
      ? prisma.orderItem.count({ where: { sellerId: null, product: { sellerId: null }, order: SOLD_ORDER } })
      : Promise.resolve(0),
    ids.length ? prisma.seller.findMany({ where: { id: { in: ids } }, select: { id: true, sellerSince: true, createdAt: true } }) : Promise.resolve([]),
  ]);

  for (const s of sellers) {
    const r = sellerRatings.find((x) => x.sellerId === s.id);
    const count = r ? Number(r.count) : 0;
    out.set(s.id, {
      rating: count > 0 && r?.avg !== null && r?.avg !== undefined ? Math.round(r.avg * 10) / 10 : null,
      reviewCount: count,
      sales: sellerSales.find((x) => x.sellerId === s.id)?._count._all ?? 0,
      since: (s.sellerSince ?? s.createdAt).toISOString(),
    });
  }
  if (wantsPlatform && platformRating) {
    out.set(PLATFORM_KEY, {
      rating: platformRating._count > 0 && platformRating._avg.rating !== null ? Math.round(platformRating._avg.rating * 10) / 10 : null,
      reviewCount: platformRating._count,
      sales: platformSales,
      since: null,
    });
  }
  return out;
}

/** Avis de l'acheteur sur sa commande, s'il l'a déjà laissé. */
export async function reviewForOrder(orderId: string, userId: string) {
  const item = await prisma.orderItem.findFirst({ where: { orderId }, select: { productId: true } });
  if (!item) return null;
  const review = await prisma.productReview.findFirst({
    where: { productId: item.productId, userId },
    select: { rating: true, comment: true, createdAt: true },
  });
  return review ? { ...review, createdAt: review.createdAt.toISOString() } : null;
}

export async function submitReview(orderId: string, input: ReviewInput, ctx: { actorId: string; actorRole?: RoleName; ip?: string }) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: ctx.actorId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      receivedAt: true,
      items: { take: 1, select: { productId: true, title: true, product: { select: { seller: { select: { userId: true } } } } } },
    },
  });
  const item = order?.items[0];
  if (!order || !item) throw notFound("Commande introuvable.");
  if (order.status !== "COMPLETED" || !order.receivedAt) {
    throw conflict("ORDER_NOT_DELIVERED", "Confirmez d’abord la réception du compte pour laisser un avis.");
  }

  // Un seul avis par acheteur et par compte (verrou transactionnel sur la commande).
  const review = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const existing = await tx.productReview.findFirst({ where: { productId: item.productId, userId: ctx.actorId }, select: { id: true } });
    if (existing) throw conflict("CONFLICT", "Vous avez déjà donné votre avis sur cette commande.");
    return tx.productReview.create({
      data: { productId: item.productId, userId: ctx.actorId, rating: input.rating, comment: input.comment },
      select: { id: true, rating: true, comment: true, createdAt: true },
    });
  });

  await logAudit({
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    ip: ctx.ip,
    action: "REVIEW_CREATED",
    resourceType: "ProductReview",
    resourceId: review.id,
    metadata: { orderNumber: order.orderNumber, rating: review.rating },
  });
  const sellerUserId = item.product.seller?.userId;
  if (sellerUserId) {
    await notifyUser(sellerUserId, "SYSTEM", {
      title: `Nouvel avis : ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`,
      message: review.comment
        ? `Un client a noté « ${item.title} » ${review.rating}/5 : « ${review.comment} »`
        : `Un client a noté « ${item.title} » ${review.rating}/5.`,
      actionUrl: "/seller",
      priority: "NORMAL",
    });
  }
  return { rating: review.rating, comment: review.comment, createdAt: review.createdAt.toISOString() };
}

type ReviewRow = { rating: number; comment: string | null; createdAt: Date; user: { firstName: string | null; lastName: string | null } };

function publicReview(r: ReviewRow) {
  return {
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    // Prénom + initiale : l'avis reste crédible sans exposer l'acheteur.
    author: [r.user.firstName, r.user.lastName ? `${r.user.lastName[0]}.` : null].filter(Boolean).join(" ") || "Client",
  };
}

const REVIEW_SELECT = { rating: true, comment: true, createdAt: true, user: { select: { firstName: true, lastName: true } } } as const;

/**
 * Derniers comptes vendus d'un vendeur (null = MISTERDOU) : vitrine de confiance
 * du profil. Aucune donnée d'acheteur, seulement le compte et sa photo.
 */
export async function soldShowcase(sellerId: string | null, take = 12) {
  const rows = await prisma.product.findMany({
    where: { sellerId, status: "SOLD", deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      division: true,
      teamPower: true,
      coins: true,
      images: { orderBy: [{ isPrimary: "desc" }, { position: "asc" }], select: { objectKey: true, mimeType: true } },
    },
  });
  return rows.map((p) => {
    // Une photo de préférence ; à défaut, la vidéo (sa première image sert de couverture).
    const image = p.images.find((m) => m.mimeType.startsWith("image/"));
    const video = image ? undefined : p.images.find((m) => m.mimeType.startsWith("video/"));
    return {
      id: p.id,
      title: p.title,
      division: p.division,
      teamPower: p.teamPower,
      coins: p.coins,
      coverUrl: image ? publicUrl(image.objectKey) : null,
      coverVideoUrl: video ? publicUrl(video.objectKey) : null,
    };
  });
}

/** Profil public d'un vendeur : réputation, derniers avis, comptes vendus. */
export async function sellerPublicProfile(sellerId: string) {
  const seller = await prisma.seller.findFirst({ where: { id: sellerId, status: "ACTIVE" }, select: { id: true } });
  if (!seller) throw notFound("Vendeur introuvable.");
  const [rep, reviews, identity, sold] = await Promise.all([
    reputations([seller.id]),
    prisma.productReview.findMany({ where: { product: { sellerId: seller.id } }, orderBy: { createdAt: "desc" }, take: 20, select: REVIEW_SELECT }),
    sellerIdentities([seller.id]),
    soldShowcase(seller.id),
  ]);
  return {
    id: seller.id,
    code: sellerCode(seller.id),
    official: false,
    name: identity.get(seller.id)?.name ?? sellerCode(seller.id),
    avatarUrl: identity.get(seller.id)?.avatarUrl ?? null,
    ...(rep.get(seller.id) ?? { rating: null, reviewCount: 0, sales: 0, since: null }),
    reviews: reviews.map(publicReview),
    sold,
  };
}

/** Boutique officielle MISTERDOU : même vitrine que les vendeurs, pour les offres maison. */
export async function platformPublicProfile() {
  const [rep, reviews, sold] = await Promise.all([
    reputations([null]),
    prisma.productReview.findMany({ where: { product: { sellerId: null } }, orderBy: { createdAt: "desc" }, take: 20, select: REVIEW_SELECT }),
    soldShowcase(null),
  ]);
  return {
    id: PLATFORM_PROFILE_ID,
    code: "MISTERDOU",
    official: true,
    name: "MISTERDOU",
    avatarUrl: null,
    ...(rep.get(PLATFORM_KEY) ?? { rating: null, reviewCount: 0, sales: 0, since: null }),
    reviews: reviews.map(publicReview),
    sold,
  };
}
