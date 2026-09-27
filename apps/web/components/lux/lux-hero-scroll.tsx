"use client";

import { useEffect, useRef } from "react";
import { useMotionValueEvent, useReducedMotion, type MotionValue } from "motion/react";

const FRAME_COUNT = 20;
const FRAME_BASE = "/hero-scroll/frame-";
// Dimensions intrinsèques des sources (1920×1080) — sert au recadrage "cover".
const SRC_W = 1920;
const SRC_H = 1080;

function frameSrc(i: number) {
  return `${FRAME_BASE}${String(i + 1).padStart(2, "0")}.jpg`;
}

interface LuxHeroScrollFramesProps {
  /** Défilement vertical (px) du conteneur hero — même source que le reste du parallaxe. */
  scrollY: MotionValue<number>;
  /** Plage de scroll (px) sur laquelle les 20 frames se déroulent. */
  range?: [number, number];
  className?: string;
}

// Séquence d'images "scrubée" par le scroll (20 frames extraites, decode une
// seule fois par frame). Dessin canvas impératif — aucun re-render React par
// frame, conforme à la règle "performance > animation" (§27/§28). Le fond
// noir des sources devient transparent via mix-blend-mode: screen, laissant
// uniquement la lueur incandescente visible sur le fond de la page.
export function LuxHeroScrollFrames({ scrollY, range = [0, 900], className }: LuxHeroScrollFramesProps) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const readyRef = useRef<boolean[]>(Array(FRAME_COUNT).fill(false));
  const currentFrameRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  function draw(index: number) {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas || !img || !readyRef.current[index]) return;
    const ctx = canvas.getContext("2d");
    const { w, h } = sizeRef.current;
    if (!ctx || w === 0 || h === 0) return;
    const scale = Math.max(w / SRC_W, h / SRC_H);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (SRC_W - sw) / 2;
    const sy = (SRC_H - sh) / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  }

  function resize() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    sizeRef.current = { w, h };
    draw(currentFrameRef.current);
  }

  useEffect(() => {
    let cancelled = false;
    currentFrameRef.current = reduce ? FRAME_COUNT - 1 : 0;
    resize();

    const ro = new ResizeObserver(resize);
    if (canvasRef.current) ro.observe(canvasRef.current);

    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new window.Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        readyRef.current[i] = true;
        if (i === currentFrameRef.current) draw(i);
      };
      img.src = frameSrc(i);
      imagesRef.current[i] = img;
    }

    return () => {
      cancelled = true;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  useMotionValueEvent(scrollY, "change", (value) => {
    if (reduce) return;
    const [from, to] = range;
    const progress = Math.min(1, Math.max(0, (value - from) / (to - from)));
    const index = Math.min(FRAME_COUNT - 1, Math.round(progress * (FRAME_COUNT - 1)));
    if (index !== currentFrameRef.current && readyRef.current[index]) {
      currentFrameRef.current = index;
      draw(index);
    }
  });

  return (
    <div className={className} aria-hidden>
      {/* Amorce le décodage de la première frame dès le head (LCP hero). */}
      <link rel="preload" as="image" href={frameSrc(0)} fetchPriority="high" />
      <canvas ref={canvasRef} className="block h-full w-full" style={{ mixBlendMode: "screen" }} />
    </div>
  );
}
