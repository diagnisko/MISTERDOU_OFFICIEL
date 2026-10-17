"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Button, FieldError, TextInput, invalidCls } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
import { siteVideosApi, youtubeThumbnail, type SiteVideo } from "@/lib/site-videos";
import { errorMessage } from "../_lib/api";
import { ConfirmDialog } from "../_lib/ui";

// ---------------------------------------------------------------------------
// Paramètres → Vidéos de « Comment ça marche ». « + » ajoute un lien YouTube ;
// le site lit le format chez YouTube (en largeur, ou en hauteur pour un Short)
// et réserve un cadre aux bonnes proportions. Chaque vidéo a une accroche
// (facultative), un ordre, et peut être retirée.
// ---------------------------------------------------------------------------

export function VideosCard() {
  const [videos, setVideos] = useState<SiteVideo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SiteVideo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVideos(await siteVideosApi.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, action: () => Promise<unknown>, done: string) {
    setBusyId(id);
    setRowError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(done);
    } catch (err) {
      setRowError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="lux-glass mt-6 rounded-[20px] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <p className="lux-kicker">Page « Comment ça marche »</p>
          <h2 className="mt-2 text-[16px] font-semibold text-stone-100">Vidéos</h2>
          <p className="mt-1 text-xs leading-relaxed text-stone-400">
            Collez un lien YouTube : la vidéo s’affiche en haut de « Comment ça marche », dans un cadre à son format (en largeur, ou en
            hauteur pour un Short). Les visiteurs la regardent sans quitter le site, et YouTube compte la vue.
          </p>
        </div>
        <a
          href="/comment-ca-marche"
          target="_blank"
          rel="noopener"
          className="shrink-0 rounded-full border border-white/10 px-3.5 py-1.5 text-[12px] text-stone-300 transition hover:border-[rgba(255,106,50,0.45)] hover:text-white"
        >
          Voir la page ↗
        </a>
      </div>

      {loadError && (
        <div className="mt-4">
          <Alert tone="danger">{loadError}</Alert>
        </div>
      )}
      {notice && <p className="mt-4 text-[12.5px] text-[#6ee7b7]">{notice}</p>}
      {rowError && <p className="mt-4 text-[12.5px] text-[#fca5a5]">{rowError}</p>}

      <ul className="mt-5 space-y-3">
        {videos?.length === 0 && <li className="text-[13px] text-stone-500">Aucune vidéo pour l’instant : la page commence directement par le texte.</li>}
        {videos?.map((video, index) => (
          <VideoRow
            key={video.id}
            video={video}
            index={index}
            last={index === videos.length - 1}
            busy={busyId === video.id}
            onRename={(title) => run(video.id, () => siteVideosApi.rename(video.id, title), "Accroche enregistrée.")}
            onMove={(direction) => run(video.id, () => siteVideosApi.move(video.id, direction), "Ordre enregistré.")}
            onRemove={() => setRemoving(video)}
          />
        ))}
      </ul>

      {adding ? (
        <AddVideoForm
          onCancel={() => setAdding(false)}
          onAdded={async (video) => {
            setAdding(false);
            await load();
            setNotice(`Vidéo ajoutée${video.vertical ? " (format court, en hauteur)" : ""}.`);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setNotice(null);
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-[rgba(255,170,120,0.45)] px-4 py-2 text-[13px] font-medium text-[var(--lux-gold-light)] transition hover:bg-[rgba(232,71,36,0.08)]"
        >
          <span aria-hidden className="text-[16px] leading-none">+</span>
          Ajouter une vidéo
        </button>
      )}

      {removing && (
        <ConfirmDialog
          title="Retirer cette vidéo"
          confirmLabel="Retirer"
          danger
          message={
            <>
              Retirer « {removing.title ?? removing.youtubeTitle ?? "cette vidéo"} » de la page « Comment ça marche » ? La vidéo reste sur
              YouTube.
            </>
          }
          onConfirm={async () => {
            await siteVideosApi.remove(removing.id);
            setRemoving(null);
            await load();
            setNotice("Vidéo retirée de la page.");
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function VideoRow({
  video,
  index,
  last,
  busy,
  onRename,
  onMove,
  onRemove,
}: {
  video: SiteVideo;
  index: number;
  last: boolean;
  busy: boolean;
  onRename: (title: string | null) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(video.title ?? "");
  useEffect(() => setTitle(video.title ?? ""), [video.title]);
  const changed = title.trim() !== (video.title ?? "");

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-center">
      <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noopener" className="relative block shrink-0 self-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniature fournie par YouTube */}
        <img src={youtubeThumbnail(video.videoId)} alt="" className="h-[72px] w-[128px] rounded-xl object-cover" loading="lazy" />
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-stone-200">
          {index === 0 ? "À la une" : `Vidéo ${index + 1}`}
        </span>
        {video.vertical && (
          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-[rgba(232,71,36,0.85)] px-2 py-0.5 text-[10px] font-semibold text-white">
            Short
          </span>
        )}
      </a>

      <div className="min-w-0 flex-1">
        <label className="block text-[11px] text-stone-500" htmlFor={`video-title-${video.id}`}>
          Accroche affichée sur la vidéo
        </label>
        <div className="mt-1 flex gap-2">
          <TextInput
            id={`video-title-${video.id}`}
            value={title}
            maxLength={120}
            placeholder={video.youtubeTitle ?? "Titre de la vidéo"}
            onChange={(event) => setTitle(event.target.value)}
          />
          {changed && (
            <Button type="button" loading={busy} onClick={() => onRename(title.trim() || null)}>
              Enregistrer
            </Button>
          )}
        </div>
        <p className="mt-1 truncate text-[11px] text-stone-500">
          {video.vertical ? "Format court, en hauteur" : "Format classique, en largeur"}
          {!video.title && video.youtubeTitle ? " · sans accroche : le titre YouTube s’affiche" : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <IconButton label="Monter" disabled={busy || index === 0} onClick={() => onMove("up")}>
          ↑
        </IconButton>
        <IconButton label="Descendre" disabled={busy || last} onClick={() => onMove("down")}>
          ↓
        </IconButton>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded-full border border-[rgba(239,68,68,0.35)] px-3.5 py-1.5 text-[12.5px] font-medium text-[#fca5a5] transition hover:bg-[rgba(239,68,68,0.1)] disabled:opacity-50"
        >
          Retirer
        </button>
      </div>
    </li>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-[14px] text-stone-300 transition hover:border-[rgba(255,106,50,0.45)] hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function AddVideoForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: (video: SiteVideo) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFormErrors();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return form.show({ url: "Collez le lien de la vidéo YouTube." });
    form.reset();
    setBusy(true);
    try {
      const video = await siteVideosApi.add({ url: url.trim(), title: title.trim() || null });
      await onAdded(video);
    } catch (err) {
      form.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="mt-4 space-y-3 rounded-2xl border border-[rgba(255,170,120,0.25)] bg-[rgba(232,71,36,0.04)] p-4">
      <label className="block">
        <span className="text-[12px] font-medium text-stone-300">Lien YouTube</span>
        <TextInput
          name="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            form.clear("url");
          }}
          placeholder="https://youtu.be/… ou https://www.youtube.com/shorts/…"
          inputMode="url"
          autoFocus
          aria-invalid={Boolean(form.fields.url)}
          className={`mt-1.5 ${invalidCls(form.fields.url)}`}
        />
        <FieldError message={form.fields.url} />
      </label>
      <label className="block">
        <span className="text-[12px] font-medium text-stone-300">Accroche (facultatif)</span>
        <TextInput
          name="title"
          value={title}
          maxLength={120}
          onChange={(event) => {
            setTitle(event.target.value);
            form.clear("title");
          }}
          placeholder="Ex. : Acheter un compte en toute sécurité, en 2 minutes"
          aria-invalid={Boolean(form.fields.title)}
          className={`mt-1.5 ${invalidCls(form.fields.title)}`}
        />
        <span className="mt-1 block text-[11px] text-stone-500">Affichée sur la vidéo, dans la police du site. Vide : le titre YouTube s’affiche.</span>
        <FieldError message={form.fields.title} />
      </label>
      {form.general && <Alert tone="danger">{form.general}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        <Button type="submit" loading={busy}>
          Ajouter
        </Button>
      </div>
    </form>
  );
}
