"use client";

import Link from "next/link";
import { IconShield, IconStar } from "@/components/lux/lux-icons";
import { formatInt } from "@/lib/lux";
import { useT } from "@/lib/i18n";
import type { CatalogueSeller } from "@/lib/lux-catalogue";

// ---------------------------------------------------------------------------
// Qui vend ce compte : MISTERDOU, ou un vendeur partenaire avec sa réputation
// (note, ventes, ancienneté) et un lien vers son profil. Jamais son nom.
// ---------------------------------------------------------------------------

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
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-stone-100">
          <IconShield className="h-4 w-4 shrink-0 text-[var(--lux-gold)]" aria-hidden />
          {seller.kind === "SELLER" ? t("sellerp.partner", { code: seller.code }) : t("sellerp.house")}
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
      {seller.kind === "SELLER" && (
        <Link href={`/vendeurs/${seller.id}`} className="shrink-0 text-[12.5px] text-[var(--lux-gold-light)] underline-offset-2 hover:underline">
          {t("sellerp.viewProfile")}
        </Link>
      )}
    </div>
  );
}
