"use client";

import Link from "next/link";
import { IconShield, IconStar } from "@/components/lux/lux-icons";
import { cx } from "@/components/lux/lux-fx";
import { formatInt, type CardSeller } from "@/lib/lux";
import { useT } from "@/lib/i18n";
import type { CatalogueSeller } from "@/lib/lux-catalogue";

// ---------------------------------------------------------------------------
// Qui vend ce compte : MISTERDOU (photo de la boutique officielle, sinon « M. »),
// ou le vendeur (prénom + initiale, photo) avec sa réputation (note, ventes,
// ancienneté) et un lien vers son profil.
// ---------------------------------------------------------------------------

/** Photo du vendeur dans un anneau braise (tourne au survol), coche « vérifié ». */
export function SellerAvatar({ name, avatarUrl, house = false, size = 30 }: { name: string; avatarUrl?: string | null; house?: boolean; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span className="lux-seller-avatar" style={{ width: size, height: size }} aria-hidden>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- bucket public R2
        <img src={avatarUrl} alt="" loading="lazy" decoding="async" />
      ) : house ? (
        <span className="lux-seller-ini lux-serif">M.</span>
      ) : (
        <span className="lux-seller-ini">{initials}</span>
      )}
      <span className="lux-seller-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      </span>
    </span>
  );
}

/** Pastille photo + nom posée sur le visuel d'une offre ; mène à la page du vendeur. */
export function SellerChip({ seller, className }: { seller: CardSeller; className?: string }) {
  const t = useT();
  const name = seller.kind === "SELLER" ? seller.name : "MISTERDOU";
  return (
    <Link
      href={seller.kind === "SELLER" ? `/vendeurs/${seller.id}` : "/vendeurs/misterdou"}
      aria-label={t("card.sellerLink", { name })}
      className={cx("lux-seller-chip absolute z-10", className)}
    >
      <SellerAvatar name={name} avatarUrl={seller.avatarUrl ?? null} house={seller.kind !== "SELLER"} />
      <span className="max-w-[150px] truncate">{name}</span>
    </Link>
  );
}

/** Vendeur de la fiche détaillée → format de la pastille. */
export function toCardSeller(seller: CatalogueSeller | undefined): CardSeller {
  if (!seller || seller.kind !== "SELLER") return { kind: "MISTERDOU", avatarUrl: seller?.avatarUrl ?? null };
  return { kind: "SELLER", id: seller.id, name: seller.name ?? seller.code, avatarUrl: seller.avatarUrl ?? null };
}

export function Stars({ rating, size = "h-3.5 w-3.5" }: { rating: number; size?: string }) {
  return (
    <span className="flex gap-0.5 text-[var(--lux-gold)]" aria-hidden>
      {Array.from({ length: 5 }).map((_, s) => (
        <IconStar key={s} filled={s < Math.round(rating)} className={size} />
      ))}
    </span>
  );
}

export function SellerBadge({ seller, rating, reviewCount }: { seller: CatalogueSeller; rating: number | null; reviewCount: number }) {
  const t = useT();
  const since =
    seller.kind === "SELLER" && seller.since
      ? new Date(seller.since).toLocaleDateString(t.intl, { month: "long", year: "numeric" })
      : null;

  return (
    <div className="lux-glass flex flex-wrap items-center justify-between gap-3 rounded-[18px] px-4 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2.5 text-[13.5px] font-semibold text-stone-100">
          <SellerAvatar
            name={seller.kind === "SELLER" ? (seller.name ?? seller.code) : "MISTERDOU"}
            avatarUrl={seller.avatarUrl ?? null}
            house={seller.kind !== "SELLER"}
            size={34}
          />
          <span className="min-w-0">
            <span className="block truncate">{seller.kind === "SELLER" ? (seller.name ?? seller.code) : t("sellerp.house")}</span>
            <span className="flex items-center gap-1 text-[11px] font-normal text-stone-400">
              <IconShield className="h-3 w-3 text-[var(--lux-gold)]" aria-hidden />
              {seller.kind === "SELLER" ? t("sellerp.verified") : t("sellerp.official")}
            </span>
          </span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-stone-400">
          {rating !== null && reviewCount > 0 ? (
            <>
              <Stars rating={rating} size="h-3 w-3" />
              <span className="tabular-nums">{t("sellerp.rating", { rating: rating.toFixed(1).replace(".", ","), count: reviewCount })}</span>
            </>
          ) : (
            <span>{t("sellerp.noReview")}</span>
          )}
          <span aria-hidden>·</span>
          <span className="tabular-nums">{t(seller.sales > 1 ? "sellerp.salesMany" : "sellerp.salesOne", { count: formatInt(seller.sales) })}</span>
          {since && (
            <>
              <span aria-hidden>·</span>
              <span>{t("sellerp.since", { date: since })}</span>
            </>
          )}
        </p>
      </div>
      <Link
        href={seller.kind === "SELLER" ? `/vendeurs/${seller.id}` : "/vendeurs/misterdou"}
        className="shrink-0 text-[12.5px] text-[var(--lux-gold-light)] underline-offset-2 hover:underline"
      >
        {seller.kind === "SELLER" ? t("sellerp.viewProfile") : t("sellerp.viewShop")}
      </Link>
    </div>
  );
}
