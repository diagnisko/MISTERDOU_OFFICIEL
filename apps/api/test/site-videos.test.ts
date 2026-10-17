// Vidéos de la page « Comment ça marche » : liens YouTube reconnus, format lu
// chez YouTube (largeur / Short en hauteur), ordre, retrait, et séparation
// d'avec la liste générique des réglages.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@misterdou/db";
import { cleanup, createAdmin, expectApiError, tracker } from "./helpers.js";
import {
  SITE_VIDEOS_KEY,
  addSiteVideo,
  listSiteVideos,
  moveSiteVideo,
  parseYouTube,
  removeSiteVideo,
  updateSiteVideo,
} from "../src/modules/site-videos/service.js";
import { listSettings, updateSetting } from "../src/modules/admin-ops/service.js";

const t = tracker();
let saved: unknown = null;
let actor: { actorId: string };

beforeAll(async () => {
  saved = (await prisma.settings.findUnique({ where: { key: SITE_VIDEOS_KEY } }))?.value ?? null;
  await prisma.settings.deleteMany({ where: { key: SITE_VIDEOS_KEY } });
  const { user } = await createAdmin(t);
  actor = { actorId: user.id };
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.settings.deleteMany({ where: { key: SITE_VIDEOS_KEY } });
  if (saved !== null) {
    await prisma.settings.create({ data: { key: SITE_VIDEOS_KEY, value: saved as never, valueType: "json", group: "pages" } });
  }
  await cleanup(t);
});

/** Réponse oEmbed de YouTube simulée (aucun appel réseau pendant les tests). */
function youtubeAnswers(status: number, body: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("Liens YouTube", () => {
  it("reconnaît les liens habituels et refuse le reste", () => {
    expect(parseYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toEqual({ videoId: "dQw4w9WgXcQ", isShort: false });
    expect(parseYouTube("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual({ videoId: "dQw4w9WgXcQ", isShort: false });
    expect(parseYouTube("youtube.com/shorts/aBcDeFgHiJk")).toEqual({ videoId: "aBcDeFgHiJk", isShort: true });
    expect(parseYouTube("https://m.youtube.com/watch?v=dQw4w9WgXcQ")?.videoId).toBe("dQw4w9WgXcQ");
    expect(parseYouTube("https://www.youtube.com/embed/dQw4w9WgXcQ")?.videoId).toBe("dQw4w9WgXcQ");
    expect(parseYouTube("https://vimeo.com/123456")).toBeNull();
    expect(parseYouTube("https://www.youtube.com/watch?v=court")).toBeNull();
    expect(parseYouTube("pas un lien")).toBeNull();
  });
});

describe("Vidéos de « Comment ça marche »", () => {
  it("ajoute une vidéo au format donné par YouTube, un Short toujours en hauteur", async () => {
    youtubeAnswers(200, { title: "Acheter un compte en 2 minutes", width: 480, height: 270 });
    const wide = await addSiteVideo({ url: "https://youtu.be/dQw4w9WgXcQ", title: "Comment acheter sans risque" }, actor);
    expect(wide).toMatchObject({ videoId: "dQw4w9WgXcQ", title: "Comment acheter sans risque", youtubeTitle: "Acheter un compte en 2 minutes", vertical: false });
    expect(wide.ratio).toBeCloseTo(16 / 9, 2);

    youtubeAnswers(200, { title: "Short", width: 480, height: 270 });
    const short = await addSiteVideo({ url: "https://www.youtube.com/shorts/aBcDeFgHiJk" }, actor);
    expect(short).toMatchObject({ vertical: true, title: null });
    expect(short.ratio).toBeCloseTo(9 / 16, 2);

    expect((await listSiteVideos()).map((v) => v.videoId)).toEqual(["dQw4w9WgXcQ", "aBcDeFgHiJk"]);
  });

  it("refuse un mauvais lien, un doublon et une vidéo que YouTube n'autorise pas ailleurs", async () => {
    const bad = await expectApiError(() => addSiteVideo({ url: "https://vimeo.com/1" }, actor));
    expect((bad.details as { fields: Record<string, string> }).fields.url).toContain("lien YouTube valide");

    const twice = await expectApiError(() => addSiteVideo({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, actor));
    expect((twice.details as { fields: Record<string, string> }).fields.url).toContain("déjà sur la page");

    youtubeAnswers(401);
    const blocked = await expectApiError(() => addSiteVideo({ url: "https://youtu.be/zzzzzzzzzzz" }, actor));
    expect((blocked.details as { fields: Record<string, string> }).fields.url).toContain("intégration");
  });

  it("ajoute quand même la vidéo si YouTube ne répond pas (format classique)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau coupé"));
    const video = await addSiteVideo({ url: "https://youtu.be/yyyyyyyyyyy" }, actor);
    expect(video).toMatchObject({ vertical: false, youtubeTitle: null });
    expect(video.ratio).toBeCloseTo(16 / 9, 2);
    await removeSiteVideo(video.id, actor);
  });

  it("change le texte, l'ordre, et retire une vidéo", async () => {
    const [first, second] = await listSiteVideos();
    await updateSiteVideo(second!.id, { title: "Un Short pour tout comprendre" }, actor);
    await moveSiteVideo(second!.id, "up", actor);
    let videos = await listSiteVideos();
    expect(videos.map((v) => v.id)).toEqual([second!.id, first!.id]);
    expect(videos[0]!.title).toBe("Un Short pour tout comprendre");

    await removeSiteVideo(first!.id, actor);
    videos = await listSiteVideos();
    expect(videos.map((v) => v.id)).toEqual([second!.id]);
  });

  it("reste à part de la liste générique des réglages", async () => {
    expect((await listSettings()).some((row) => row.key === SITE_VIDEOS_KEY)).toBe(false);
    expect((await expectApiError(() => updateSetting(SITE_VIDEOS_KEY, [], { ...actor, actorRole: "ADMIN" }))).code).toBe("NOT_FOUND");
  });
});
