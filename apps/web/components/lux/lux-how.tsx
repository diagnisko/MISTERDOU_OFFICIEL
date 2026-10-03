"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Reveal, SectionLabel, IgniteHeading, useMediaQuery } from "./lux-fx";
import { IconArrowRight, IconCheck, IconLock, IconCard, IconPhone } from "./lux-icons";
import { useT, type MessageKey } from "@/lib/i18n";

type Step = { icon: typeof IconPhone; n: string; title: MessageKey; body: MessageKey };

const STEPS: Step[] = [
  {
    icon: IconPhone,
    n: "01",
    title: "how.s1Title",
    body: "how.s1Body",
  },
  {
    icon: IconCheck,
    n: "02",
    title: "how.s2Title",
    body: "how.s2Body",
  },
  {
    icon: IconCard,
    n: "03",
    title: "how.s3Title",
    body: "how.s3Body",
  },
  {
    icon: IconLock,
    n: "04",
    title: "how.s4Title",
    body: "how.s4Body",
  },
];

// Téléphone : hauteur de l'écran (depuis le haut) où se trouve la pointe du fil.
const READ_MARK = 0.62;
const RING = 52;

type StepProps = {
  step: Step;
  progress: MotionValue<number>;
  /** Position (0 → 1 sur le fil) où l'étape s'allume. */
  at: number;
  reduce: boolean;
  /** Téléphone : le néon s'allume d'un coup quand la pointe touche le cercle. */
  trigger: boolean;
};

// Une étape s'allume quand le fil de braise l'atteint (et s'éteint si l'on remonte).
function HowStep({ step, progress, at, reduce, trigger }: StepProps) {
  const t = useT();
  const scrub = useTransform(progress, [Math.max(0, at - 0.06), Math.min(1, at + 0.02)], [0, 1]);
  const pulse = useMotionValue(0);
  const burst = useMotionValue(0);
  const onRef = useRef(false);

  useEffect(() => {
    if (!trigger) return;
    const check = (v: number) => {
      const on = v > Math.max(at, 0.002);
      if (on === onRef.current) return;
      onRef.current = on;
      animate(pulse, on ? 1 : 0, { duration: on ? 0.45 : 0.3, ease: [0.22, 1, 0.36, 1] });
      if (on) animate(burst, [0, 1], { duration: 0.8, ease: "easeOut" });
    };
    check(progress.get());
    return progress.on("change", check);
  }, [trigger, progress, at, pulse, burst]);

  // Le composant est remonté quand le mode change (clé) : `lit` reste stable.
  const lit = trigger ? pulse : scrub;
  const dim = useTransform(lit, [0, 1], [0.45, 1]);
  const ringScale = useTransform(lit, [0, 1], [0.9, 1]);
  const burstScale = useTransform(burst, [0, 1], [1, 1.9]);
  const burstOpacity = useTransform(burst, [0, 0.12, 1], [0, 0.9, 0]);
  return (
    <div>
      <motion.span
        className="absolute left-0 top-0 z-10 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[rgba(232,71,36,0.35)] bg-[#120908] text-[var(--lux-gold-light)] md:relative"
        style={reduce ? undefined : { scale: ringScale }}
      >
        {trigger && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-[-1px] rounded-full border border-[rgba(255,140,90,0.9)]"
            style={{ scale: burstScale, opacity: burstOpacity, boxShadow: "0 0 18px rgba(255,106,50,0.8)" }}
          />
        )}
        <motion.span
          aria-hidden
          className="absolute inset-[-1px] rounded-full"
          style={{
            opacity: reduce ? 1 : lit,
            background: "radial-gradient(circle, rgba(232,71,36,0.35), transparent 70%)",
            boxShadow: "0 0 0 1px rgba(255,106,50,0.8), 0 0 34px -4px rgba(232,71,36,0.9)",
          }}
        />
        <step.icon className="relative h-5 w-5" aria-hidden />
      </motion.span>
      <motion.div style={reduce ? undefined : { opacity: dim }}>
        <div className="lux-serif text-[40px] font-semibold leading-none text-transparent [-webkit-text-stroke:1px_rgba(255,106,50,0.6)] md:mt-6">
          {step.n}
        </div>
        <h3 className="lux-serif mt-3 text-[20px] font-semibold text-stone-100">{t(step.title)}</h3>
        <p className="mt-2.5 max-w-xs text-[13.5px] leading-relaxed text-stone-400">{t(step.body)}</p>
      </motion.div>
    </div>
  );
}

