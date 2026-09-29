"use client";

import { Reveal, SectionLabel, IgniteHeading } from "./lux-fx";
import Link from "next/link";
import { IconArrowRight, IconStar } from "./lux-icons";
import { formatFcfa } from "@/lib/lux";
import { useLux } from "./lux-data";
import { useT, type MessageKey } from "@/lib/i18n";

function SkeletonLine({ w }: { w: string }) {
  return <div className="lux-skeleton h-4 opacity-60" style={{ borderRadius: 6, width: w }} aria-hidden />;
}

const TESTIMONIALS = [
  {
    quote: "pricing.q1" as MessageKey,
    name: "Moussa D.",
    role: "pricing.r1" as MessageKey,
  },
  {
    quote: "pricing.q2" as MessageKey,
    name: "Awa B.",
    role: "pricing.r2" as MessageKey,
  },
  {
    quote: "pricing.q3" as MessageKey,
    name: "Serigne K.",
    role: "pricing.r3" as MessageKey,
  },
];

export function LuxPricing() {
  const t = useT();
  const { seed, status } = useLux();
  const pricing = seed?.pricing ?? null;
  const hasData = status === "ready" && pricing !== null;
  const sample = pricing?.sample ?? null;

  return (
    <section id="tarifs" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionLabel>{t("pricing.label")}</SectionLabel>
        </Reveal>
        <IgniteHeading
          className="lux-h2 mt-5 max-w-2xl text-stone-100"
          parts={[{ text: t("pricing.h1") }, { text: t("pricing.h2"), accent: true }, { text: t("pricing.h3") }]}
        />

        <div className="mt-14">
          <Reveal from="right" delay={0.1}>
            <article className="lux-glass lux-glass-sheen flex h-full flex-col rounded-[26px] p-8">
              <p className="lux-kicker">{t("pricing.buyers")}</p>
              <h3 className="lux-serif mt-3 text-[26px] font-semibold text-stone-100">{t("pricing.title")}</h3>
              <div className="mt-7 flex flex-1 flex-col justify-between gap-6">
                <div>
                  <div className="flex flex-wrap items-end gap-3">
                    {hasData && sample ? (
                      <>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400">{t("pricing.downPayment")}</div>
                          <div className="lux-serif mt-1 text-[32px] font-bold leading-none text-stone-50 tabular-nums">{formatFcfa(sample.apport)}</div>
                        </div>
                        <div className="pb-1 text-[13px] text-stone-400">{t("pricing.then")}</div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400">{t("pricing.perMonth")}</div>
                          <div className="lux-serif mt-1 text-[24px] font-bold leading-none text-[var(--lux-gold-light)] tabular-nums">
                            {formatFcfa(sample.monthly)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <SkeletonLine w="150px" />
                        <SkeletonLine w="110px" />
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-[12px] text-stone-400">
                    {hasData && sample ? t("pricing.example", { months: sample.months }) : t("pricing.generic")}
                  </p>
                </div>
                <div className="flex items-center gap-2 border-t border-[rgba(255,255,255,0.06)] pt-4 text-[12px] text-stone-400">
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--lux-gold)] opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--lux-gold)]" />
                  </span>
                  {t("pricing.cap")}
                </div>
                <Link href="/pret-ou-prestation" className="lux-btn lux-btn-ghost group/btn self-start">
                  {t("pricing.seeMonthly")}
                  <IconArrowRight
                    className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1"
                    aria-hidden
                  />
                </Link>
              </div>
            </article>
          </Reveal>
        </div>

        {/* Témoignages */}
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((item, i) => (
            <Reveal key={item.name} delay={0.08 + i * 0.08}>
              <figure className="lux-glass flex h-full flex-col rounded-[24px] p-7">
                <div className="flex gap-1 text-[var(--lux-gold)]" aria-label={t("pricing.rating")}>
                  {Array.from({ length: 5 }).map((_, s) => (
                    <IconStar key={s} filled className="h-3.5 w-3.5" aria-hidden />
                  ))}
                </div>
                <blockquote className="mt-4 flex-1 text-[13.5px] leading-relaxed text-stone-300">« {t(item.quote)} »</blockquote>
                <figcaption className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
                  <div className="text-[13px] font-semibold text-stone-100">{item.name}</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400">{t(item.role)}</div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}