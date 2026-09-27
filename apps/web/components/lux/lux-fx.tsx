"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useMotionValue,
  type Variants,
} from "motion/react";
import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
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

// Primitives pures réexportées ici pour compatibilité : les écrans qui n’ont
// besoin que de `cx` / `SectionLabel` doivent importer `./lux-utils` afin de ne
// pas dépendre de ce module (et donc de motion).
export { cx, SectionLabel };

export function useLuxStyle(props: CSSProperties): CSSProperties {
  return props;
}

// Chevron qui glisse au hover (boutons CTA).
export function SlidingArrow({ className }: { className?: string }) {
  return <IconArrowInline className={cx("transition-transform duration-300 group-hover/btn:translate-x-1", className)} />;
}

function IconArrowInline({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}