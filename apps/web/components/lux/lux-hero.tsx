"use client";

import { motion, useMotionValueEvent, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Magnetic, Reveal, cx } from "./lux-fx";
import { IconCrown, IconShield } from "./lux-icons";
import { formatInt, formatRating } from "@/lib/lux";
import { useLux } from "./lux-data";

const RING_DEFS = [
  { size: 420, top: "-4%", right: "8%", className: "lux-spin-slow" },
  { size: 620, top: "10%", right: "2%", className: "lux-spin-rev" },
  { size: 280, top: "26%", right: "30%", className: "lux-spin-slow" },
];

const PARTICLES = [
  { left: "12%", top: "30%", size: 6, duration: 7, delay: 0, o: 0.55 },
  { left: "22%", top: "64%", size: 4, duration: 8, delay: 1.2, o: 0.4 },
  { left: "34%", top: "22%", size: 3, duration: 6, delay: 0.6, o: 0.5 },
  { left: "48%", top: "72%", size: 5, duration: 9, delay: 2, o: 0.45 },
  { left: "62%", top: "18%", size: 4, duration: 7, delay: 0.3, o: 0.5 },
  { left: "74%", top: "40%", size: 6, duration: 8, delay: 1.6, o: 0.55 },
  { left: "84%", top: "66%", size: 3, duration: 6.5, delay: 0.9, o: 0.4 },
  { left: "92%", top: "30%", size: 5, duration: 7.5, delay: 2.4, o: 0.5 },
  { left: "16%", top: "84%", size: 4, duration: 8.5, delay: 1.8, o: 0.35 },
  { left: "58%", top: "86%", size: 3, duration: 6, delay: 0.4, o: 0.45 },
  { left: "70%", top: "8%", size: 4, duration: 9, delay: 3, o: 0.5 },
  { left: "38%", top: "50%", size: 3, duration: 8, delay: 2.2, o: 0.35 },
];

function StatSkeleton() {
  return (
    <div className="mx-auto w-24 space-y-2 md:w-32" aria-hidden>
      <div className="lux-skeleton h-7 w-full md:h-9" style={{ borderRadius: 8 }} />
      <div className="lux-skeleton h-3 w-2/3 mx-auto md:h-3.5" style={{ borderRadius: 6 }} />
    </div>
  );
}

export function LuxHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { seed, status } = useLux();
  const reduce = useReducedMotion();

  const { scrollY } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  // Couches parallaxe : aurore +70 px, scale 1.06 ; titre +60 px, fondu poussé à ~70 %.
  const auroraY = useTransform(scrollY, [0, 700], [0, 70]);
  const auroraScale = useTransform(scrollY, [0, 700], [1, 1.06]);
  const contentY = useTransform(scrollY, [0, 900], [0, -60]);
  const contentOpacity = useTransform(scrollY, [0, 620], [1, 0]);

  const [showCue, setShowCue] = useState(true);
  useMotionValueEvent(scrollY, "change", (v) => setShowCue(v < 24));

  const stats = useMemo(() => {
    const s = seed?.stats;
    return [
      { key: "stock", label: "Comptes en stock", value: s ? formatInt(s.productsInStock) : null },
      { key: "sold", label: "Comptes livrés", value: s ? formatInt(s.productsSold) : null },
      { key: "rating", label: "Note moyenne", value: s ? formatRating(s.avgRating) : null },
    ];
  }, [seed]);

  return (
    <section id="top" ref={heroRef} className="relative flex min-h-[100svh] flex-col overflow-hidden">
      {/* Halo / anneaux / particules — couche stable */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {RING_DEFS.map((r, i) => (
          <div key={i} className={cx("lux-ring", r.className)} style={{ width: r.size, height: r.size, top: r.top, right: r.right }} />
        ))}
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="lux-particle"
            style={{ left: p.left, top: p.top, width: p.size, height: p.size, "--dur": `${p.duration}s`, "--o": p.o, animationDelay: `${p.delay}s` } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Aurore en parallaxe (descente +70 px, scale 1.06) */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-[-70px]"
        style={reduce ? undefined : { y: auroraY, scale: auroraScale, background: "var(--lux-aurora)" }}
      />

      {/* Contenu */}
      <motion.div
        style={reduce ? undefined : { y: contentY, opacity: contentOpacity }}
        className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-5 pb-16 pt-32 text-center md:px-8"
      >
        <Reveal delay={0}>
          <span className="lux-glass-chip text-[10px] text-stone-300">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--lux-gold)] opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--lux-gold)]" />
            </span>
            Marché sûr · Édition limitée
          </span>
        </Reveal>

        <Reveal delay={0.08}>
          <h1 className="lux-h1 mt-8 text-stone-100">
            Le pouvoir, <em className="lux-gold-text">signé</em>.
          </h1>
        </Reveal>

        <Reveal delay={0.16}>
          <p className="mt-6 max-w-xl text-balance text-[15px] leading-relaxed text-stone-400 md:text-lg">
            Comptes eFootball certifiés, livrés après paiement confirmé serveur. Identité vérifiée,
            échelonnement possible — et un engagement de confiance inscrit dans chaque transaction.
          </p>
        </Reveal>

        <Reveal delay={0.24}>
          <div className="mt-10 flex flex-col items-center gap-3.5 sm:flex-row">
            <Magnetic strength={0.35}>
              <Link href="/offres" className="lux-btn lux-btn-gold group/btn">
                Explorer les comptes
              </Link>
            </Magnetic>
          </div>
        </Reveal>

        <Reveal delay={0.3}>
          <div className="mt-8 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-stone-400">
            <IconShield className="h-4 w-4 text-[var(--lux-gold)]" />
            <span>Wave / Orange Money · KYC obligatoire</span>
          </div>
        </Reveal>

        {/* Bande statistiques — valeurs BDD, jamais figées */}
        <Reveal delay={0.36} className="mt-16 w-full">
          <div className="lux-line w-full" aria-hidden />
          <div className="grid grid-cols-2 gap-y-8 py-9 md:grid-cols-3">
            {stats.map((s, i) => {
              const loading = status === "loading" && s.value === null;
              const failed = status === "error" && s.value === null;
              return (
                <div key={s.key} className="relative px-3 text-center">
                  {i > 0 && <span className="lux-stats-divider absolute left-0 top-1/2 hidden h-10 -translate-y-1/2 md:block" aria-hidden />}
                  {loading ? (
                    <StatSkeleton />
                  ) : failed ? (
                    <div className="text-[22px] text-stone-400" aria-label="Indisponible">
                      —
                    </div>
                  ) : (
                    <div>
                      <div className="lux-serif text-[30px] font-semibold leading-none text-stone-50 md:text-[38px]">
                        <span className="lux-gold-text tabular-nums">{s.value}</span>
                      </div>
                      <div className="mt-2.5 text-[10px] uppercase tracking-[0.24em] text-stone-400">{s.label}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="lux-line w-full" aria-hidden />
        </Reveal>
      </motion.div>

      {/* Indicateur de défilement (goutte dorée, 2.1 s) */}
      <div className={cx("lux-scroll-cue", !showCue && "md:hidden")} aria-hidden style={{ display: showCue ? undefined : "none" }}>
        <span className="label">scroll</span>
        <span className="rail">
          <span className="drop" />
        </span>
        <IconCrown className="h-4 w-4 text-[var(--lux-gold)]" />
      </div>
    </section>
  );
}