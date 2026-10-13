import { z } from "zod";
import { prisma } from "@misterdou/db";
import { badRequest, conflict } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { confirmPrivateUpload, createPrivateUpload, deletePrivate, privateReadUrl, type PrivateRules } from "../../lib/private-media.js";
import { getIntSetting } from "../settings/service.js";

// ---------------------------------------------------------------------------
// Images dans les messages (discussion d'un compte, messagerie du support) :
// images seulement (JPEG, PNG, WebP ; la position GPS est retirée dans le
// navigateur avant l'envoi), 5 par message, 5 Mo chacune. Rangées dans
// l'espace privé, lues par lien signé de courte durée, effacées après le délai
// de conservation sauf signalement ouvert.
// ---------------------------------------------------------------------------

export const MAX_IMAGES_PER_MESSAGE = 5;
export const CHAT_IMAGE_RULES: PrivateRules = { kinds: ["image"], maxBytes: 5 * 1024 * 1024 };

export const imagesField = z
  .array(z.object({ key: z.string().trim().min(10).max(200), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]) }))
  .max(MAX_IMAGES_PER_MESSAGE, `${MAX_IMAGES_PER_MESSAGE} images au maximum par message.`)
  .optional();

export type ImageInput = NonNullable<z.infer<typeof imagesField>>;

/** Lien d'envoi d'une image ; elle n'appartient qu'à celui qui l'envoie. */
export async function chatImageUploadUrl(userId: string, mimeType: string, sizeBytes: number) {
  return createPrivateUpload(`chat/${userId}`, mimeType, sizeBytes, CHAT_IMAGE_RULES);
}

/** Vérifie les images d'un message avant de l'enregistrer (propriétaire, format, unicité). */
export async function checkImages(userId: string, images: ImageInput | undefined) {
  if (!images || images.length === 0) return [];
  const keys = new Set(images.map((i) => i.key));
  if (keys.size !== images.length) throw badRequest("VALIDATION_ERROR", "Même image envoyée deux fois.");
  const out: Array<{ objectKey: string; mimeType: string; sizeBytes: number }> = [];
  for (const image of images) {
    if (!image.key.startsWith(`chat/${userId}/`)) throw badRequest("VALIDATION_ERROR", "Image invalide : relancez l’envoi.");
    const used = await prisma.chatImage.count({ where: { objectKey: image.key } });
    if (used > 0) throw conflict("MEDIA_EXISTS", "Cette image est déjà envoyée.");
    const { sizeBytes } = await confirmPrivateUpload(image.key, image.mimeType, CHAT_IMAGE_RULES);
    out.push({ objectKey: image.key, mimeType: image.mimeType, sizeBytes });
  }
  return out;
}

/** Texte de notification d'un message sans texte. */
export const imagePreview = (count: number) => (count > 1 ? `📷 ${count} photos` : "📷 Photo");

/** Images d'un message pour l'affichage : lien signé, ou « expirée ». */
export async function imagesDto(images: Array<{ id: string; objectKey: string; purgedAt: Date | null }>) {
  return Promise.all(
    images.map(async (i) => ({ id: i.id, url: i.purgedAt ? null : await privateReadUrl(i.objectKey), expired: Boolean(i.purgedAt) })),
  );
}

export const IMAGE_SELECT = { select: { id: true, objectKey: true, purgedAt: true }, orderBy: { createdAt: "asc" as const } } as const;

const OPEN_TICKET = ["CREATED", "PENDING", "IN_PROGRESS"] as const;

/** Une image reste tant qu'un signalement est ouvert sur l'affaire dont elle est la preuve. */
async function protectedByReport(image: {
  productMessage: { thread: { clientId: string; productId: string } } | null;
  message: { conversation: { participantAUserId: string; participantBUserId: string } } | null;
}): Promise<boolean> {
  if (image.productMessage) {
    const { clientId, productId } = image.productMessage.thread;
    const open = await prisma.supportTicket.count({
      // Signalement ouvert sur une commande de ce client pour ce compte (par lui ou par le vendeur).
      where: { status: { in: [...OPEN_TICKET] }, order: { buyerId: clientId, items: { some: { productId } } } },
    });
    return open > 0;
  }
  if (image.message) {
    const { participantAUserId, participantBUserId } = image.message.conversation;
    const open = await prisma.supportTicket.count({
      where: { status: { in: [...OPEN_TICKET] }, reporterId: { in: [participantAUserId, participantBUserId] } },
    });
    return open > 0;
  }
  return false;
}

export async function purgeChatImages(now = new Date()): Promise<number> {
  const days = await getIntSetting("chatImageRetentionDays", 30);
  const old = await prisma.chatImage.findMany({
    where: { purgedAt: null, createdAt: { lt: new Date(now.getTime() - Math.max(1, days) * 86_400_000) } },
    take: 200,
    select: {
      id: true,
      objectKey: true,
      productMessage: { select: { thread: { select: { clientId: true, productId: true } } } },
      message: { select: { conversation: { select: { participantAUserId: true, participantBUserId: true } } } },
    },
  });
  let purged = 0;
  for (const image of old) {
    if (await protectedByReport(image)) continue;
    try {
      await deletePrivate(image.objectKey);
      await prisma.chatImage.update({ where: { id: image.id }, data: { purgedAt: now } });
      purged += 1;
    } catch (err) {
      logger.warn({ err, imageId: image.id }, "[images] image non effacée, nouvel essai plus tard");
    }
  }
  return purged;
}

export function startChatImageJobs(): NodeJS.Timeout {
  const run = async () => {
    try {
      const purged = await purgeChatImages();
      if (purged > 0) logger.info({ purged }, "[images] images des messages effacées (conservation)");
    } catch (err) {
      logger.error({ err }, "[images] échec de l'effacement des images");
    }
  };
  void run();
  const timer = setInterval(() => void run(), 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
