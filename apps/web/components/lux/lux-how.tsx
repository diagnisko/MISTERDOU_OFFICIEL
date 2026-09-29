"use client";

import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";
import Link from "next/link";
import { Reveal, SectionLabel, IgniteHeading } from "./lux-fx";
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

// Une étape s'allume quand le fil de braise l'atteint (et s'éteint si l'on remonte).
function HowStep({ step, progress, at, reduce }: { step: Step; progress: MotionValue<number>; at: number; reduce: boolean }) {
  const t = useT();
  const lit = useTransform(progress, [Math.max(0, at - 0.06), Math.min(1, at + 0.02)], [0, 1]);
  const dim = useTransform(lit, [0, 1], [0.45, 1]);
  const ringScale = useTransform(lit, [0, 1], [0.9, 1]);
  return (
    <div>
      <motion.span
        className="absolute left-0 top-0 z-10 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[rgba(232,71,36,0.35)] bg-[#120908] text-[var(--lux-gold-light)] md:relative"
        style={reduce ? undefined : { scale: ringScale }}
      >
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
          <div aria-hidden className="absolute bottom-6 left-[26px] top-6 w-px bg-white/10 md:hidden">
            <motion.div className="h-full w-full origin-top" style={{ scaleY: reduce ? 1 : line, background: "linear-gradient(180deg,#ff6a32,#7a1712)" }} />
          </div>

          <ol className="grid gap-10 md:grid-cols-4 md:gap-6">
            {STEPS.map((step, i) => (
              <li key={step.n} className="relative pl-20 md:pl-0">
                <HowStep step={step} progress={line} at={i / (STEPS.length - 1)} reduce={Boolean(reduce)} />
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