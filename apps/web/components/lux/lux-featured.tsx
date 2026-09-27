"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import Link from "next/link";
import { Reveal, SectionLabel, LUX_EASE, IgniteHeading } from "./lux-fx";
import { LuxCountdown } from "./lux-countdown";
import { ProductCard } from "./lux-product-card";
import { IconArrowRight } from "./lux-icons";
import { useLux } from "./lux-data";

const GRID: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05, ease: LUX_EASE } },
};

function CardSkeleton() {
  return (
    <div className="lux-skeleton overflow-hidden rounded-[24px]" style={{ minHeight: 430 }} aria-hidden>
      <div className="flex h-full flex-col justify-end gap-3 p-6">
        <div className="lux-skeleton h-24 w-full opacity-60" style={{ borderRadius: 14 }} />
        <div className="lux-skeleton h-4 w-2/3 opacity-60" style={{ borderRadius: 8 }} />
        <div className="lux-skeleton h-9 w-full opacity-50" style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}

export function LuxFeatured() {
  const { seed, status, error, retry } = useLux();
  const reduce = useReducedMotion();
  // Sélection de l'accueil posée par l'admin (ordre manuel), complétée par les
  // mises en avant payées encore valides — l'API fait le dédoublonnage. On
  // n'affiche plus « les mieux notés » tirés au sort : la home montre ce que
  // l'équipe a effectivement choisi.
  const comptes = seed?.home ?? [];
  const promo = seed?.promo ?? null;
  const loading = status === "loading";

  return (
    <section id="comptes" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <SectionLabel>La sélection du moment</SectionLabel>
            </Reveal>
            <IgniteHeading
              className="lux-h2 mt-5 text-stone-100"
              parts={[{ text: "Des comptes," }, { text: " choisis.", accent: true }, { text: " Des prix, assumés." }]}
            />
          </div>
          {promo && (
            <Reveal delay={0.15}>
              <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] uppercase tracking-[0.24em] text-stone-400">{promo.title}</span>
                <LuxCountdown endsAtIso={promo.endsAt} />
              </div>
            </Reveal>
          )}
        </div>

        {loading ? (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 9 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : status === "error" ? (
          <div className="lux-glass mt-12 rounded-[24px] p-10 text-center">
            <p className="text-[14px] text-stone-400">
              {error ? "Le catalogue n'a pas pu être chargé." : "Indisponible — nouvelle tentative nécessaire."}
            </p>
            <button type="button" onClick={retry} className="lux-btn lux-btn-gold mt-6">
              Réessayer
            </button>
          </div>
        ) : comptes.length === 0 ? (
          <div className="lux-glass mt-12 rounded-[24px] p-10 text-center">
            <p className="text-[14px] text-stone-400">
              Aucune offre sélectionnée pour l&apos;instant — tout le catalogue reste accessible.
            </p>
            <Link href="/offres" className="lux-btn lux-btn-gold mt-6" style={{ borderRadius: 16 }}>
              Voir toutes les offres
            </Link>
          </div>
        ) : (
          <motion.div
            variants={GRID}
            initial={reduce ? false : "hidden"}
            whileInView="show"
            viewport={{ once: true, amount: 0.12, margin: "-12% 0px" }}
            className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {comptes.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </motion.div>
        )}

        <Reveal delay={0.1} className="mt-12 flex flex-wrap justify-center gap-4">
          <Link href="/offres" className="lux-btn lux-btn-gold group/btn" style={{ borderRadius: 18 }}>
            Toutes les offres
            <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" aria-hidden />
          </Link>
          <Link href="/pret-ou-prestation" className="lux-btn lux-btn-ghost group/btn" style={{ borderRadius: 18 }}>
            Payer en mensualités
            <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" aria-hidden />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}