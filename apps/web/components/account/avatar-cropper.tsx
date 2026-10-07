"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Cadrage de la photo de profil : on place son visage dans un cercle (glisser à
// la souris ou au doigt, zoom au curseur, à la molette ou à deux doigts,
// flèches et + / − au clavier, rotation d'un quart de tour) avant l'envoi.
// Le résultat est un carré JPEG de 512 px : partout sur le site la photo est
// affichée en cercle, exactement comme ici.
// ---------------------------------------------------------------------------

const OUTPUT = 512;
const CIRCLE = 0.8; // part de la zone occupée par le cercle
const MAX_ZOOM = 4;

type Source = { canvas: HTMLCanvasElement; w: number; h: number };
type View = { zoom: number; x: number; y: number };

/** Image décodée (orientation de l'appareil photo respectée), tournée de rot quarts de tour. */
function rotatedSource(bitmap: ImageBitmap, rot: number): Source {
  const turned = rot % 2 === 1;
  const w = turned ? bitmap.height : bitmap.width;
  const h = turned ? bitmap.width : bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  return { canvas, w, h };
}

export function AvatarCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const [rot, setRot] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [stage, setStage] = useState(320);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  // Décodage (Safari lit aussi le HEIC des iPhone).
  useEffect(() => {
    let alive = true;
    let decoded: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bmp) => {
        decoded = bmp;
        if (alive) setBitmap(bmp);
        else bmp.close();
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      decoded?.close();
    };
  }, [file]);

  useEffect(() => {
    if (!bitmap) return;
    setSource(rotatedSource(bitmap, rot));
    setView({ zoom: 1, x: 0, y: 0 });
  }, [bitmap, rot]);

  // Taille de la zone (s'adapte à l'écran du téléphone).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStage(el.clientWidth));
    observer.observe(el);
    setStage(el.clientWidth);
    return () => observer.disconnect();
  }, [source]);

  const diameter = stage * CIRCLE;
  /** Échelle image → écran : au zoom 1, l'image couvre juste le cercle. */
  const scaleFor = useCallback(
    (zoom: number) => (source ? (diameter / Math.min(source.w, source.h)) * zoom : 1),
    [source, diameter],
  );

  /** Le cercle reste toujours entièrement dans la photo. */
  const clamp = useCallback(
    (next: View): View => {
      if (!source) return next;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
      const k = scaleFor(zoom);
      const maxX = Math.max(0, (source.w * k - diameter) / 2);
      const maxY = Math.max(0, (source.h * k - diameter) / 2);
      return { zoom, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
    },
    [source, scaleFor, diameter],
  );

  /** Zoom autour du centre : le cadrage choisi ne saute pas. */
  const zoomTo = useCallback(
    (zoom: number) =>
      setView((v) => {
        const ratio = scaleFor(Math.min(MAX_ZOOM, Math.max(1, zoom))) / scaleFor(v.zoom);
        return clamp({ zoom, x: v.x * ratio, y: v.y * ratio });
      }),
    [clamp, scaleFor],
  );

  // Dessin de la zone et de l'aperçu.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage * dpr);
    canvas.height = Math.round(stage * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage, stage);
    const k = scaleFor(view.zoom);
    const w = source.w * k;
    const h = source.h * k;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.canvas, stage / 2 - w / 2 + view.x, stage / 2 - h / 2 + view.y, w, h);

    const preview = previewRef.current;
    if (preview) {
      const size = 64 * dpr;
      preview.width = size;
      preview.height = size;
      const p = preview.getContext("2d")!;
      const src = cropRect(source, k, view, diameter);
      p.imageSmoothingQuality = "high";
      p.drawImage(source.canvas, src.sx, src.sy, src.size, src.size, 0, 0, size, size);
    }
  }, [source, view, stage, scaleFor, diameter]);

  // Glisser (souris, doigt) et pincer à deux doigts.
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, current);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
      return;
    }
    setView((v) => clamp({ ...v, x: v.x + current.x - previous.x, y: v.y + current.y - previous.y }));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // Molette : zoom (sans faire défiler la page).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * Math.exp(-event.deltaY * 0.0015)));
        const ratio = scaleFor(zoom) / scaleFor(v.zoom);
        return clamp({ zoom, x: v.x * ratio, y: v.y * ratio });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clamp, scaleFor, source]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 20 : 6;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setView((v) => clamp({ ...v, x: v.x + move[0], y: v.y + move[1] }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(view.zoom * 1.1);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomTo(view.zoom / 1.1);
    }
  }

  // Échap : annuler.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function confirm() {
    if (!source) return;
    setBusy(true);
    try {
      const out = document.createElement("canvas");
      out.width = OUTPUT;
      out.height = OUTPUT;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; // zones transparentes d'un PNG
      ctx.fillRect(0, 0, OUTPUT, OUTPUT);
      ctx.imageSmoothingQuality = "high";
      const src = cropRect(source, scaleFor(view.zoom), view, diameter);
      ctx.drawImage(source.canvas, src.sx, src.sy, src.size, src.size, 0, 0, OUTPUT, OUTPUT);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error(t("crop.unreadable"));
      await onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }

  // Rendue à la racine de la page : au-dessus de l'en-tête du site, quel que soit le parent.
  return createPortal(
    <div
      className="fixed inset-0 z-[300] grid place-items-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="crop-title" className="dash-card my-auto w-full max-w-[420px] p-5 sm:p-6">
        <h2 id="crop-title" className="text-[17px] font-semibold text-white">
          {t("crop.title")}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#b8a6a1]">{t("crop.lead")}</p>

        {failed ? (
          <p className="mt-5 rounded-xl border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-4 py-3 text-[13px] text-stone-100">
            {t("crop.unreadable")}
          </p>
        ) : !source ? (
          <p className="mt-5 flex aspect-square items-center justify-center gap-2 rounded-2xl bg-black/40 text-[13px] text-[#b8a6a1]">
            <Spinner /> {t("crop.loading")}
          </p>
        ) : (
          <>
            <div
              ref={stageRef}
              role="application"
              tabIndex={0}
              aria-label={t("crop.stage")}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              className="crop-stage relative mt-5 aspect-square w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,138,92,0.6)] active:cursor-grabbing"
            >
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
              {/* Voile hors du cercle + anneau : ce qui sera visible sur le profil. */}
              <span
                aria-hidden
                className="crop-ring pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ width: diameter, height: diameter }}
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => zoomTo(view.zoom / 1.15)}
                aria-label={t("crop.zoomOut")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-stone-300 transition hover:text-white"
              >
                <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 12h12" />
                </svg>
              </button>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={view.zoom}
                onChange={(event) => zoomTo(Number(event.target.value))}
                aria-label={t("crop.zoom")}
                className="crop-range min-w-0 flex-1"
                style={{ ["--fill" as string]: `${((view.zoom - 1) / (MAX_ZOOM - 1)) * 100}%` }}
              />
              <button
                type="button"
                onClick={() => zoomTo(view.zoom * 1.15)}
                aria-label={t("crop.zoomIn")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-stone-300 transition hover:text-white"
              >
                <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 12h12M12 6v12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <canvas ref={previewRef} aria-label={t("crop.preview")} className="h-16 w-16 rounded-full ring-2 ring-[rgba(255,138,92,0.55)] ring-offset-2 ring-offset-[#120b09]" />
                <span className="text-[11px] uppercase tracking-[0.18em] text-[#8f7d77]">{t("crop.preview")}</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setRot((r) => (r + 1) % 4)}
                  className="rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-stone-300 transition hover:text-white"
                >
                  {t("crop.rotate")}
                </button>
                <button
                  type="button"
                  onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
                  className="rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-stone-300 transition hover:text-white"
                >
                  {t("crop.reset")}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="dash-btn dash-btn-ghost">
            {t("crop.cancel")}
          </button>
          <button type="button" onClick={() => void confirm()} disabled={busy || !source} className="dash-btn dash-btn-primary disabled:opacity-60">
            {busy && <Spinner />} {t("crop.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Carré de l'image (en pixels de la photo) sous le cercle. */
function cropRect(source: Source, k: number, view: View, diameter: number) {
  const size = diameter / k;
  return { sx: source.w / 2 - view.x / k - size / 2, sy: source.h / 2 - view.y / k - size / 2, size };
}
