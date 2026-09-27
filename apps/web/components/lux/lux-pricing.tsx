"use client";

import { Reveal, SectionLabel } from "./lux-fx";
import Link from "next/link";
import { IconArrowRight, IconStar } from "./lux-icons";
import { formatFcfa } from "@/lib/lux";
import { useLux } from "./lux-data";

function SkeletonLine({ w }: { w: string }) {
  return <div className="lux-skeleton h-4 opacity-60" style={{ borderRadius: 6, width: w }} aria-hidden />;
}

const TESTIMONIALS = [
  {
    quote: "Le compte Élite Or est arrivé trois minutes après la confirmation. Identifiants chiffrés, rien à craindre.",
    name: "Moussa D.",
    role: "Division 1",
  },
  {
    quote: "J'ai échelonné sur six mois. Claire, prévisible, sans surprise au moment de payer.",
    name: "Awa B.",
    role: "Client vérifié",
  },
  {
    quote: "Le KYC est sérieux : c'est précisément ce qui m'avait fait fuir les marchés gris.",
    name: "Serigne K.",
    role: "Acheteur",
  },
];

export function LuxPricing() {
  const { seed, status } = useLux();
  const pricing = seed?.pricing ?? null;
  const hasData = status === "ready" && pricing !== null;
  const sample = pricing?.sample ?? null;

  return (
    <section id="tarifs" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionLabel>Transparence</SectionLabel>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="lux-h2 mt-5 max-w-2xl text-stone-100">
            Des règles claires, <em className="lux-gold-text">chiffrées</em> en toute clarté.
          </h2>
        </Reveal>

        <div className="mt-14">
          <Reveal from="right" delay={0.1}>
            <article className="lux-glass lux-glass-sheen flex h-full flex-col rounded-[26px] p-8">
              <p className="lux-kicker">Pour les acheteurs</p>
              <h3 className="lux-serif mt-3 text-[26px] font-semibold text-stone-100">Payez en plusieurs fois</h3>
              <div className="mt-7 flex flex-1 flex-col justify-between gap-6">
                <div>
                  <div className="flex flex-wrap items-end gap-3">
                    {hasData && sample ? (
                      <>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400">Apport immédiat</div>
                          <div className="lux-serif mt-1 text-[32px] font-bold leading-none text-stone-50 tabular-nums">{formatFcfa(sample.apport)}</div>
                        </div>
                        <div className="pb-1 text-[13px] text-stone-400">puis</div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400">/ mois</div>
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
                    {hasData && sample ? `Exemple sur ${sample.months} mensualités, depuis la sélection en vedette.` : "Échelonnement selon compte et paramètres en vigueur."}
                  </p>
                </div>
                <div className="flex items-center gap-2 border-t border-[rgba(255,255,255,0.06)] pt-4 text-[12px] text-stone-400">
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--lux-gold)] opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--lux-gold)]" />
                  </span>
                  Plafond encadré côté serveur — sans mensualité surprise.
                </div>
                <Link href="/pret-ou-prestation" className="lux-btn lux-btn-ghost group/btn self-start">
                  Voir les offres à mensualités
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
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={0.08 + i * 0.08}>
              <figure className="lux-glass flex h-full flex-col rounded-[24px] p-7">
                <div className="flex gap-1 text-[var(--lux-gold)]" aria-label="Note : 5 sur 5">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <IconStar key={s} filled className="h-3.5 w-3.5" aria-hidden />
                  ))}
                </div>
                <blockquote className="mt-4 flex-1 text-[13.5px] leading-relaxed text-stone-300">« {t.quote} »</blockquote>
                <figcaption className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
                  <div className="text-[13px] font-semibold text-stone-100">{t.name}</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400">{t.role}</div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}