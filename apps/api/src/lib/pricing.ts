// ---------------------------------------------------------------------------
// Prix effectif d'une offre — UNE seule source de vérité partagée par le
// catalogue, la commande et la landing. Priorité :
//   1. Promotion à fenêtre de dates active (Promotion.promoPrice, sinon
//      discountPercent calculé sur basePrice et arrondi à la centaine)
//   2. Product.featuredPriceOverride (promo permanente posée par l'admin)
//   3. Product.basePrice
// Jamais de recalcul côté client : le prix affiché est le prix débité.
// ---------------------------------------------------------------------------

export interface PricedProduct {
  basePrice: number;
  featuredPriceOverride: number | null;
  promotions?: ReadonlyArray<{
    id: string;
    promoPrice: number | null;
    discountPercent: number | null;
  }>;
}

export interface PriceResolution {
  price: number;
  /** Prix affiché comme « promo » (null = prix normal, pas de barré). */
  promoPrice: number | null;
  /** Promotion à fenêtre appliquée — snapshot porté par la commande. */
  promotionId: string | null;
}

/** Fenêtre « promotion en cours » — à réutiliser dans tout select/where. */
export function promoWindowWhere(now: Date) {
  return {
    startsAt: { lte: now },
    endsAt: { gt: now },
    status: { not: "CANCELLED" as const },
  };
}

/** Fragment de select : charge la promotion active du produit (au plus une). */
export function promoRelationSelect(now: Date) {
  return {
    promotions: {
      where: promoWindowWhere(now),
      select: { id: true, promoPrice: true, discountPercent: true },
      orderBy: { startsAt: "asc" as const },
      take: 1,
    },
  };
}

/** Prix d'une promotion : prix explicite prioritaire, sinon pourcentage. */
export function promotionPrice(
  promo: { promoPrice: number | null; discountPercent: number | null },
  basePrice: number,
): number | null {
  if (promo.promoPrice !== null && Number.isInteger(promo.promoPrice) && promo.promoPrice > 0 && promo.promoPrice < basePrice) {
    return promo.promoPrice;
  }
  if (promo.discountPercent !== null && promo.discountPercent >= 1 && promo.discountPercent <= 99) {
    const computed = Math.round((basePrice * (100 - promo.discountPercent)) / 100 / 100) * 100;
    if (computed > 0 && computed < basePrice) return computed;
  }
  return null;
}

export function resolvePrice(p: PricedProduct): PriceResolution {
  const active = p.promotions?.[0];
  if (active) {
    const promo = promotionPrice(active, p.basePrice);
    if (promo !== null) return { price: promo, promoPrice: promo, promotionId: active.id };
  }
  if (
    p.featuredPriceOverride !== null &&
    Number.isInteger(p.featuredPriceOverride) &&
    p.featuredPriceOverride > 0 &&
    p.featuredPriceOverride < p.basePrice
  ) {
    return { price: p.featuredPriceOverride, promoPrice: p.featuredPriceOverride, promotionId: null };
  }
  return { price: p.basePrice, promoPrice: null, promotionId: null };
}
