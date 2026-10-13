import { prisma } from "@misterdou/db";
import { hashMedia } from "../../lib/media.js";
import { hashPrivate } from "../../lib/private-media.js";
import { logger } from "../../lib/logger.js";
import { notifyTeam } from "../../lib/notify.js";

// ---------------------------------------------------------------------------
// Empreinte des fichiers (SHA-256 du contenu, jamais le nom) : un même fichier
// envoyé sur deux offres, ou repris d'une offre dans une demande d'échange, est
// signalé à l'équipe. Ce n'est qu'une alerte : rien n'est bloqué (une capture
// refaite ou recompressée change d'empreinte ; l'ID eFootball reste le garde-fou).
// ---------------------------------------------------------------------------

export type DuplicateRef =
  | { kind: "offer"; productId: string; title: string; slug: string }
  | { kind: "exchange"; exchangeId: string; number: string };

async function duplicatesOfHash(hash: string, exclude: { productId?: string; exchangeId?: string; clientId?: string }) {
  const [images, exchanges] = await Promise.all([
    prisma.productImage.findMany({
      where: { contentHash: hash, ...(exclude.productId ? { productId: { not: exclude.productId } } : {}) },
      distinct: ["productId"],
      take: 5,
      select: { product: { select: { id: true, title: true, slug: true } } },
    }),
    prisma.exchangeRequest.findMany({
      where: {
        videoHash: hash,
        ...(exclude.exchangeId ? { id: { not: exclude.exchangeId } } : {}),
        ...(exclude.clientId ? { clientId: { not: exclude.clientId } } : {}),
      },
      take: 5,
      select: { id: true, number: true },
    }),
  ]);
  return [
    ...images.map((i): DuplicateRef => ({ kind: "offer", productId: i.product.id, title: i.product.title, slug: i.product.slug })),
    ...exchanges.map((e): DuplicateRef => ({ kind: "exchange", exchangeId: e.id, number: e.number })),
  ];
}

const describe = (refs: DuplicateRef[]) =>
  refs.map((r) => (r.kind === "offer" ? `l’offre « ${r.title} »` : `la demande d’échange ${r.number}`)).join(", ");

/** Calcule l'empreinte d'un média d'offre et prévient l'équipe s'il existe déjà ailleurs. */
export async function fingerprintProductMedia(imageId: string, opts: { alert?: boolean } = {}): Promise<DuplicateRef[]> {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, objectKey: true, contentHash: true, mimeType: true, product: { select: { id: true, title: true } } },
  });
  if (!image) return [];
  const hash = image.contentHash ?? (await hashMedia(image.objectKey));
  if (!image.contentHash) await prisma.productImage.update({ where: { id: image.id }, data: { contentHash: hash } });
  const refs = await duplicatesOfHash(hash, { productId: image.product.id });
  if (refs.length > 0 && opts.alert !== false) {
    await notifyTeam("PRODUCTS", "ADMIN_ALERT", {
      title: "Même fichier sur plusieurs offres",
      message: `${image.mimeType.startsWith("video/") ? "Une vidéo" : "Une image"} de « ${image.product.title} » est identique à celle de ${describe(refs)}. Vérifiez qu’il ne s’agit pas du même compte.`,
      actionUrl: `/admin/offers?review=${image.product.id}`,
      priority: "NORMAL",
    });
  }
  return refs;
}

/** Empreinte de la vidéo d'une demande d'échange ; alerte si elle vient d'une offre ou d'un autre client. */
export async function fingerprintExchangeVideo(exchangeId: string): Promise<DuplicateRef[]> {
  const exchange = await prisma.exchangeRequest.findUnique({
    where: { id: exchangeId },
    select: { id: true, number: true, clientId: true, videoKey: true, videoHash: true },
  });
  if (!exchange?.videoKey) return [];
  const hash = exchange.videoHash ?? (await hashPrivate(exchange.videoKey));
  if (!exchange.videoHash) await prisma.exchangeRequest.update({ where: { id: exchange.id }, data: { videoHash: hash } });
  const refs = await duplicatesOfHash(hash, { exchangeId: exchange.id, clientId: exchange.clientId });
  if (refs.length > 0) {
    await notifyTeam("EXCHANGES", "ADMIN_ALERT", {
      title: "Vidéo d’échange déjà vue",
      message: `La vidéo de la demande ${exchange.number} est identique à celle de ${describe(refs)}. Le compte proposé n’est peut-être pas celui du client.`,
      actionUrl: `/admin/echanges?id=${exchange.id}`,
      priority: "CRITICAL",
    });
  }
  return refs;
}

/** Doublons connus de chaque média (fiche d'une offre à valider). */
export async function duplicateMediaFor(imageIds: string[]): Promise<Map<string, DuplicateRef[]>> {
  const out = new Map<string, DuplicateRef[]>();
  if (imageIds.length === 0) return out;
  const images = await prisma.productImage.findMany({
    where: { id: { in: imageIds }, contentHash: { not: null } },
    select: { id: true, productId: true, contentHash: true },
  });
  for (const image of images) {
    const refs = await duplicatesOfHash(image.contentHash!, { productId: image.productId });
    if (refs.length > 0) out.set(image.id, refs);
  }
  return out;
}

/** Offres dont au moins un média est identique à celui d'une autre offre. */
export async function productIdsWithDuplicateMedia(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ productId: string }>>`
    SELECT DISTINCT a."productId" FROM "ProductImage" a
    JOIN "ProductImage" b ON b."contentHash" = a."contentHash" AND b."productId" <> a."productId"
    WHERE a."contentHash" IS NOT NULL
    LIMIT 500`;
  return rows.map((r) => r.productId);
}

/**
 * Rattrapage : empreinte des médias envoyés avant cette fonction. Sans alerte
 * individuelle (les anciens doublons sont résumés en un seul message).
 */
export async function backfillFingerprints(limit = 25): Promise<{ hashed: number; duplicates: number }> {
  const pending = await prisma.productImage.findMany({ where: { contentHash: null }, take: limit, select: { id: true } });
  let hashed = 0;
  let duplicates = 0;
  for (const { id } of pending) {
    try {
      const refs = await fingerprintProductMedia(id, { alert: false });
      hashed += 1;
      if (refs.some((r) => r.kind === "offer")) duplicates += 1;
    } catch (err) {
      logger.warn({ err, imageId: id }, "[empreintes] média illisible, ignoré pour cette fois");
    }
  }
  if (duplicates > 0) {
    await notifyTeam("PRODUCTS", "ADMIN_ALERT", {
      title: "Anciens médias identiques repérés",
      message: `${duplicates} média(s) déjà en ligne sont identiques à ceux d’une autre offre. Consultez le filtre « Médias en double ».`,
      actionUrl: "/admin/offers?duplicates=1",
      priority: "NORMAL",
    });
  }
  return { hashed, duplicates };
}

export function startFingerprintJobs(): NodeJS.Timeout {
  const run = async () => {
    try {
      const result = await backfillFingerprints();
      if (result.hashed > 0) logger.info(result, "[empreintes] médias déjà en ligne traités");
    } catch (err) {
      logger.error({ err }, "[empreintes] échec du rattrapage");
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  return timer;
}
