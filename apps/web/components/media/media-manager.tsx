"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, request } from "@/lib/api";
import { putFile } from "@/lib/upload";
import { useT } from "@/lib/i18n";
import { documentLocale, translate } from "@/lib/i18n-core";

// ---------------------------------------------------------------------------
// Médias publics d'une offre (captures, vidéos). Envoi direct vers le bucket
// public par URL signée, puis confirmation par l'API (qui vérifie le fichier).
// ---------------------------------------------------------------------------

type Media = {
  id: string;
  url: string;
  mimeType: string;
  kind: "image" | "video";
  sizeBytes: number;
  isPrimary: boolean;
};

type Limits = { image: number; video: number; imageBytes: number; videoBytes: number };

type Upload = { name: string; progress: number; error?: string };

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/webm";

function mb(bytes: number) {
  return translate(documentLocale(), "media.mb", { n: Math.round(bytes / 1024 / 1024) });
}

export function MediaManager({ productId }: { productId: string }) {
  const t = useT();
  const [items, setItems] = useState<Media[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await request<{ items: Media[]; limits: Limits }>(`/api/v1/products/${productId}/media`);
      setItems(data.items);
      setLimits(data.limits);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("media.unavailable"));
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendOne(file: File, slot: number) {
    const update = (patch: Partial<Upload>) =>
      setUploads((list) => list.map((u, i) => (i === slot ? { ...u, ...patch } : u)));
    try {
      const kind = file.type.startsWith("video/") ? "video" : "image";
      const max = kind === "video" ? limits?.videoBytes : limits?.imageBytes;
      if (max && file.size > max) throw new Error(t("media.tooBig", { max: mb(max) }));
      const ticket = await request<{ key: string; uploadUrl: string; headers: Record<string, string> }>(
        `/api/v1/products/${productId}/media/upload-url`,
        { method: "POST", body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }) },
      );
      await putFile(ticket.uploadUrl, file, ticket.headers, (p) => update({ progress: p }));
      await request(`/api/v1/products/${productId}/media`, {
        method: "POST",
        body: JSON.stringify({ key: ticket.key, mimeType: file.type }),
      });
      update({ progress: 1 });
    } catch (err) {
      update({ error: err instanceof ApiClientError || err instanceof Error ? err.message : t("media.sendFailed") });
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const list = Array.from(files);
    const base = uploads.length;
    setUploads((prev) => [...prev, ...list.map((f) => ({ name: f.name, progress: 0 }))]);
    for (let i = 0; i < list.length; i++) await sendOne(list[i]!, base + i);
    await load();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function makeCover(id: string) {
    setBusyId(id);
    try {
      await request(`/api/v1/products/${productId}/media/${id}/primary`, { method: "PATCH", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("media.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("media.confirmDelete"))) return;
    setBusyId(id);
    try {
      await request(`/api/v1/products/${productId}/media/${id}`, { method: "DELETE", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("media.deleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const images = items.filter((m) => m.kind === "image").length;
  const videos = items.filter((m) => m.kind === "video").length;
  const full = limits ? images >= limits.image && videos >= limits.video : false;
  const pending = uploads.filter((u) => u.progress < 1 && !u.error);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-[#8f7d77]">
          {limits
            ? t("media.limits", { images, maxImages: limits.image, imageMax: mb(limits.imageBytes), videos, maxVideos: limits.video, videoMax: mb(limits.videoBytes) })
            : t("media.loading")}
        </p>
        <label className={`dash-btn dash-btn-primary cursor-pointer ${full || pending.length > 0 ? "pointer-events-none opacity-55" : ""}`}>
          {t("media.add")}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            disabled={full || pending.length > 0}
            onChange={(event) => void onFiles(event.target.files)}
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-[#fca5a5]" role="alert">
          {error}
        </p>
      )}

      {uploads.length > 0 && (
        <ul className="mt-4 space-y-2" aria-live="polite">
          {uploads.map((u, i) => (
            <li key={`${u.name}-${i}`} className="rounded-xl border border-[rgba(255,236,229,0.08)] px-3 py-2 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-stone-200">{u.name}</span>
                <span className={u.error ? "text-[#fca5a5]" : u.progress >= 1 ? "text-[#86efac]" : "text-[#b8a6a1]"}>
                  {u.error ? t("media.failed") : u.progress >= 1 ? t("media.added") : `${Math.round(u.progress * 100)} %`}
                </span>
              </div>
              {u.error ? (
                <p className="mt-1 text-[#fca5a5]">{u.error}</p>
              ) : (
                <div className="dash-progress mt-1.5" aria-hidden>
                  <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-[rgba(255,236,229,0.12)] p-6 text-center text-[13px] text-[#8f7d77]">
          {t("media.empty")}
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-2xl border border-[rgba(255,236,229,0.08)] bg-black/30">
              <div className="relative aspect-video bg-black">
                {m.kind === "video" ? (
                  <video src={m.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
                <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white">
                  {m.isPrimary ? t("media.cover") : m.kind === "video" ? t("media.video") : mb(m.sizeBytes)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2">
                {m.kind === "image" && !m.isPrimary && (
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void makeCover(m.id)}
                    className="rounded-full border border-[rgba(255,236,229,0.12)] px-2.5 py-1 text-[11px] text-[#e9dad3] transition hover:border-[rgba(255,106,50,0.45)] disabled:opacity-50"
                  >
                    Couverture
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onClick={() => void remove(m.id)}
                  className="rounded-full border border-[rgba(252,165,165,0.3)] px-2.5 py-1 text-[11px] text-[#fca5a5] transition hover:bg-[rgba(239,68,68,0.1)] disabled:opacity-50"
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
