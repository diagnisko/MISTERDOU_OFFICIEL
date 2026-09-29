import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { notifyActiveAdmins, notifyUser } from "../../lib/notify.js";
import { publicUrl } from "../../lib/media.js";

// ---------------------------------------------------------------------------
// Discussion à propos d'un compte en vente.
// • Le client écrit « au vendeur ». Répondent : le vendeur du compte, les
//   managers (permission SUPPORT) et l'administrateur.
// • Le client ne voit jamais qui a répondu : « Vendeur » (ou « MISTERDOU »
//   pour un compte de la plateforme).
// • Le vendeur voit « Équipe MISTERDOU » pour les réponses de l'équipe.
// • L'équipe voit l'auteur réel de chaque message.
// ---------------------------------------------------------------------------

export type ChatSide = "client" | "seller" | "team";

export type ChatViewer = {
  user: { id: string; role?: { name: RoleName } | null };
  isAdminSession?: boolean;
};

export const messageSchema = z.object({ content: z.string().trim().min(1, "Message vide").max(2000, "Message trop long") });

const PREVIEW_LENGTH = 140;

/** Membre de l'équipe habilité à répondre (admin en session renforcée, manager SUPPORT). */
export async function isTeam(viewer: ChatViewer): Promise<boolean> {
  const role = viewer.user.role?.name;
  if (role === "ADMIN") return Boolean(viewer.isAdminSession);
  if (role !== "STAFF") return false;
  const profile = await prisma.managerProfile.findUnique({ where: { userId: viewer.user.id }, select: { permissions: true } });
  return profile?.permissions.includes("SUPPORT") ?? false;
}

const threadSelect = {
  id: true,
  clientId: true,
  lastMessageAt: true,
  clientLastReadAt: true,
  sellerLastReadAt: true,
  teamLastReadAt: true,
  createdAt: true,
  client: { select: { firstName: true, lastName: true } },
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      ownerType: true,
      seller: { select: { userId: true } },
      images: { where: { mimeType: { startsWith: "image/" } }, select: { objectKey: true }, orderBy: { position: "asc" as const }, take: 1 },
    },
  },
} as const;

type ThreadRow = {
  id: string;
  clientId: string;
  lastMessageAt: Date;
  clientLastReadAt: Date | null;
  sellerLastReadAt: Date | null;
  teamLastReadAt: Date | null;
  createdAt: Date;
  client: { firstName: string | null; lastName: string | null };
  product: {
    id: string;
    title: string;
    slug: string;
    status: string;
    ownerType: string;
    seller: { userId: string } | null;
    images: Array<{ objectKey: string }>;
  };
};

/** Côté du lecteur dans un fil, ou 404 (on ne révèle pas l'existence d'un fil d'autrui). */
async function sideIn(thread: ThreadRow, viewer: ChatViewer): Promise<ChatSide> {
  if (thread.clientId === viewer.user.id) return "client";
  if (thread.product.seller?.userId === viewer.user.id) return "seller";
  if (await isTeam(viewer)) return "team";
  throw notFound("Discussion introuvable.");
}

const clientName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName?.[0] ? `${c.lastName[0]}.` : null].filter(Boolean).join(" ") || "Client";

const sellerLabel = (thread: ThreadRow) => (thread.product.ownerType === "ADMIN" || !thread.product.seller ? "MISTERDOU" : "Vendeur");

function lastReadFor(thread: ThreadRow, side: ChatSide): Date | null {
  return side === "client" ? thread.clientLastReadAt : side === "seller" ? thread.sellerLastReadAt : thread.teamLastReadAt;
}

async function unreadFor(thread: ThreadRow, side: ChatSide): Promise<number> {
  const since = lastReadFor(thread, side);
  return prisma.productMessage.count({
    where: {
      threadId: thread.id,
      fromClient: side !== "client",
      ...(since ? { createdAt: { gt: since } } : {}),
    },
  });
}

async function lastMessage(threadId: string) {
  return prisma.productMessage.findFirst({
    where: { threadId },
    orderBy: { createdAt: "desc" },
    select: { content: true, fromClient: true, createdAt: true },
  });
}

