import { request } from "./api";

// Vidéos de la page « Comment ça marche » (lien YouTube collé dans Paramètres).

export type SiteVideo = {
  id: string;
  provider: "youtube";
  videoId: string;
  url: string;
  /** Texte d'accroche de l'administrateur (sinon le titre YouTube). */
  title: string | null;
  youtubeTitle: string | null;
  /** Largeur / hauteur de la vidéo (16/9, ou 9/16 pour un Short). */
  ratio: number;
  vertical: boolean;
  addedAt: string;
};

/** Texte affiché sur le cadre : l'accroche choisie, sinon le titre YouTube. */
export const videoTitle = (video: SiteVideo): string | null => video.title ?? video.youtubeTitle;

/**
 * Lecteur officiel de YouTube, lu dans la page. Pas de lecture automatique :
 * YouTube compte la vue quand le visiteur appuie sur son bouton lecture.
 */
export const youtubeEmbedUrl = (videoId: string) =>
  `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1&playsinline=1`;

export const youtubeThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;

export const siteVideosApi = {
  list: () => request<SiteVideo[]>("/api/v1/admin/site/videos"),
  add: (body: { url: string; title: string | null }) =>
    request<SiteVideo>("/api/v1/admin/site/videos", { method: "POST", body: JSON.stringify(body) }),
  rename: (id: string, title: string | null) =>
    request<SiteVideo>(`/api/v1/admin/site/videos/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  move: (id: string, direction: "up" | "down") =>
    request<SiteVideo[]>(`/api/v1/admin/site/videos/${id}/move`, { method: "POST", body: JSON.stringify({ direction }) }),
  remove: (id: string) => request<{ removed: boolean }>(`/api/v1/admin/site/videos/${id}`, { method: "DELETE" }),
};
