"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useMemo, useRef } from "react";
import Link from "next/link";
import { Magnetic, Reveal, cx } from "./lux-fx";
import { IconShield } from "./lux-icons";
import { formatInt, formatRating } from "@/lib/lux";
import { useLux } from "./lux-data";
import { HERO_FRAME_COUNT, LuxHeroScrollFrames } from "./lux-hero-scroll";

const EMBERS = [
  { left: "8%", size: 4, duration: 9, delay: 0 },
  { left: "17%", size: 3, duration: 11, delay: 2.4 },
  { left: "29%", size: 5, duration: 8, delay: 1.1 },
  { left: "41%", size: 3, duration: 12, delay: 3.6 },
  { left: "53%", size: 4, duration: 10, delay: 0.6 },
  { left: "64%", size: 3, duration: 9.5, delay: 4.2 },
  { left: "72%", size: 5, duration: 11.5, delay: 1.8 },
  { left: "83%", size: 3, duration: 8.5, delay: 2.9 },
  { left: "92%", size: 4, duration: 10.5, delay: 0.3 },
];

function StatSkeleton() {
  return (
    <div className="mx-auto w-24 space-y-2 md:w-32" aria-hidden>
      <div className="lux-skeleton h-7 w-full md:h-9" style={{ borderRadius: 8 }} />
      <div className="lux-skeleton mx-auto h-3 w-2/3 md:h-3.5" style={{ borderRadius: 6 }} />
    </div>
  );
}

