import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { Prisma } from "@misterdou/db";
import { logAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { fieldError } from "../../lib/validation-messages.js";

// ---------------------------------------------------------------------------
// Vidéos de la page « Comment ça marche » (YouTube pour l'instant).
// L'administrateur colle un lien dans Paramètres ; le site lit chez YouTube le
// titre et le format (vidéo en largeur, Short en hauteur) pour réserver un
// cadre aux bonnes proportions. La lecture se fait dans la page avec le
// lecteur officiel de YouTube : la vue est comptée par YouTube quand le
// visiteur appuie sur lecture (jamais de lecture automatique).
// Stockage : un réglage JSON (pas de table dédiée, rien à migrer).
// ---------------------------------------------------------------------------

export const SITE_VIDEOS_KEY = "howItWorksVideos";
const MAX_VIDEOS = 12;

export type SiteVideo = {
  id: string;
  provider: "youtube";
  videoId: string;
  url: string;
  /** Texte d'accroche choisi par l'administrateur (sinon le titre YouTube). */
  title: string | null;
  youtubeTitle: string | null;
  /** Largeur / hauteur (ex. 16/9 ≈ 1,78 ; Short 9/16 ≈ 0,56). */
  ratio: number;
  vertical: boolean;
  addedAt: string;
};

const storedSchema = z.array(
  z.object({
    id: z.string(),
    provider: z.literal("youtube"),
    videoId: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    youtubeTitle: z.string().nullable(),
    ratio: z.number().positive(),
    vertical: z.boolean(),
    addedAt: z.string(),
  }),
);

export const addVideoSchema = z.object({
  url: z.string().trim().min(1, "Collez le lien de la vidéo YouTube.").max(300),
  title: z.string().trim().max(120).optional().nullable(),
});
export const updateVideoSchema = z.object({ title: z.string().trim().max(120).nullable() });
export const moveVideoSchema = z.object({ direction: z.enum(["up", "down"]) });

export type VideoActor = { actorId: string; ip?: string };

/** Identifiant YouTube (11 caractères) d'un lien : watch, youtu.be, shorts, embed, live. */
export function parseYouTube(raw: string): { videoId: string; isShort: boolean } | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const ID = /^[A-Za-z0-9_-]{11}$/;
  let id: string | null = null;
  let isShort = false;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live" || first === "v") {
      id = second ?? null;
      isShort = first === "shorts";
    }
  }
  return id && ID.test(id) ? { videoId: id, isShort } : null;
}

/** Titre et proportions lus chez YouTube (oEmbed) ; null si la vidéo n'est pas intégrable. */
async function youtubeInfo(videoId: string): Promise<{ title: string | null; width: number; height: number } | "unavailable" | null> {
  const target = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(6_000) });
    if (res.status === 401 || res.status === 403 || res.status === 404) return "unavailable";
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown; width?: unknown; height?: unknown };
    const width = typeof data.width === "number" && data.width > 0 ? data.width : 16;
    const height = typeof data.height === "number" && data.height > 0 ? data.height : 9;
    return { title: typeof data.title === "string" ? data.title.slice(0, 200) : null, width, height };
  } catch (err) {
    // YouTube injoignable : la vidéo est ajoutée quand même, au format classique.
    logger.warn({ err }, "[videos] informations YouTube indisponibles");
    return null;
  }
}

export async function listSiteVideos(): Promise<SiteVideo[]> {
  const row = await prisma.settings.findUnique({ where: { key: SITE_VIDEOS_KEY }, select: { value: true } });
  const parsed = storedSchema.safeParse(row?.value ?? []);
  return parsed.success ? parsed.data : [];
}

async function save(videos: SiteVideo[], actor: VideoActor) {
  await prisma.settings.upsert({
    where: { key: SITE_VIDEOS_KEY },
    create: {
      key: SITE_VIDEOS_KEY,
      value: videos as unknown as Prisma.InputJsonValue,
      valueType: "json",
      group: "pages",
      description: "Vidéos de la page « Comment ça marche »",
      updatedById: actor.actorId,
    },
    update: { value: videos as unknown as Prisma.InputJsonValue, updatedById: actor.actorId },
  });
}

export async function addSiteVideo(input: z.infer<typeof addVideoSchema>, actor: VideoActor) {
  const parsed = parseYouTube(input.url);
  if (!parsed) throw fieldError("url", "Ce n’est pas un lien YouTube valide (exemple : https://youtu.be/… ou https://www.youtube.com/watch?v=…).");
  const videos = await listSiteVideos();
  if (videos.length >= MAX_VIDEOS) throw fieldError("url", `${MAX_VIDEOS} vidéos au maximum : retirez-en une avant d’en ajouter.`);
  if (videos.some((v) => v.videoId === parsed.videoId)) throw fieldError("url", "Cette vidéo est déjà sur la page.");

  const info = await youtubeInfo(parsed.videoId);
  if (info === "unavailable") {
    throw fieldError(
      "url",
      "YouTube refuse d’afficher cette vidéo ailleurs : vérifiez qu’elle est « Publique » ou « Non répertoriée » et que l’intégration est autorisée.",
    );
  }
  // Short : toujours en hauteur. Sinon, les proportions données par YouTube.
  const ratio = parsed.isShort ? 9 / 16 : info ? info.width / info.height : 16 / 9;
  const video: SiteVideo = {
    id: randomUUID(),
    provider: "youtube",
    videoId: parsed.videoId,
    url: input.url.trim(),
    title: input.title?.trim() || null,
    youtubeTitle: info?.title ?? null,
    ratio: Math.round(ratio * 1000) / 1000,
    vertical: ratio < 1,
    addedAt: new Date().toISOString(),
  };
  await save([...videos, video], actor);
  await logAudit({ actorId: actor.actorId, ip: actor.ip, action: "SITE_VIDEO_ADDED", resourceType: "Settings", resourceId: SITE_VIDEOS_KEY, metadata: { videoId: video.videoId } });
  return video;
}

export async function updateSiteVideo(id: string, input: z.infer<typeof updateVideoSchema>, actor: VideoActor) {
  const videos = await listSiteVideos();
  const video = videos.find((v) => v.id === id);
  if (!video) throw notFound("Cette vidéo n’est plus sur la page : rechargez.");
  video.title = input.title?.trim() || null;
  await save(videos, actor);
  return video;
}

export async function moveSiteVideo(id: string, direction: "up" | "down", actor: VideoActor) {
  const videos = await listSiteVideos();
  const index = videos.findIndex((v) => v.id === id);
  if (index < 0) throw notFound("Cette vidéo n’est plus sur la page : rechargez.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target >= 0 && target < videos.length) {
    [videos[index], videos[target]] = [videos[target]!, videos[index]!];
    await save(videos, actor);
  }
  return videos;
}

export async function removeSiteVideo(id: string, actor: VideoActor) {
  const videos = await listSiteVideos();
  const video = videos.find((v) => v.id === id);
  if (!video) throw notFound("Cette vidéo n’est plus sur la page : rechargez.");
  await save(
    videos.filter((v) => v.id !== id),
    actor,
  );
  await logAudit({ actorId: actor.actorId, ip: actor.ip, action: "SITE_VIDEO_REMOVED", resourceType: "Settings", resourceId: SITE_VIDEOS_KEY, metadata: { videoId: video.videoId } });
  return { removed: true };
}