async function toSummary(thread: ThreadRow, side: ChatSide) {
  const [unread, last] = await Promise.all([unreadFor(thread, side), lastMessage(thread.id)]);
  return {
    id: thread.id,
    product: {
      id: thread.product.id,
      title: thread.product.title,
      slug: thread.product.slug,
      imageUrl: thread.product.images[0] ? publicUrl(thread.product.images[0].objectKey) : null,
      available: thread.product.status === "ACTIVE",
    },
    // Le client voit « Vendeur » ; le côté vente voit le nom du client.
    counterpart: side === "client" ? sellerLabel(thread) : clientName(thread.client),
    lastMessage: last
      ? { preview: last.content.slice(0, PREVIEW_LENGTH), fromClient: last.fromClient, createdAt: last.createdAt.toISOString() }
      : null,
    unread,
    lastMessageAt: thread.lastMessageAt.toISOString(),
  };
}

export type ThreadSummary = Awaited<ReturnType<typeof toSummary>>;

// --- Client ------------------------------------------------------------------

/** Le client écrit à propos d'un compte : ouvre le fil si besoin, puis ajoute le message. */
export async function sendToSeller(productId: string, viewer: ChatViewer, content: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, status: true, title: true, slug: true, ownerType: true, seller: { select: { userId: true } } },
  });
  if (!product) throw notFound("Compte introuvable.");
  if (product.seller?.userId === viewer.user.id) throw badRequest("SELF_ACTION", "Vous ne pouvez pas vous écrire sur votre propre compte.");

  const existing = await prisma.productThread.findUnique({
    where: { productId_clientId: { productId, clientId: viewer.user.id } },
    select: { id: true },
  });
  if (!existing && product.status !== "ACTIVE") throw badRequest("INVALID_STATE", "Ce compte n'est plus en vente.");

  const now = new Date();
  const thread = existing
    ? await prisma.productThread.update({ where: { id: existing.id }, data: { lastMessageAt: now, clientLastReadAt: now }, select: { id: true } })
    : await prisma.productThread.create({
        data: { productId, clientId: viewer.user.id, lastMessageAt: now, clientLastReadAt: now },
        select: { id: true },
      });
  const message = await prisma.productMessage.create({
    data: { threadId: thread.id, authorId: viewer.user.id, fromClient: true, content, createdAt: now },
    select: { id: true },
  });

  const notice = {
    title: `Question sur « ${product.title} »`,
    message: content.slice(0, PREVIEW_LENGTH),
    priority: "NORMAL" as const,
  };
  if (product.seller) await notifyUser(product.seller.userId, "NEW_MESSAGE", { ...notice, actionUrl: `/seller/messages?thread=${thread.id}` });
  // L'équipe est alertée à l'ouverture d'un fil, et à chaque message sur un compte de la plateforme.
  if (!existing || !product.seller) await notifyActiveAdmins("NEW_MESSAGE", { ...notice, actionUrl: `/admin/discussions?thread=${thread.id}` });

  return { threadId: thread.id, messageId: message.id };
}

/** Fil du client pour un compte donné (fiche produit), ou null. */
export async function myThreadForProduct(productId: string, viewer: ChatViewer) {
  const thread = await prisma.productThread.findUnique({
    where: { productId_clientId: { productId, clientId: viewer.user.id } },
    select: { id: true },
  });
  return thread ? getThread(thread.id, viewer) : null;
}

export async function listMyThreads(viewer: ChatViewer): Promise<ThreadSummary[]> {
  const rows = await prisma.productThread.findMany({
    where: { clientId: viewer.user.id },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    select: threadSelect,
  });
  return Promise.all(rows.map((row) => toSummary(row, "client")));
}

// --- Côté vente (vendeur ou équipe) -----------------------------------------------

