import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";

// ---------------------------------------------------------------------------
// Réparations après la copie de l'ancien site :
//   1. offres en double (même titre, sans repère de copie, sans commande) :
//      supprimées avec leurs fichiers — l'offre repérée est gardée ;
//   2. vidéos non lisibles sur ordinateur (HEVC…) : converties en MP4 H.264.
//   pnpm --filter @misterdou/api legacy:repair                 → simulation
//   pnpm --filter @misterdou/api legacy:repair -- --apply      → répare
// Même garde-fou que la copie : base locale, ou --production.
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: process.env.DOTENV_CONFIG_PATH ?? path.join(apiDir, ".env"), quiet: true });

const { targetHost } = await import("./config.js");
// Connexion lente : patience pour joindre la base (Prisma attend 10 s par défaut).
if (process.env.DATABASE_URL && !/pool_timeout=/.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL += `${process.env.DATABASE_URL.includes("?") ? "&" : "?"}pool_timeout=60&connect_timeout=30`;
}
const target = targetHost(process.env.DATABASE_URL);
if (!target.local && !args.has("--production")) {
  console.error(`\nArrêt : base visée ${target.host} (pas une base locale). Ajoutez --production pour réparer la production.`);
  process.exit(1);
}
if (target.local) {
  for (const key of Object.keys(process.env)) if (key.startsWith("R2_")) delete process.env[key];
  process.env.DOTENV_CONFIG_PATH = path.join(apiDir, ".env.essai-local-sans-fichier");
}

const { prisma } = await import("@misterdou/db");
const { deleteMedia, publicUrl, putPublicMedia } = await import("../lib/media.js");
const { normalizeVideo, videoCodec } = await import("./videos.js");

const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${m}`);

async function removeDuplicates() {
  const refs = new Set((await prisma.legacyRef.findMany({ where: { entity: "product" }, select: { newId: true } })).map((r) => r.newId));
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, slug: true, images: { select: { objectKey: true } }, _count: { select: { orderItems: true } } },
  });
  const byTitle = new Map<string, typeof products>();
  for (const p of products) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p]);
  for (const [title, group] of byTitle) {
    if (group.length < 2 || !group.some((p) => refs.has(p.id))) continue;
    // Seules les copies sans repère ni commande sont des doublons sûrs.
    for (const dup of group.filter((p) => !refs.has(p.id) && p._count.orderItems === 0)) {
      log(`Doublon ${title} (${dup.slug}) : ${dup.images.length} fichier(s) ${apply ? "supprimés" : "à supprimer"}`);
      if (!apply) continue;
      const keys = dup.images.map((i) => i.objectKey);
      await prisma.$transaction([
        prisma.legacyRef.deleteMany({ where: { entity: "media", newId: { in: keys } } }),
        prisma.productImage.deleteMany({ where: { productId: dup.id } }),
        prisma.productCredential.deleteMany({ where: { productId: dup.id } }),
        prisma.product.delete({ where: { id: dup.id } }),
      ]);
      for (const key of keys) await deleteMedia(key).catch(() => undefined);
    }
  }
}

async function fixVideos() {
  const videos = await prisma.productImage.findMany({
    where: { mimeType: { startsWith: "video/" } },
    select: { id: true, productId: true, objectKey: true, sizeBytes: true, product: { select: { title: true } } },
  });
  for (const v of videos) {
    const url = publicUrl(v.objectKey);
    const codec = await videoCodec(url);
    if (codec === "h264") continue;
    log(`Vidéo ${v.product.title} (${(v.sizeBytes / 1048576).toFixed(1)} Mo, ${codec ?? "illisible"}) : ${apply ? "conversion en H.264…" : "à convertir"}`);
    if (!apply) continue;
    const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!res.ok) {
      log(`  impossible de la relire (${res.status}) : ignorée`);
      continue;
    }
    const video = await normalizeVideo(Buffer.from(await res.arrayBuffer()), "video/mp4");
    if (!video) {
      log("  conversion impossible : ignorée");
      continue;
    }
    const key = `products/${v.productId}/${randomUUID()}.mp4`;
    const started = Date.now();
    await putPublicMedia(key, video.buffer, "video/mp4");
    await prisma.$transaction([
      prisma.productImage.update({ where: { id: v.id }, data: { objectKey: key, mimeType: "video/mp4", sizeBytes: video.buffer.length } }),
      prisma.legacyRef.updateMany({ where: { entity: "media", newId: v.objectKey }, data: { newId: key } }),
    ]);
    await deleteMedia(v.objectKey).catch(() => undefined);
    log(`  convertie : ${(video.buffer.length / 1048576).toFixed(1)} Mo, envoyée en ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

async function main() {
  console.log(`Réparations sur ${target.host}${target.local ? " (essai local)" : ""} — ${apply ? "ÉCRITURE" : "SIMULATION (ajoutez --apply)"}`);
  await removeDuplicates();
  await fixVideos();
  log("Terminé.");
}

main()
  .catch((err) => {
    console.error(`\nArrêt : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
