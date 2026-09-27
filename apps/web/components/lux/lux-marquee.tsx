"use client";

import { useRef } from "react";
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import { IconStar } from "./lux-icons";

const WORDS = ["Division 1", "Legend", "Ikon", "Epic", "Division 2", "Élite", "Rare", "Certifié"];
const BASE_SPEED = 2.2; // % de la piste par seconde

function wrap(min: number, max: number, v: number) {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
}

function Row() {
  return (
    <span className="flex shrink-0 items-center">
      {WORDS.map((w) => (
        <span key={w} className="flex items-center">
          <span className="lux-marquee-item whitespace-nowrap px-8">{w}</span>
          <IconStar filled className="lux-marquee-star" aria-hidden />
        </span>
      ))}
    </span>
  );
}

// Marquee piloté par le scroll : il défile seul, accélère avec la vitesse de
// défilement, suit son sens, et s'incline légèrement sous l'effort.
export function LuxMarquee() {
  const reduce = useReducedMotion();
  const baseX = useMotionValue(0);
  const direction = useRef(1);

  const { scrollY } = useScroll();
  const velocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const boost = useTransform(velocity, [-2500, 0, 2500], [-6, 0, 6], { clamp: false });
  const skew = useTransform(velocity, [-2500, 0, 2500], [7, 0, -7]);
  const x = useTransform(baseX, (v) => `${wrap(-50, 0, v)}%`);

  useAnimationFrame((_, delta) => {
    if (reduce) return;
    const b = boost.get();
    if (b < -0.05) direction.current = -1;
    else if (b > 0.05) direction.current = 1;
    const step = direction.current * BASE_SPEED * (delta / 1000) * (1 + Math.abs(b));
    baseX.set(baseX.get() - step);
  });

  return (
    <div className="lux-marquee relative py-6" aria-hidden>
      <motion.div className="flex w-max" style={reduce ? undefined : { x, skewX: skew }}>
        <Row />
        <Row />
      </motion.div>
    </div>
  );
}