export function LuxHow() {
  const t = useT();
  const reduce = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: reduce ? undefined : trackRef,
    offset: ["start 75%", "end 55%"],
  });
  const line = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  // Téléphone : le fil va du premier au dernier cercle et sa pointe suit un
  // point fixe de l'écran (READ_MARK). Positions mesurées sur la page.
  const phone = useMediaQuery("(max-width: 767px)");
  const listRef = useRef<HTMLOListElement>(null);
  // Début du fil (depuis le haut du bloc) et longueur, en pixels.
  const geo = useRef({ start: 0, height: 1 });
  const [rail, setRail] = useState<{ top: number; height: number; stops: number[] } | null>(null);
  const { scrollY } = useScroll();
  // Position lue en direct : les sections au-dessus changent de hauteur en
  // s'affichant (rendu différé), une position mémorisée deviendrait fausse.
  const railRaw = useTransform(scrollY, () => {
    const track = trackRef.current;
    if (!track) return 0;
    const { start, height } = geo.current;
    const top = track.getBoundingClientRect().top + start;
    return Math.min(1, Math.max(0, (window.innerHeight * READ_MARK - top) / height));
  });
  const railProgress = useSpring(railRaw, { stiffness: 160, damping: 26, restDelta: 0.0005 });
  const tipY = useTransform(railProgress, (v) => v * geo.current.height);
  const tipOpacity = useTransform(railProgress, [0, 0.01, 0.985, 1], [0, 1, 1, 0]);

  useEffect(() => {
    if (!phone) return;
    const track = trackRef.current;
    const list = listRef.current;
    if (!track || !list) return;
    const measure = () => {
      const items = Array.from(list.children) as HTMLElement[];
      if (items.length < 2) return;
      const box = track.getBoundingClientRect();
      // Le cercle est en haut de chaque étape : son bord haut = haut de l'élément de liste.
      const tops = items.map((li) => li.getBoundingClientRect().top - box.top);
      const start = tops[0]! + RING / 2;
      const height = Math.max(1, tops[tops.length - 1]! + RING / 2 - start);
      geo.current = { start, height };
      setRail({ top: start, height, stops: tops.map((top) => Math.max(0, (top - start) / height)) });
      scrollY.set(window.scrollY);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [phone, scrollY]);
  const railMode = phone && rail !== null && !reduce;

  return (
    <section id="parcours" className="relative px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionLabel>{t("how.label")}</SectionLabel>
        </Reveal>
        <IgniteHeading
          className="lux-h2 mt-5 max-w-2xl text-stone-100"
          parts={[{ text: t("how.h1") }, { text: t("how.h2"), accent: true }]}
        />

        <div ref={trackRef} className="relative mt-16">
          {/* Fil de braise tracé par le scroll : horizontal desktop, vertical mobile */}
          <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-[26px] hidden h-px bg-white/10 md:block">
            <motion.div className="h-full w-full origin-left" style={{ scaleX: reduce ? 1 : line, background: "var(--lux-ember-gradient)" }} />
          </div>
          <div
            aria-hidden
            className="absolute left-[26px] w-px bg-white/10 md:hidden"
            style={rail ? { top: rail.top, height: rail.height } : { top: 24, bottom: 24 }}
          >
            <motion.div
              className="h-full w-full origin-top"
              style={{ scaleY: reduce ? 1 : railMode ? railProgress : line, background: "linear-gradient(180deg,#ff6a32,#7a1712)" }}
            />
            {railMode && (
              <motion.span
                className="absolute -left-[3px] -top-[3.5px] h-[7px] w-[7px] rounded-full bg-[#ffd9c2]"
                style={{ y: tipY, opacity: tipOpacity, boxShadow: "0 0 10px 3px rgba(255,106,50,0.85)" }}
              />
            )}
          </div>

          <ol ref={listRef} className="grid gap-10 md:grid-cols-4 md:gap-6">
            {STEPS.map((step, i) => (
              <li key={step.n} className="relative pl-20 md:pl-0">
                <HowStep
                  key={railMode ? "rail" : "line"}
                  step={step}
                  progress={railMode ? railProgress : line}
                  at={railMode ? rail!.stops[i]! : i / (STEPS.length - 1)}
                  reduce={Boolean(reduce)}
                  trigger={railMode}
                />
              </li>
            ))}
          </ol>

          {/* Le détail complet (délais, cas des mensualités, remboursement)
              vit sur sa propre page : l'accueil garde le résumé, pas le
              duplicata — deux versions du même texte divergent toujours. */}
          <Reveal delay={0.1} className="mt-14 flex justify-center">
            <Link href="/comment-ca-marche" className="lux-btn lux-btn-ghost group/btn" style={{ borderRadius: 18 }}>
              {t("how.details")}
              <IconArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1"
                aria-hidden
              />
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}