"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useMotionValue,
  type MotionValue,
  type Variants,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cx, SectionLabel } from "./lux-utils";

const EASE = [0.22, 1, 0.36, 1] as const;
export type Bezier = [number, number, number, number];
export const LUX_EASE: Bezier = [0.22, 1, 0.36, 1];

export type RevealFrom = "up" | "down" | "left" | "right";

const revealVariants: Record<RevealFrom, Variants> = {
  up: {
    hidden: { opacity: 0, y: 28, filter: "blur(6px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
  down: {
    hidden: { opacity: 0, y: -28, filter: "blur(6px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
  left: {
    hidden: { opacity: 0, x: -32, scale: 0.96, filter: "blur(6px)" },
    show: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)" },
  },
  right: {
    hidden: { opacity: 0, x: 32, scale: 0.96, filter: "blur(6px)" },
    show: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)" },
  },
};

interface RevealProps {
  children: ReactNode;
  from?: RevealFrom;
  delay?: number;
  duration?: number;
  className?: string;
}

// Scroll-reveal : seuil 15 %, rootMargin -12 %, 700 ms, easing luxe.
// prefers-reduced-motion → rendu direct à l'état final (visible).
/** Vrai quand la requête média correspond (faux au rendu serveur). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function Reveal({ children, from = "up", delay = 0, duration = 0.7, className }: RevealProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={revealVariants[from]}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15, margin: "-12% 0px" }}
      transition={{ duration, delay, ease: LUX_EASE }}
    >
      {children}
    </motion.div>
  );
}

interface MagneticProps {
  children: ReactNode;
  strength?: number;
  className?: string;
}

// Boutons magnétiques : attraction du pointeur, ressort 200/16.
export function Magnetic({ children, strength = 0.35, className }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 16 });
  const sy = useSpring(y, { stiffness: 200, damping: 16 });

  function onPointerMove(e: React.PointerEvent) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      style={{ x: sx, y: sy }}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Glissement parallaxe verté d'un orbe décoratif ancré à sa section (±100–140 px).
export function OrbGlide({
  targetRef,
  className,
  from = 0,
  to = 120,
  scaleFrom = 1,
  scaleTo = 1.08,
}: {
  targetRef: RefObject<HTMLElement | null>;
  className?: string;
  from?: number;
  to?: number;
  scaleFrom?: number;
  scaleTo?: number;
}) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: reduce ? undefined : targetRef,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [from, to]);
  const s = useTransform(scrollYProgress, [0, 1], [scaleFrom, scaleTo]);
  return <motion.div style={{ y, scale: s }} className={`lux-orb ${className ?? ""}`} aria-hidden />;
}

export type IgnitePart = { text: string; accent?: boolean };

// Titre qui s'embrase au scroll : chaque mot passe d'une braise éteinte à
// pleine lumière pendant que le titre traverse l'écran (piloté par le scroll,
// réversible). Le texte complet reste dans le DOM pour les lecteurs d'écran.
export function IgniteHeading({ parts, className }: { parts: IgnitePart[]; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: reduce ? undefined : ref,
    offset: ["start 90%", "start 35%"],
  });

  const tokens = parts.flatMap((part) =>
    part.text.split(/(\s+)/).filter(Boolean).map((text) => ({ text, accent: part.accent })),
  );
  const wordCount = tokens.filter((t) => !/^\s+$/.test(t.text)).length;
  let index = -1;

  return (
    <h2 ref={ref} className={className}>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token.text)) return token.text;
        index += 1;
        if (reduce) {
          return token.accent ? (
            <em key={i} className="lux-gold-text">{token.text}</em>
          ) : (
            <span key={i}>{token.text}</span>
          );
        }
        const start = index / wordCount;
        const end = Math.min(1, start + 1.6 / wordCount);
        return (
          <IgniteWord key={i} progress={scrollYProgress} range={[start, end]} accent={token.accent}>
            {token.text}
          </IgniteWord>
        );
      })}
    </h2>
  );
}

function IgniteWord({
  progress,
  range,
  accent,
  children,
}: {
  progress: MotionValue<number>;
  range: [number, number];
  accent?: boolean;
  children: ReactNode;
}) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  if (accent) {
    return (
      <motion.em className="lux-gold-text" style={{ opacity }}>
        {children}
      </motion.em>
    );
  }
  return <motion.span style={{ opacity }}>{children}</motion.span>;
}

// Primitives pures réexportées ici pour compatibilité : les écrans qui n’ont
// besoin que de `cx` / `SectionLabel` doivent importer `./lux-utils` afin de ne
// pas dépendre de ce module (et donc de motion).
export { cx, SectionLabel };