// Hero épinglé : la section fait 3,4 écrans de haut, son contenu reste collé
// pendant que le scroll pilote une chorégraphie en trois temps —
//   1. promesse (titre, CTA) sur le personnage au repos ;
//   2. le titre s'efface, bandes cinéma, la séquence déroule le logo ;
//   3. le logo se pose (flash d'ignition), les chiffres réels montent.
export function LuxHero() {
  const trackRef = useRef<HTMLElement>(null);
  const { seed, status } = useLux();
  const reduce = useReducedMotion() ?? false;

  const { scrollYProgress } = useScroll({ target: reduce ? undefined : trackRef, offset: ["start start", "end end"] });
  // Lissage : la molette arrive par à-coups, la séquence ne doit pas.
  const p = useSpring(scrollYProgress, { stiffness: 150, damping: 30, mass: 0.3, restDelta: 0.0005 });

  const frame = useTransform(p, [0.12, 0.8], [0, HERO_FRAME_COUNT - 1]);
  const artScale = useTransform(p, [0, 0.8], [1.14, 1]);
  const artOpacity = useTransform(p, [0, 0.16, 0.9, 1], [0.62, 1, 1, 0.45]);
  const haloOpacity = useTransform(p, [0.1, 0.55, 0.9], [0.15, 0.7, 0.35]);
  const flash = useTransform(p, [0.74, 0.8, 0.9], [0, 0.55, 0]);

  const introOpacity = useTransform(p, [0, 0.06, 0.2], [1, 1, 0]);
  const introY = useTransform(p, [0, 0.2], [0, -120]);
  const introScale = useTransform(p, [0, 0.2], [1, 0.94]);
  const introVisibility = useTransform(introOpacity, (o) => (o < 0.01 ? "hidden" : "visible"));

  const bars = useTransform(p, [0.16, 0.3, 0.78, 0.9], [0, 1, 1, 0]);
  const statsOpacity = useTransform(p, [0.84, 0.95], [0, 1]);
  const statsY = useTransform(p, [0.84, 0.95], [80, 0]);
  const cueOpacity = useTransform(p, [0, 0.04], [1, 0]);

  const stats = useMemo(() => {
    const s = seed?.stats;
    return [
      { key: "stock", label: "Comptes en stock", value: s ? formatInt(s.productsInStock) : null },
      { key: "sold", label: "Comptes livrés", value: s ? formatInt(s.productsSold) : null },
      { key: "rating", label: "Note moyenne", value: s ? formatRating(s.avgRating) : null },
    ];
  }, [seed]);

  const statsBand = (
    <div className="lux-glass w-full rounded-[26px] px-3">
      <div className="grid grid-cols-3 py-6 md:py-8">
        {stats.map((s, i) => {
          const loading = status === "loading" && s.value === null;
          const failed = status === "error" && s.value === null;
          return (
            <div key={s.key} className="relative px-2 text-center">
              {i > 0 && <span className="lux-stats-divider absolute left-0 top-1/2 h-10 -translate-y-1/2" aria-hidden />}
              {loading ? (
                <StatSkeleton />
              ) : failed ? (
                <div className="text-[22px] text-stone-400" aria-label="Indisponible">—</div>
              ) : (
                <div>
                  <div className="lux-serif text-[26px] font-semibold leading-none md:text-[40px]">
                    <span className="lux-gold-text tabular-nums">{s.value}</span>
                  </div>
                  <div className="mt-2.5 text-[10px] tracking-[0.14em] text-stone-400 md:text-[11px]">{s.label}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const intro = (
    <>
      <Reveal delay={0}>
        <span className="lux-glass-chip !bg-[rgba(5,3,3,0.62)] text-[10px] text-stone-200">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--lux-gold)] opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--lux-gold)]" />
          </span>
          Marché sûr · Édition limitée
        </span>
      </Reveal>
      <Reveal delay={0.08}>
        <h1 className="lux-h1 lux-hero-title mt-8 text-stone-50">
          Le pouvoir, <em className="lux-gold-text">signé</em>.
        </h1>
      </Reveal>
      <Reveal delay={0.16}>
        <p className="mt-6 max-w-xl text-balance text-[15px] leading-relaxed text-stone-300 md:text-lg">
          Comptes eFootball certifiés, livrés après paiement confirmé par le serveur. Identité vérifiée,
          paiement échelonné possible.
        </p>
      </Reveal>
      <Reveal delay={0.24}>
        <div className="mt-10 flex flex-col items-center gap-3.5 sm:flex-row">
          <Magnetic strength={0.35}>
            <Link href="/offres" className="lux-btn lux-btn-gold group/btn">
              Explorer les comptes
            </Link>
          </Magnetic>
          <Magnetic strength={0.35}>
            <Link href="/register" className="lux-btn lux-btn-ghost group/btn">
              Créer mon compte
            </Link>
          </Magnetic>
        </div>
      </Reveal>
      <Reveal delay={0.3}>
        <div className="mt-8 flex items-center gap-3 text-[12px] text-stone-400">
          <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
          <span>Wave et Orange Money · vérification d’identité obligatoire</span>
        </div>
      </Reveal>
    </>
  );

  // Mouvement réduit : pas d'épinglage, dernière frame fixe, tout visible.
  if (reduce) {
    return (
      <section id="top" className="relative flex min-h-[100svh] flex-col overflow-hidden">
        <LuxHeroScrollFrames frame={frame} staticFrame={HERO_FRAME_COUNT - 1} className="absolute inset-0 opacity-50" />
        <div className="lux-hero-vignette pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-5 pb-10 pt-32 text-center md:px-8">
          {intro}
        </div>
        <div className="relative z-10 mx-auto w-full max-w-4xl px-5 pb-12 md:px-8">{statsBand}</div>
      </section>
    );
  }

  return (
    <section id="top" ref={trackRef} className="relative h-[270vh] md:h-[340vh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* Œuvre : séquence scrubée + recul de caméra */}
        <motion.div aria-hidden className="absolute inset-0 will-change-transform" style={{ scale: artScale, opacity: artOpacity }}>
          <LuxHeroScrollFrames frame={frame} className="absolute inset-0" />
        </motion.div>

        {/* Halo qui s'embrase avec la séquence, puis flash quand le logo se pose */}
        <motion.div aria-hidden className="lux-hero-halo pointer-events-none absolute inset-0" style={{ opacity: haloOpacity }} />
        <motion.div aria-hidden className="lux-hero-flash pointer-events-none absolute inset-0" style={{ opacity: flash }} />

        {/* Braises montantes */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {EMBERS.map((e, i) => (
            <span
              key={i}
              className="lux-ember"
              style={{ left: e.left, width: e.size, height: e.size, "--dur": `${e.duration}s`, animationDelay: `${e.delay}s` } as React.CSSProperties}
            />
          ))}
        </div>

        <div className="lux-hero-vignette pointer-events-none absolute inset-0" aria-hidden />

        {/* Bandes cinéma pendant la séquence */}
        <motion.div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[9vh] origin-top bg-black" style={{ scaleY: bars }} />
        <motion.div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[9vh] origin-bottom bg-black" style={{ scaleY: bars }} />

        {/* Temps 1 — la promesse */}
        <motion.div
          style={{ opacity: introOpacity, y: introY, scale: introScale, visibility: introVisibility }}
          className="relative z-10 mx-auto flex h-full w-full max-w-6xl flex-col items-center justify-center px-5 pb-10 pt-24 text-center md:px-8"
        >
          {intro}
        </motion.div>

        {/* Temps 3 — les chiffres réels, une fois le logo posé */}
        <motion.div
          style={{ opacity: statsOpacity, y: statsY }}
          className="absolute inset-x-0 bottom-6 z-30 mx-auto w-full max-w-4xl px-5 md:bottom-10 md:px-8"
        >
          {statsBand}
        </motion.div>

        {/* Progression de la séquence (rail vertical, desktop) */}
        <div className="pointer-events-none absolute right-6 top-1/2 z-30 hidden h-40 w-px -translate-y-1/2 bg-white/10 md:block" aria-hidden>
          <motion.div className="h-full w-full origin-top bg-[linear-gradient(180deg,#ffb08a,#e84724)]" style={{ scaleY: p }} />
        </div>

        <motion.div
          style={{ opacity: cueOpacity }}
          className={cx("pointer-events-none absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 text-[11px] text-stone-400")}
          aria-hidden
        >
          <span>Faites défiler</span>
          <span className="lux-cue-line" />
        </motion.div>
      </div>
    </section>
  );
}
