"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";
import { putFile } from "@/lib/upload";
import { prepareChatImage } from "@/lib/media-prepare";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Photos dans les messages (bouton « + ») : images seulement, 5 au plus par
// message. Chaque photo est redessinée dans le navigateur (position GPS
// effacée), envoyée dans l'espace privé, puis jointe au message par sa clé.
// ---------------------------------------------------------------------------

export const MAX_CHAT_IMAGES = 5;

export type MessageImage = { id: string; url: string | null; expired: boolean };
export type AttachedImage = { key: string; mimeType: string };

type Pending = { id: string; preview: string; state: "uploading" | "ready" | "error"; key?: string; mimeType?: string };

export function useChatImages() {
  const t = useT();
  const [items, setItems] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Set<string>());

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const add = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const room = MAX_CHAT_IMAGES - items.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      if (files.length > room) setError(t("chatimg.max"));
      for (const file of picked) {
        const id = Math.random().toString(36).slice(2);
        const preview = URL.createObjectURL(file);
        urls.current.add(preview);
        setItems((list) => [...list, { id, preview, state: "uploading" }]);
        try {
          const ready = await prepareChatImage(file);
          if (!ready) throw new Error(t("chatimg.imagesOnly"));
          const upload = await request<{ key: string; uploadUrl: string; headers: Record<string, string> }>("/api/v1/chat-images/upload-url", {
            method: "POST",
            body: JSON.stringify({ mimeType: ready.mime, sizeBytes: ready.blob.size }),
          });
          await putFile(upload.uploadUrl, ready.blob, upload.headers);
          setItems((list) => list.map((i) => (i.id === id ? { ...i, state: "ready", key: upload.key, mimeType: ready.mime } : i)));
        } catch (err) {
          setError(err instanceof Error && err.message ? err.message : t("chatimg.failed"));
          setItems((list) => list.map((i) => (i.id === id ? { ...i, state: "error" } : i)));
        }
      }
    },
    [items.length, t],
  );

  const remove = useCallback((id: string) => setItems((list) => list.filter((i) => i.id !== id)), []);
  const reset = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);

  const ready: AttachedImage[] = items.filter((i) => i.state === "ready").map((i) => ({ key: i.key!, mimeType: i.mimeType! }));
  return { items, ready, uploading: items.some((i) => i.state === "uploading"), full: items.length >= MAX_CHAT_IMAGES, error, add, remove, reset };
}

export type ChatImagesState = ReturnType<typeof useChatImages>;

/** Bouton « + » du compositeur. */
export function AttachButton({ state, disabled }: { state: ChatImagesState; disabled?: boolean }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void state.add(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || state.full}
        aria-label={t("chatimg.add")}
        title={t("chatimg.add")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-[22px] leading-none text-[#ffb08a] transition hover:border-[rgba(255,106,50,0.5)] hover:bg-white/[0.04] disabled:opacity-40"
      >
        +
      </button>
    </>
  );
}

/** Photos en attente d'envoi (au-dessus du champ de saisie). */
export function PendingImages({ state }: { state: ChatImagesState }) {
  const t = useT();
  if (state.items.length === 0 && !state.error) return null;
  return (
    <div className="space-y-1.5">
      {state.items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {state.items.map((item) => (
            <li key={item.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local */}
              <img
                src={item.preview}
                alt=""
                className={`h-16 w-16 rounded-lg object-cover ${item.state === "uploading" ? "opacity-50" : ""} ${item.state === "error" ? "ring-2 ring-[#ef4444]" : ""}`}
              />
              <button
                type="button"
                onClick={() => state.remove(item.id)}
                aria-label={t("chatimg.remove")}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-[11px] text-white"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.uploading && <p className="text-[11px] text-[#b8a6a1]">{t("chatimg.uploading")}</p>}
      {state.error && <p className="text-[11px] text-[#fca5a5]">{state.error}</p>}
    </div>
  );
}

/** Photos d'un message reçu ou envoyé. */
export function MessageImages({ images }: { images?: MessageImage[] }) {
  const t = useT();
  if (!images || images.length === 0) return null;
  return (
    <div className={`mt-1.5 grid gap-1.5 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {images.map((image) =>
        image.url ? (
          <a key={image.id} href={image.url} target="_blank" rel="noreferrer" aria-label={t("chatimg.open")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- lien signé de courte durée */}
            <img src={image.url} alt={t("chatimg.photo")} loading="lazy" className="max-h-60 w-full rounded-xl object-cover" />
          </a>
        ) : (
          <span key={image.id} className="grid h-20 place-items-center rounded-xl border border-dashed border-white/15 text-[11px] text-stone-400">
            {t("chatimg.expired")}
          </span>
        ),
      )}
    </div>
  );
}
