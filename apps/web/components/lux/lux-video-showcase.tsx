import { SectionLabel } from "./lux-utils";
import { IconShield } from "./lux-icons";
import { videoTitle, youtubeEmbedUrl, type SiteVideo } from "@/lib/site-videos";

// ---------------------------------------------------------------------------
// Vidéos en tête de « Comment ça marche ». Chaque vidéo a son cadre (bordure
// or et orange, halo, coins ciselés), son accroche dans la police des titres du
// site, et un emplacement aux proportions exactes de la vidéo (en largeur, ou
// en hauteur pour un Short). Le lecteur officiel de YouTube joue la vidéo dans
// la page : on ne quitte pas MISTERDOU, et YouTube compte la vue quand le
// visiteur appuie sur lecture (aucune lecture automatique).
// ---------------------------------------------------------------------------

export type VideoLabels = {
  kicker: string;
  featured: string;
  numbered: (n: number) => string;
  short: string;
  hint: string;
  fallbackTitle: string;
};

export function VideoShowcase({ videos, labels }: { videos: SiteVideo[]; labels: VideoLabels }) {
  if (videos.length === 0) return null;
  const [first, ...rest] = videos;
  return (
    <section aria-label={labels.kicker} className="mb-16 md:mb-20">
      <SectionLabel>{labels.kicker}</SectionLabel>
      <div className="mt-7">
        <VideoFrame video={first!} index={1} featured labels={labels} />
      </div>
      {rest.length > 0 && (
        <div className="mt-10 grid items-start gap-10 sm:grid-cols-2 sm:gap-8">
          {rest.map((video, i) => (
            <VideoFrame key={video.id} video={video} index={i + 2} labels={labels} />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoFrame({ video, index, featured = false, labels }: { video: SiteVideo; index: number; featured?: boolean; labels: VideoLabels }) {
  const title = videoTitle(video);
  // Short : cadre étroit et centré, pour ne pas écraser la page sur grand écran.
  const width = video.vertical ? (featured ? "max-w-[380px]" : "max-w-[320px]") : "";
  return (
    <figure className={`group relative mx-auto w-full ${width}`}>
      {/* Halo chaud derrière le cadre */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[44px] bg-[radial-gradient(60%_55%_at_50%_45%,rgba(232,71,36,0.30),transparent_72%)] opacity-80 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
      />
      {/* Coins ciselés */}
      <Corner className="-left-2 -top-2 border-l border-t rounded-tl-[12px]" />
      <Corner className="-right-2 -top-2 border-r border-t rounded-tr-[12px]" />
      <Corner className="-bottom-2 -left-2 border-b border-l rounded-bl-[12px]" />
      <Corner className="-bottom-2 -right-2 border-b border-r rounded-br-[12px]" />

      {/* Bordure dégradée */}
      <div className="rounded-[26px] bg-[linear-gradient(140deg,rgba(255,170,120,0.9),rgba(232,71,36,0.4)_28%,rgba(255,255,255,0.07)_55%,rgba(245,158,11,0.6))] p-[1.5px] shadow-[0_30px_80px_-35px_rgba(232,71,36,0.7)] transition-shadow duration-500 group-hover:shadow-[0_34px_90px_-30px_rgba(232,71,36,0.85)]">
        <div className="overflow-hidden rounded-[24.5px] bg-[#0b0605]">
          {/* Accroche, sur la vidéo */}
          <figcaption className="px-5 pb-4 pt-5 sm:px-6">
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--lux-gold-light)]">
              <PlayBadge />
              {featured ? labels.featured : labels.numbered(index)}
              {video.vertical && <span className="text-stone-500">· {labels.short}</span>}
            </span>
            <span
              className={`lux-serif mt-2 block font-bold leading-[1.12] text-stone-50 ${featured && !video.vertical ? "text-[25px] sm:text-[32px]" : "text-[21px] sm:text-[23px]"}`}
            >
              {title ?? labels.fallbackTitle}
            </span>
          </figcaption>

          {/* Emplacement aux proportions de la vidéo */}
          <div className="relative w-full bg-black" style={{ aspectRatio: String(video.ratio) }}>
            <iframe
              src={youtubeEmbedUrl(video.videoId)}
              title={title ?? labels.fallbackTitle}
              loading={featured ? "eager" : "lazy"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>

          <p className="flex items-center gap-2 px-5 py-3 text-[11px] text-stone-400 sm:px-6">
            <IconShield className="h-3.5 w-3.5 shrink-0 text-[var(--lux-gold)]" aria-hidden />
            {labels.hint}
          </p>
        </div>
      </div>
    </figure>
  );
}

function Corner({ className }: { className: string }) {
  return <span aria-hidden className={`pointer-events-none absolute h-6 w-6 border-[rgba(255,170,120,0.75)] ${className}`} />;
}

function PlayBadge() {
  return (
    <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-[linear-gradient(135deg,#ffa070,#e84724)] text-[#1a0503]">
      <svg width="8" height="9" viewBox="0 0 8 9" fill="currentColor">
        <path d="M1 0.8v7.4L7.2 4.5z" />
      </svg>
    </span>
  );
}