export async function listInbox(viewer: ChatViewer): Promise<{ side: "seller" | "team"; items: ThreadSummary[] }> {
  const team = await isTeam(viewer);
  if (!team) {
    const seller = await prisma.seller.findUnique({ where: { userId: viewer.user.id }, select: { id: true } });
    if (!seller) throw forbidden("Réservé aux vendeurs et à l'équipe.");
  }
  const rows = await prisma.productThread.findMany({
    where: team ? {} : { product: { sellerId: { not: null }, seller: { userId: viewer.user.id } } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: threadSelect,
  });
  const side = team ? "team" : "seller";
  return { side, items: await Promise.all(rows.map((row) => toSummary(row, side))) };
}

// --- Commun ----------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", STAFF: "Manager", VENDOR: "Vendeur", CLIENT: "Vendeur" };

/** Fil complet vu par le lecteur ; marque les messages comme lus de son côté. */
export async function getThread(threadId: string, viewer: ChatViewer) {
  const thread = await prisma.productThread.findUnique({ where: { id: threadId }, select: threadSelect });
  if (!thread) throw notFound("Discussion introuvable.");
  const side = await sideIn(thread, viewer);

  const messages = await prisma.productMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      id: true,
      content: true,
      fromClient: true,
      createdAt: true,
      authorId: true,
      author: { select: { firstName: true, lastName: true, role: { select: { name: true } } } },
    },
  });

  const now = new Date();
  await prisma.productThread.update({
    where: { id: threadId },
    data: side === "client" ? { clientLastReadAt: now } : side === "seller" ? { sellerLastReadAt: now } : { teamLastReadAt: now },
  });

  const sellerUserId = thread.product.seller?.userId ?? null;
  const authorLabel = (m: (typeof messages)[number]): string => {
    if (m.authorId === viewer.user.id) return "Vous";
    if (m.fromClient) return clientName(thread.client);
    if (side === "client") return sellerLabel(thread);
    if (side === "seller") return "Équipe MISTERDOU";
    const name = [m.author.firstName, m.author.lastName].filter(Boolean).join(" ") || "Membre";
    const role = m.authorId === sellerUserId ? "Vendeur" : (ROLE_LABEL[m.author.role.name] ?? "Membre");
    return `${name} · ${role}`;
  };

  return {
    ...(await toSummary({ ...thread, ...(side === "client" ? { clientLastReadAt: now } : {}) }, side)),
    side,
    messages: messages.map((m) => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      mine: m.authorId === viewer.user.id,
      // Aligné à droite pour tout le côté du lecteur (le vendeur voit aussi les réponses de l'équipe « de son côté »).
      ownSide: side === "client" ? m.fromClient : !m.fromClient,
      author: authorLabel(m),
    })),
  };
}

/** Répondre dans un fil existant (client ou côté vente). */
export async function postInThread(threadId: string, viewer: ChatViewer, content: string) {
  const thread = await prisma.productThread.findUnique({ where: { id: threadId }, select: threadSelect });
  if (!thread) throw notFound("Discussion introuvable.");
  const side = await sideIn(thread, viewer);
  const fromClient = side === "client";
  const now = new Date();

  const message = await prisma.productMessage.create({
    data: { threadId, authorId: viewer.user.id, fromClient, content, createdAt: now },
    select: { id: true },
  });
  await prisma.productThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: now,
      ...(side === "client" ? { clientLastReadAt: now } : side === "seller" ? { sellerLastReadAt: now } : { teamLastReadAt: now }),
    },
  });

  const preview = content.slice(0, PREVIEW_LENGTH);
  if (fromClient) {
    const sellerUserId = thread.product.seller?.userId;
    if (sellerUserId) {
      await notifyUser(sellerUserId, "NEW_MESSAGE", {
        title: `Message de ${clientName(thread.client)}`,
        message: preview,
        actionUrl: `/seller/messages?thread=${threadId}`,
        priority: "NORMAL",
      });
    } else {
      await notifyActiveAdmins("NEW_MESSAGE", {
        title: `Question sur « ${thread.product.title} »`,
        message: preview,
        actionUrl: `/admin/discussions?thread=${threadId}`,
        priority: "NORMAL",
      });
    }
  } else {
    await notifyUser(thread.clientId, "NEW_MESSAGE", {
      title: `Réponse sur « ${thread.product.title} »`,
      message: preview,
      actionUrl: `/account/messages?thread=${threadId}`,
      priority: "NORMAL",
    });
  }
  return { messageId: message.id };
}
