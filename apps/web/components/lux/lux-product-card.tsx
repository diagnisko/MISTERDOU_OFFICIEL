"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import Link from "next/link";
import { cx, LUX_EASE } from "./lux-fx";
import { IconArrowRight, IconCoins, IconDiamond, IconSparkle, IconStar } from "./lux-icons";
import { divisionTier, formatFcfa, formatInt, tierTileClass, type LuxCardData } from "@/lib/lux";
import { useT, type MessageKey } from "@/lib/i18n";

const CARD: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: LUX_EASE } },
};

const TIER_GLOW: Record<string, string> = {
  gold: "rgba(232,71,36,0.30)",
  platinum: "rgba(229,228,226,0.24)",
  silver: "rgba(192,192,192,0.22)",
  bronze: "rgba(205,127,50,0.26)",
};

export function ProductCard({
  product,
  index = 0,
  animateIn = true,
  installments = false,
}: {
  product: LuxCardData;
  /** Carte de la page mensualités : la fiche s'ouvre en mode paiement échelonné. */
  installments?: boolean;
  index?: number;
  /** false → rendu statique immédiatement visible (SSR liste, sans animation d'entrée). */
  animateIn?: boolean;
}) {
  const t = useT();
  const tier = divisionTier(product.division);
  const reduce = useReducedMotion(); // (réservé : pause anim, traité par animateIn)
  const tierClass = tierTileClass(tier);
  const glow = TIER_GLOW[tier] ?? TIER_GLOW.bronze; // teinte du dégradé du visuel
  const distFromCenter = Math.min(Math.abs(index - 2), Math.abs(index - 3));
  const delay = animateIn ? 0.04 + distFromCenter * 0.07 : 0;
  const detailHref = `/catalogue/${product.slug}${installments ? "?mode=mensualites" : ""}`;

  return (
    <motion.article
      variants={CARD}
      initial={animateIn ? undefined : false}
      animate={animateIn ? undefined : "show"}
      transition={{ delay }}
      className="lux-card group/card overflow-hidden rounded-[24px]"
    >
      <Link href={detailHref} className="block" aria-label={t("card.viewLabel", { title: product.title })} legacyBehavior={false}>
        {/* Visuel : dégradé radial teinté par division */}
        <div
          className="lux-card-visual relative h-56"
          style={{
            background: `radial-gradient(120% 100% at 70% 0%, ${glow}, transparent 56%), radial-gradient(150% 120% at 18% 100%, rgba(232,71,36,0.1), transparent 58%), linear-gradient(180deg, var(--lux-surface-2), var(--lux-surface))`,
          }}
        >
          {product.coverUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- bucket public R2, domaine configurable */}
              <img
                src={product.coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover/card:scale-[1.04]"
              />
              <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,3,3,0.45)_0%,transparent_32%,rgba(5,3,3,0.88)_100%)]" />
            </>
          )}
          {/* tuile division 6×6 — usage exclusif */}
          <span className="absolute left-4 top-4 flex items-center gap-2.5">
            <span className={cx("lux-div-tile", tierTileClass(tier))} aria-hidden />
            <span className="lux-glass-chip px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-stone-300">
              {t(`tier.${tier}` as MessageKey)}
            </span>
          </span>
          {product.isFeatured && (
            <span className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#1a0503] shadow-lg">
              <IconSparkle className="h-3 w-3" aria-hidden />
              {t("card.featured")}
            </span>
          )}

          <span className="absolute inset-x-0 bottom-4 flex items-end justify-between px-5">
            <span>
              <span className="lux-serif block text-[44px] font-bold leading-none text-stone-50">{formatInt(product.teamPower)}</span>
              <span className="mt-1 block text-[10px] uppercase tracking-[0.3em] text-stone-400">OVR</span>
            </span>
            <span className="flex items-center gap-1.5 text-[13px] text-stone-300">
              <IconCoins className="h-4 w-4 text-[var(--lux-gold-light)]" aria-hidden />
              <span className="tabular-nums">{formatInt(product.coins)}</span>
            </span>
          </span>
        </div>

        <div className="p-5 pb-0">
          <h3 className="text-[16px] font-semibold leading-snug text-stone-100">{product.title}</h3>
        </div>
      </Link>

      <div className="flex flex-col gap-3 p-5">
        {typeof product.avgRating === "number" && product.avgRating > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-stone-400">
            <span className="flex gap-0.5 text-[var(--lux-gold)]" aria-hidden>
              {Array.from({ length: 5 }).map((_, s) => (
                <IconStar key={s} filled={s < Math.round(product.avgRating!)} className="h-3 w-3" />
              ))}
            </span>
            <span className="tabular-nums">{(product.avgRating ?? 0).toFixed(1).replace(".", ",")}/5</span>
          </span>
        )}

        <div className="flex items-baseline gap-3">
          {product.promoPrice !== null && product.promoPrice < product.basePrice ? (
            <>
              <span className="text-[13px] text-stone-400 line-through decoration-stone-600">{formatFcfa(product.basePrice)}</span>
              <span className="lux-serif text-[24px] font-bold text-[var(--lux-gold-light)] tabular-nums">
                {formatFcfa(product.promoPrice)}
              </span>
            </>
          ) : (
            <span className="lux-serif text-[24px] font-bold text-stone-100 tabular-nums">{formatFcfa(product.basePrice)}</span>
          )}
        </div>

        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-stone-400">
          <IconDiamond className="h-3.5 w-3.5 text-[var(--lux-gold)]" aria-hidden />
          {product.schedule ? (
            product.schedule.downPayment > 0
              ? t("card.downThen", { down: formatFcfa(product.schedule.downPayment), months: product.schedule.months })
              : t("card.monthsOf", { months: product.schedule.months, amount: formatFcfa(product.schedule.monthlyAmount) })
          ) : product.paymentMode === "INSTALLMENTS" && product.installmentMonths ? (
            t("card.upTo", { months: product.installmentMonths ?? 0 })
          ) : (
            t("card.cash")
          )}
        </span>

        <Link
          href={detailHref}
          className="lux-btn lux-btn-ghost w-full !min-h-[44px] text-[11px] group-hover/card:border-[rgba(255,106,50,0.45)]"
          style={{ borderRadius: 16 }}
        >
          {t("card.view")}
          <IconArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover/card:translate-x-1" aria-hidden />
        </Link>
      </div>
    </motion.article>
  );
}