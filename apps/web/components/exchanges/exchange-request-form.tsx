"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { errorMessage, formatXof } from "@/lib/api";
import { putFile } from "@/lib/upload";
import { prepareVideo } from "@/lib/media-prepare";
import { Alert, FieldError, Spinner, invalidCls } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
import { exchangesApi, type Prepared } from "@/lib/exchanges";
import { useT } from "@/lib/i18n";

// Demande d'échange : le client montre son compte en vidéo (avec le code
// affiché ici), donne l'ID eFootball et, s'il veut, un message. Pas de prix :
// c'est le vendeur qui annonce le complément.

const inputCls = "dash-input !pl-4";

/** Durée d'une vidéo (secondes), lue par le navigateur ; null si illisible ici. */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

export function ExchangeRequestForm({ productId }: { productId: string }) {
  const t = useT();
  const router = useRouter();
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gameId, setGameId] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: "prep" | "upload"; pct: number } | null>(null);
  const fields = useFormErrors();
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    exchangesApi
      .prepare(productId)
      .then(setPrep)
      .catch((err) => setLoadError(errorMessage(err, t("xch.loadFailed"))));
  }, [productId]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function choose(selected: File | undefined) {
    fields.clear("videoKey");
    if (!selected || !prep) return;
    const seconds = await videoDuration(selected);
    if (seconds !== null && seconds > prep.videoMaxSeconds + 5) {
      fields.show({ videoKey: t("xch.videoTooLong") });
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prep) return;
    const found: Record<string, string> = {};
    const id = gameId.trim().replace(/[\s_-]/g, "");
    if (!gameId.trim()) found.gameAccountId = t("form.required");
    else if (!/^[A-Za-z0-9 _-]+$/.test(gameId.trim()) || id.length < 4 || id.length > 40) found.gameAccountId = t("offer.gameIdInvalid");
    if (!file) found.videoKey = t("xch.videoRequired");
    if (Object.keys(found).length > 0) return fields.show(found);
    fields.reset();
    try {
      setProgress({ label: "prep", pct: 0 });
      const ready = await prepareVideo(file!, (f) => setProgress({ label: "prep", pct: Math.round(f * 100) }));
      if (ready.blob.size > prep.videoMaxBytes) {
        fields.show({ videoKey: t("xch.videoTooBig", { mb: Math.round(prep.videoMaxBytes / 1024 / 1024) }) });
        setProgress(null);
        return;
      }
      const upload = await exchangesApi.videoUploadUrl(ready.mime, ready.blob.size);
      setProgress({ label: "upload", pct: 0 });
      await putFile(upload.uploadUrl, ready.blob, upload.headers, (f) => setProgress({ label: "upload", pct: Math.round(f * 100) }));
      const created = await exchangesApi.create({
        productId,
        gameAccountId: gameId.trim(),
        videoKey: upload.key,
        videoMime: ready.mime,
        message: message.trim() || null,
        proofToken: prep.proof.token,
      });
      router.replace(`/account/echanges?id=${created.id}&sent=1`);
    } catch (err) {
      fields.fromError(err, undefined, { FILE_TYPE_INVALID: "videoKey", FILE_TOO_LARGE: "videoKey", MEDIA_EXISTS: "videoKey" });
      setProgress(null);
    }
  }

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (!prep) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[#b8a6a1]">
        <Spinner /> {t("account.loading")}
      </p>
    );
  }

  const busy = progress !== null;
  const mb = Math.round(prep.videoMaxBytes / 1024 / 1024);

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <h1 className="text-[20px] font-semibold text-white">{t("xch.newTitle")}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[#b8a6a1]">{t("xch.newLead")}</p>
      </div>

      <section className="dash-card flex items-center gap-4 p-5">
        {prep.product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- bucket public R2
          <img src={prep.product.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#8f7d77]">{t("xch.target")}</p>
          <p className="truncate text-[16px] font-semibold text-white">{prep.product.title}</p>
          <p className="text-[12.5px] text-[#b8a6a1]">{formatXof(prep.product.price)}</p>
        </div>
      </section>

      <section className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("xch.yourAccount")}</h2>
        <label className="block">
          <span className={`text-[12px] font-medium ${fields.fields.gameAccountId ? "text-[#fca5a5]" : "text-[#cdbab3]"}`}>{t("xch.gameId")}</span>
          <input
            name="gameAccountId"
            value={gameId}
            onChange={(e) => {
              setGameId(e.target.value);
              fields.clear("gameAccountId");
            }}
            maxLength={60}
            autoComplete="off"
            aria-invalid={Boolean(fields.fields.gameAccountId)}
            className={`${inputCls} mt-1.5 ${invalidCls(fields.fields.gameAccountId)}`}
          />
          {fields.fields.gameAccountId ? (
            <FieldError message={fields.fields.gameAccountId} />
          ) : (
            <span className="mt-1 block text-[11px] text-[#8f7d77]">{t("xch.gameIdHint")}</span>
          )}
        </label>

        <div className="rounded-2xl border border-[rgba(255,106,50,0.35)] bg-[rgba(255,106,50,0.06)] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#ff8a5c]">{t("xch.proofTitle")}</p>
          <p className="mt-1 select-all font-mono text-[30px] font-bold tracking-[0.18em] text-white">{prep.proof.code}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#e9dad3]">{t("xch.proofBody")}</p>
        </div>

        <div>
          <span className="text-[12px] font-medium text-[#cdbab3]">{t("xch.video")}</span>
          <p className="mt-0.5 text-[11px] text-[#8f7d77]">{t("xch.videoHint", { mb })}</p>
          <input ref={picker} type="file" accept="video/*" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
          {preview && <video src={preview} controls playsInline className="mt-3 max-h-[50vh] w-full rounded-xl bg-black" />}
          <button
            type="button"
            name="videoKey"
            disabled={busy}
            onClick={() => picker.current?.click()}
            className={`dash-btn dash-btn-ghost mt-3 disabled:opacity-60 ${invalidCls(fields.fields.videoKey)}`}
          >
            {file ? t("xch.videoChange") : t("xch.videoPick")}
          </button>
          <FieldError message={fields.fields.videoKey} />
        </div>

        <label className="block">
          <span className="text-[12px] font-medium text-[#cdbab3]">{t("xch.message")}</span>
          <textarea
            name="message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              fields.clear("message");
            }}
            maxLength={1000}
            rows={3}
            placeholder={t("xch.messagePlaceholder")}
            className={`${inputCls} mt-1.5 !h-auto py-3 ${invalidCls(fields.fields.message)}`}
          />
          <FieldError message={fields.fields.message} />
        </label>
        <p className="text-[12px] text-[#fcd9a5]">{t("xch.noPrice")}</p>
      </section>

      {fields.hasErrors && <p className="text-[12.5px] font-medium text-[#fca5a5]">{t("form.fixBelow")}</p>}
      {fields.general && <Alert tone="danger">{fields.general}</Alert>}
      {progress && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-[#b8a6a1]">
            {progress.label === "prep" ? t("xch.videoPreparing", { pct: progress.pct }) : t("xch.videoUploading", { pct: progress.pct })}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full bg-[#ff6a32] transition-[width]" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      <button type="submit" disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
        {busy && <Spinner />} {t("xch.send")}
      </button>
      <p className="text-[11.5px] leading-relaxed text-[#f5d9a8]">{t("xch.offsite")}</p>
    </form>
  );
}
