"use client";

import { useEffect, useRef } from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";

export const HERO_FRAME_COUNT = 20;
const SRC_W = 1920;
const SRC_H = 1080;
const PAGE_BG = "#050303";

function frameSrc(i: number) {
  return `/hero-scroll/frame-${String(i + 1).padStart(2, "0")}.jpg`;
}

interface LuxHeroScrollFramesProps {
  /** Position dans la séquence, en frames (0 → HERO_FRAME_COUNT - 1), fractionnaire. */
  frame: MotionValue<number>;
  /** Frame affichée tant que rien ne pilote la séquence (reduced motion). */
  staticFrame?: number;
  className?: string;
}

// Séquence scrubée au scroll. Entre deux frames on dessine un fondu enchaîné
// (frame n, puis n+1 à l'opacité fractionnaire) : 20 images suffisent pour un
// mouvement continu. Dessin canvas impératif, aucun re-render React par frame.
export function LuxHeroScrollFrames({ frame, staticFrame, className }: LuxHeroScrollFramesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const readyRef = useRef<boolean[]>(Array(HERO_FRAME_COUNT).fill(false));
  const positionRef = useRef(staticFrame ?? 0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef(0);

  function blit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
    // Écran en hauteur (téléphone) : l'image entière sur toute la largeur, le
    // fond noir des sources se fond dans la page. Sinon : plein cadre.
    if (w < h) {
      const dh = (w / SRC_W) * SRC_H;
      ctx.drawImage(img, 0, (h - dh) / 2, w, dh);
      return;
    }
    const scale = Math.max(w / SRC_W, h / SRC_H);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(img, (SRC_W - sw) / 2, (SRC_H - sh) / 2, sw, sh, 0, 0, w, h);
  }

  function nearestReady(index: number) {
    for (let d = 0; d < HERO_FRAME_COUNT; d++) {
      if (readyRef.current[index - d]) return index - d;
      if (readyRef.current[index + d]) return index + d;
    }
    return -1;
  }

  function draw() {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const { w, h } = sizeRef.current;
    if (!ctx || w === 0 || h === 0) return;
    const pos = Math.min(HERO_FRAME_COUNT - 1, Math.max(0, positionRef.current));
    const a = nearestReady(Math.floor(pos));
    if (a < 0) return;
    const b = Math.min(HERO_FRAME_COUNT - 1, Math.floor(pos) + 1);
    const t = pos - Math.floor(pos);

    ctx.globalAlpha = 1;
    ctx.fillStyle = w < h ? PAGE_BG : "#000";
    ctx.fillRect(0, 0, w, h);
    blit(ctx, imagesRef.current[a]!, w, h);
    if (t > 0.01 && b !== a && readyRef.current[b]) {
      ctx.globalAlpha = t;
      blit(ctx, imagesRef.current[b]!, w, h);
      ctx.globalAlpha = 1;
    }
    if (w < h) fadeEdges(ctx, w, h);
  }

  // Téléphone : bords haut et bas de l'image fondus dans la page (pas de cadre visible).
  function fadeEdges(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const dh = (w / SRC_W) * SRC_H;
    const top = (h - dh) / 2;
    const band = dh * 0.22;
    for (const [from, to] of [[top, top + band], [top + dh, top + dh - band]] as const) {
      const g = ctx.createLinearGradient(0, from, 0, to);
      g.addColorStop(0, PAGE_BG);
      g.addColorStop(1, "rgba(5, 3, 3, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(from, to) - 1, w, band + 2);
    }
  }

  function schedule() {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;

    function resize() {
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
      schedule();
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas) ro.observe(canvas);

    // Première frame (et celle demandée en statique) d'abord, le reste ensuite.
    const first = staticFrame ?? 0;
    const order = [first, ...Array.from({ length: HERO_FRAME_COUNT }, (_, i) => i).filter((i) => i !== first)];
    for (const i of order) {
      const img = new window.Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        readyRef.current[i] = true;
        schedule();
      };
      img.src = frameSrc(i);
      imagesRef.current[i] = img;
    }

    return () => {
      cancelled = true;
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMotionValueEvent(frame, "change", (value) => {
    if (staticFrame !== undefined) return;
    positionRef.current = value;
    schedule();
  });

  return (
    <div className={className} aria-hidden>
      <link rel="preload" as="image" href={frameSrc(staticFrame ?? 0)} fetchPriority="high" />
      {/* Fond noir des sources ≈ fond de page (#050303) : pas besoin de fusion coûteuse. */}
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
