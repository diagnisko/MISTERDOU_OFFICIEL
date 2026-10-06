// ---------------------------------------------------------------------------
// Préparation des médias DANS le navigateur, avant l'envoi :
// • Vidéo (MOV d'iPhone, HEVC, 60 i/s, 4K…) → MP4 H.264 + AAC, 1080p et
//   30 i/s au plus : lisible par tous les navigateurs, et 3 à 5 fois plus
//   léger, donc plus rapide à envoyer. La conversion utilise l'accélération
//   matérielle du téléphone ou de l'ordinateur (WebCodecs, via mediabunny,
//   chargé seulement ici). Déjà en MP4 H.264 raisonnable : envoyée telle quelle.
// • Photo (HEIC d'iPhone, PNG lourd, très grande image…) → JPEG 2048 px au plus.
// Si le navigateur ne sait pas convertir, le fichier d'origine part tel quel.
// ---------------------------------------------------------------------------

export type Prepared = { blob: Blob; mime: string; converted: boolean };

type Progress = (fraction: number) => void;

const WEB_VIDEO = new Set(["video/mp4", "video/webm"]);
const WEB_IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);

// Vidéo : plus grand côté 1920 px, plus petit côté 1080 px, 30 images/s.
const VIDEO_LONG = 1920;
const VIDEO_SHORT = 1080;
const VIDEO_FPS = 30;
// En dessous de ce poids, une vidéo MP4 H.264 déjà au bon format part sans conversion.
const VIDEO_KEEP_BYTES = 40 * 1024 * 1024;

// Photo : plus grand côté 2048 px ; les photos légères et déjà au bon format partent telles quelles.
const IMAGE_LONG = 2048;
const IMAGE_KEEP_BYTES = 1.5 * 1024 * 1024;

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm|3gp|mkv|avi)$/i.test(file.name);
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Type MIME d'une vidéo d'origine envoyée sans conversion (le serveur accepte MP4, WebM, MOV). */
function originalVideoMime(file: File): string {
  if (WEB_VIDEO.has(file.type)) return file.type;
  return /\.webm$/i.test(file.name) ? "video/webm" : /\.mp4$|\.m4v$/i.test(file.name) ? "video/mp4" : "video/quicktime";
}

export async function prepareVideo(file: File, onProgress?: Progress): Promise<Prepared> {
  const original: Prepared = { blob: file, mime: originalVideoMime(file), converted: false };
  if (typeof window === "undefined" || typeof (window as { VideoEncoder?: unknown }).VideoEncoder === "undefined") return original;

  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return original;
    const [codec, mime, width, height, stats] = await Promise.all([
      track.getCodec(),
      input.getMimeType(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computePacketStats(120).catch(() => null),
    ]);
    const fps = stats?.averagePacketRate ?? 30;
    const scale = Math.min(1, VIDEO_LONG / Math.max(width, height), VIDEO_SHORT / Math.min(width, height));

    // Déjà lisible partout et pas trop lourde : aucune conversion (envoi immédiat).
    if (codec === "avc" && mime.startsWith("video/mp4") && scale === 1 && fps <= VIDEO_FPS + 1 && file.size <= VIDEO_KEEP_BYTES) {
      return { blob: file, mime: "video/mp4", converted: false };
    }

    const targetW = even(width * scale);
    const targetH = even(height * scale);
    if (!(await mb.canEncodeVideo("avc", { width: targetW, height: targetH }))) return original;

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: "avc",
        // Un seul côté imposé : l'autre suit les proportions (portrait comme paysage).
        ...(width >= height ? { width: targetW } : { height: targetH }),
        ...(fps > VIDEO_FPS + 1 ? { frameRate: VIDEO_FPS } : {}),
        quality: mb.QUALITY_MEDIUM,
      },
      // AAC : copié tel quel s'il l'est déjà, sinon réencodé (ou écarté si impossible).
      audio: { codec: "aac", quality: mb.QUALITY_MEDIUM },
    });
    // Piste vidéo illisible par ce navigateur : on envoie l'original.
    if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track.type === "video")) return original;
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer) return original;
    // Rare : la version convertie n'allège rien et l'original est déjà lisible partout.
    if (buffer.byteLength >= file.size && codec === "avc" && WEB_VIDEO.has(file.type)) return original;
    return { blob: new Blob([buffer], { type: "video/mp4" }), mime: "video/mp4", converted: true };
  } catch {
    return original;
  } finally {
    input.dispose();
  }
}

export async function prepareImage(file: File): Promise<Prepared> {
  const original: Prepared = { blob: file, mime: file.type, converted: false };
  let bitmap: ImageBitmap;
  try {
    // Safari décode le HEIC des iPhone ; l'orientation de l'appareil photo est respectée.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return original; // illisible ici : le serveur dira si le format est accepté
  }
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    if (WEB_IMAGE.has(file.type) && file.size <= IMAGE_KEEP_BYTES && long <= IMAGE_LONG) return original;
    const scale = Math.min(1, IMAGE_LONG / long);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.fillStyle = "#ffffff"; // fond des zones transparentes (le JPEG n'en a pas)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) return original;
    // Déjà léger et au bon format : on garde l'original s'il pèse moins.
    if (WEB_IMAGE.has(file.type) && blob.size >= file.size) return original;
    return { blob, mime: "image/jpeg", converted: true };
  } finally {
    bitmap.close();
  }
}
