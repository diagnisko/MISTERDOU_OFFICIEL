import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { ExchangeStatus, PaymentMode, Prisma, RoleName } from "@misterdou/db";
import { env } from "../../env.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { notifyTeam, notifyUser } from "../../lib/notify.js";
import { decryptString, encryptString } from "../../lib/storage.js";
import { publicUrl } from "../../lib/media.js";
import { confirmPrivateUpload, createPrivateUpload, deletePrivate, privateReadUrl, type PrivateRules } from "../../lib/private-media.js";
import type { AuthContext } from "../../lib/auth-context.js";
import { getIntSetting } from "../settings/service.js";
import { assertSplittable, createInstallmentPlan } from "../installments/service.js";
import { fieldError } from "../../lib/validation-messages.js";
import { deliverOrder } from "../orders/service.js";
import { holdsReservation } from "../orders/fulfillment.js";
import { findGameIdConflict, lockGameId, parseGameId } from "../offers/game-id.js";
import { fingerprintExchangeVideo } from "../media/fingerprint.js";
import { HOLD_STATUSES, OPEN_STATUSES } from "./hold.js";
import { ERASE_CLIENT_SECRETS, cancelExchangeForOrder } from "./lifecycle.js";

// ---------------------------------------------------------------------------
// Échange de comptes.
// 1. Le client propose son compte (ID eFootball + vidéo montrant un code
//    unique) contre une offre « échange accepté ». Il n'annonce aucun prix.
// 2. Le vendeur — ou l'équipe pour un compte MISTERDOU — annonce le complément
//    à ajouter (0 possible) ou refuse.
// 3. Le client accepte et confie ses identifiants, que seule l'équipe lit :
//    l'offre est alors tenue (hors boutique).
// 4. L'équipe (permission « Échanges ») se connecte au compte, peut demander un
//    code de connexion au client, puis valide ou refuse le compte.
// 5. Compte validé : commande du complément (Wave, une fois ou en mensualités) ;
//    sans complément, livraison immédiate. À la livraison, remise croisée.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export type ExchangeSide = "client" | "seller" | "team";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const createExchangeSchema = z.object({
  productId: z.string().uuid(),
  gameAccountId: text(1, 60),
  videoKey: text(10, 200),
  videoMime: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
  message: text(0, 1000).optional().nullable(),
  proofToken: text(10, 300),
});

export const replySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("quote"), topUpAmount: z.number().int().min(0).max(50_000_000), message: text(0, 500).optional().nullable() }),
  z.object({ decision: z.literal("reject"), message: text(3, 500) }),
]);

export const acceptSchema = z.object({
  paymentMode: z.enum(["ONE_TIME", "INSTALLMENTS"]).default("ONE_TIME"),
  login: text(3, 200),
  password: z.string().min(1).max(200),
});

export const custodyDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("confirm"), note: text(0, 500).optional().nullable() }),
  z.object({ decision: z.literal("refuse"), reason: text(5, 500) }),
]);

export const codeSchema = z.object({ code: text(3, 30) });
export const reportSchema = z.object({ message: text(10, 2000) });

const MAX_OPEN_PER_CLIENT = 5;

// --- Code à montrer dans la vidéo --------------------------------------------

const PROOF_KEY = createHmac("sha256", env.STORAGE_MASTER_KEY).update("exchange-proof-code").digest();
const PROOF_TTL_MS = 6 * 3_600_000;
const PROOF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function proofSignature(code: string, userId: string, productId: string, exp: number) {
  return createHmac("sha256", PROOF_KEY).update(`${code}|${userId}|${productId}|${exp}`).digest("base64url");
}

/** Code unique (valable 6 h) que le client écrit ou montre dans sa vidéo. */
export function issueProofCode(userId: string, productId: string) {
  const code = "MD-" + Array.from({ length: 4 }, () => PROOF_ALPHABET[randomInt(PROOF_ALPHABET.length)]).join("");
  const exp = Date.now() + PROOF_TTL_MS;
  return { code, token: `${code}.${exp}.${proofSignature(code, userId, productId, exp)}`, expiresAt: new Date(exp).toISOString() };
}

function readProofToken(token: string, userId: string, productId: string): string {
  const [code, rawExp, sig] = token.split(".");
  const exp = Number(rawExp);
  const expected = code && Number.isFinite(exp) ? Buffer.from(proofSignature(code, userId, productId, exp)) : null;
  const received = Buffer.from(sig ?? "");
  if (!code || !expected || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw badRequest("VALIDATION_ERROR", "Code de la vidéo invalide : rechargez la page de la demande.");
  }
  if (exp < Date.now()) throw badRequest("EXCHANGE_EXPIRED", "Le code de la vidéo a expiré : rechargez la page et filmez de nouveau.");
  return code;
}

// --- Accès ------------------------------------------------------------------

async function isExchangeTeam(auth: AuthContext): Promise<boolean> {
  const role = auth.user.role?.name;
  if (role === "ADMIN") return Boolean(auth.isAdminSession && auth.user.twoFactorEnabled);
  if (role !== "STAFF") return false;
  const profile = await prisma.managerProfile.findUnique({ where: { userId: auth.user.id }, select: { permissions: true } });
  return profile?.permissions.includes("EXCHANGES") ?? false;
}

const exchangeSelect = {
  id: true,
  number: true,
  productId: true,
  clientId: true,
  sellerId: true,
  gameAccountId: true,
  proofCode: true,
  videoKey: true,
  videoMime: true,
  videoPurgedAt: true,
  message: true,
  status: true,
  replyDeadline: true,
  topUpAmount: true,
  replyMessage: true,
  repliedAt: true,
  quoteExpiresAt: true,
  paymentMode: true,
  acceptedAt: true,
  encryptedLogin: true,
  custodyAt: true,
  custodyNote: true,
  custodyCodeRequestedAt: true,
  custodyCodeEncrypted: true,
  custodyCodeExpiresAt: true,
  orderId: true,
  completedAt: true,
  closedAt: true,
  closeReason: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { firstName: true, lastName: true, email: true, avatarKey: true } },
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      basePrice: true,
      paymentMode: true,
      installmentMonths: true,
      installmentDownPayment: true,
      acceptsExchange: true,
      deletedAt: true,
      sellerId: true,
      seller: { select: { userId: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } } },
      images: { where: { mimeType: { startsWith: "image/" } }, orderBy: { position: "asc" as const }, take: 1, select: { objectKey: true } },
    },
  },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      payments: {
        where: { status: { in: ["PENDING", "PROCESSING"] } },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { status: true, transactionToken: true },
      },
    },
  },
} satisfies Prisma.ExchangeRequestSelect;

type ExchangeRow = Prisma.ExchangeRequestGetPayload<{ select: typeof exchangeSelect }>;

async function sellerUserIdOf(row: { sellerId: string | null }): Promise<string | null> {
  if (!row.sellerId) return null;
  const seller = await prisma.seller.findUnique({ where: { id: row.sellerId }, select: { userId: true } });
  return seller?.userId ?? null;
}

/** Côté du lecteur, ou 404 (on ne révèle pas l'existence d'une demande d'autrui). */
async function sideOf(row: ExchangeRow, auth: AuthContext): Promise<ExchangeSide> {
  if (row.clientId === auth.user.id) return "client";
  if (row.sellerId && row.product.seller?.userId === auth.user.id) return "seller";
  if (await isExchangeTeam(auth)) return "team";
  throw notFound("Demande d’échange introuvable.");
}

async function load(id: string): Promise<ExchangeRow> {
  const row = await prisma.exchangeRequest.findUnique({ where: { id }, select: exchangeSelect });
  if (!row) throw notFound("Demande d’échange introuvable.");
  return row;
}

/** Peut répondre : le vendeur de l'offre ; pour un compte MISTERDOU, l'équipe « Échanges ». */
function canReply(row: ExchangeRow, side: ExchangeSide) {
  return row.sellerId ? side === "seller" : side === "team";
}

const publicName = (u: { firstName: string | null; lastName: string | null }, fallback: string) =>
  [u.firstName, u.lastName?.[0] ? `${u.lastName[0]}.` : null].filter(Boolean).join(" ") || fallback;

// --- Présentation -------------------------------------------------------------

async function toDto(row: ExchangeRow, side: ExchangeSide) {
  const now = Date.now();
  const topUp = row.topUpAmount ?? 0;
  const openPayment = row.order?.payments[0] ?? null;
  const videoUrl = row.videoKey && !row.videoPurgedAt ? await privateReadUrl(row.videoKey) : null;
  const splittable =
    row.product.paymentMode === "INSTALLMENTS" && topUp > 0 && installmentTerms(row.product, topUp) !== null;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    side,
    createdAt: row.createdAt.toISOString(),
    replyDeadline: row.replyDeadline.toISOString(),
    quoteExpiresAt: row.quoteExpiresAt?.toISOString() ?? null,
    topUpAmount: row.topUpAmount,
    replyMessage: row.replyMessage,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    message: row.message,
    gameAccountId: row.gameAccountId,
    proofCode: row.proofCode,
    video: videoUrl ? { url: videoUrl, mimeType: row.videoMime } : null,
    videoPurged: Boolean(row.videoPurgedAt),
    paymentMode: row.paymentMode,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    custodyAt: row.custodyAt?.toISOString() ?? null,
    custodyNote: side === "client" ? null : row.custodyNote,
    completedAt: row.completedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    product: {
      id: row.product.id,
      title: row.product.title,
      slug: row.product.slug,
      price: row.product.basePrice,
      available: row.product.status === "ACTIVE" && !row.product.deletedAt,
      imageUrl: row.product.images[0] ? publicUrl(row.product.images[0].objectKey) : null,
      // Le complément peut-il être réglé en mensualités ?
      canSplit: splittable,
    },
    // Ce que chaque côté voit de l'autre.
    seller: row.sellerId && row.product.seller ? publicName(row.product.seller.user, "Vendeur") : "MISTERDOU",
    client:
      side === "client"
        ? null
        : side === "team"
          ? { name: [row.client.firstName, row.client.lastName].filter(Boolean).join(" ") || "Client", email: row.client.email }
          : { name: publicName(row.client, "Client"), email: null },
    custody: {
      codeRequested: Boolean(row.custodyCodeRequestedAt) && row.status === "ACCEPTED",
      codeProvided: Boolean(row.custodyCodeEncrypted) && (row.custodyCodeExpiresAt?.getTime() ?? 0) > now,
      codeExpiresAt: row.custodyCodeExpiresAt?.toISOString() ?? null,
      // Le code saisi par le client s'affiche tout seul chez l'équipe (et elle seule),
      // tant qu'il est valable : pas de bouton à toucher pendant que le jeu attend.
      code:
        side === "team" && row.status === "ACCEPTED" && row.custodyCodeEncrypted && (row.custodyCodeExpiresAt?.getTime() ?? 0) > now
          ? readableCode(row.custodyCodeEncrypted)
          : null,
    },
    order: row.order
      ? {
          id: side === "client" ? row.order.id : null,
          orderNumber: row.order.orderNumber,
          status: row.order.status,
          checkoutUrl: side === "client" && openPayment?.status === "PENDING" && openPayment.transactionToken ? `/checkout/${openPayment.transactionToken}` : null,
          paymentUnderReview: openPayment?.status === "PROCESSING",
        }
      : null,
    actions: {
      reply: canReply(row, side) && (row.status === "PENDING" || row.status === "QUOTED"),
      accept: side === "client" && row.status === "QUOTED",
      decline: side === "client" && row.status === "QUOTED",
      cancel:
        side === "client" &&
        (["PENDING", "QUOTED", "ACCEPTED"].includes(row.status) || (row.status === "AWAITING_PAYMENT" && openPayment?.status !== "PROCESSING")),
      provideCode: side === "client" && row.status === "ACCEPTED" && Boolean(row.custodyCodeRequestedAt),
      custody: side === "team" && row.status === "ACCEPTED",
      revealClientAccount:
        (side === "team" && ["ACCEPTED", "AWAITING_PAYMENT", "COMPLETED"].includes(row.status) && Boolean(row.encryptedLogin)) ||
        (side === "seller" && row.status === "COMPLETED" && Boolean(row.encryptedLogin)),
      report: side === "seller" && row.status === "COMPLETED",
    },
  };
}

export type ExchangeDto = Awaited<ReturnType<typeof toDto>>;

function summary(row: ExchangeRow, side: ExchangeSide) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    topUpAmount: row.topUpAmount,
    gameAccountId: row.gameAccountId,
    product: {
      id: row.product.id,
      title: row.product.title,
      slug: row.product.slug,
      imageUrl: row.product.images[0] ? publicUrl(row.product.images[0].objectKey) : null,
    },
    counterpart:
      side === "client"
        ? row.sellerId && row.product.seller
          ? publicName(row.product.seller.user, "Vendeur")
          : "MISTERDOU"
        : side === "team"
          ? [row.client.firstName, row.client.lastName].filter(Boolean).join(" ") || "Client"
          : publicName(row.client, "Client"),
    sellerName: side === "team" ? (row.sellerId && row.product.seller ? publicName(row.product.seller.user, "Vendeur") : "MISTERDOU") : null,
    waitingFor: waitingFor(row),
  };
}

/** Code de connexion déchiffré ; illisible (clé changée…) : la page reste affichée, sans code. */
function readableCode(encrypted: string): string | null {
  try {
    return decryptString(encrypted);
  } catch (err) {
    logger.warn({ err }, "[exchanges] code de connexion illisible");
    return null;
  }
}

/** Qui doit agir maintenant (pastilles des listes). */
function waitingFor(row: { status: ExchangeStatus; sellerId: string | null; custodyCodeRequestedAt: Date | null; custodyCodeEncrypted: string | null }) {
  switch (row.status) {
    case "PENDING":
      return row.sellerId ? "seller" : "team";
    case "QUOTED":
      return "client";
    case "ACCEPTED":
      return row.custodyCodeRequestedAt && !row.custodyCodeEncrypted ? "client" : "team";
    case "AWAITING_PAYMENT":
      return "client";
    default:
      return null;
  }
}

// --- Préparation et demande (client) -------------------------------------------

async function videoRules(): Promise<PrivateRules> {
  const mb = Math.min(await getIntSetting("exchangeVideoMaxMb", 100), env.MEDIA_MAX_VIDEO_MB);
  return { kinds: ["video"], maxBytes: Math.max(1, mb) * 1024 * 1024 };
}

async function assertCanRequest(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== "ACTIVE") throw forbidden("Votre compte est suspendu.");
  const kyc = await prisma.identityVerification.findFirst({ where: { userId }, orderBy: { submittedAt: "desc" }, select: { status: true } });
  if (kyc?.status !== "VERIFIED") throw new ApiError("KYC_REQUIRED", 403, "Votre identité doit être vérifiée avant un échange.");
}

async function exchangeableProduct(productId: string, userId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: "ACTIVE", deletedAt: null, publishedAt: { not: null } },
    select: {
      id: true,
      title: true,
      slug: true,
      basePrice: true,
      acceptsExchange: true,
      sellerId: true,
      paymentMode: true,
      seller: { select: { userId: true } },
      images: { where: { mimeType: { startsWith: "image/" } }, orderBy: { position: "asc" }, take: 1, select: { objectKey: true } },
    },
  });
  if (!product) throw notFound("Compte introuvable ou retiré de la vente.");
  if (!product.acceptsExchange) throw conflict("EXCHANGE_UNAVAILABLE", "Ce compte n’est pas proposé à l’échange.");
  if (product.seller?.userId === userId) throw new ApiError("OWN_OFFER", 403, "C’est votre offre : vous ne pouvez pas l’échanger.");
  const held = await prisma.exchangeRequest.count({ where: { productId, status: { in: [...HOLD_STATUSES] } } });
  if (held > 0) throw conflict("PRODUCT_RESERVED", "Un échange est déjà en cours sur ce compte.");
  return product;
}

/** Page de demande : l'offre, le code à montrer dans la vidéo, la taille maximale. */
export async function prepareExchange(productId: string, auth: AuthContext) {
  await assertCanRequest(auth.user.id);
  const product = await exchangeableProduct(productId, auth.user.id);
  const rules = await videoRules();
  return {
    product: {
      id: product.id,
      title: product.title,
      slug: product.slug,
      price: product.basePrice,
      imageUrl: product.images[0] ? publicUrl(product.images[0].objectKey) : null,
    },
    proof: issueProofCode(auth.user.id, product.id),
    videoMaxBytes: rules.maxBytes,
    videoMaxSeconds: 120,
  };
}

export async function exchangeVideoUploadUrl(auth: AuthContext, mimeType: string, sizeBytes: number) {
  return createPrivateUpload(`exchange/${auth.user.id}`, mimeType, sizeBytes, await videoRules());
}

export async function createExchange(input: z.infer<typeof createExchangeSchema>, auth: AuthContext, ip?: string) {
  const userId = auth.user.id;
  await assertCanRequest(userId);
  const product = await exchangeableProduct(input.productId, userId);
  const proofCode = readProofToken(input.proofToken, userId, product.id);
  const gameAccountId = parseGameId(input.gameAccountId);

  const [mine, open] = await Promise.all([
    prisma.exchangeRequest.count({ where: { clientId: userId, productId: product.id, status: { in: [...OPEN_STATUSES] } } }),
    prisma.exchangeRequest.count({ where: { clientId: userId, status: { in: ["PENDING", "QUOTED"] } } }),
  ]);
  if (mine > 0) throw conflict("INVALID_STATE", "Vous avez déjà une demande d’échange en cours pour ce compte.");
  if (open >= MAX_OPEN_PER_CLIENT) {
    throw conflict("INVALID_STATE", `Vous avez déjà ${MAX_OPEN_PER_CLIENT} demandes d’échange en attente : attendez une réponse avant d’en envoyer d’autres.`);
  }

  // Le compte proposé ne doit pas être déjà en vente (ni confié dans un autre échange).
  const hit = await findGameIdConflict(prisma, gameAccountId);
  if (hit && !(hit.kind === "exchange" && hit.clientId === userId)) {
    await notifyTeam("EXCHANGES", "ADMIN_ALERT", {
      title: "Échange refusé : compte déjà en ligne",
      message: `Un client a proposé à l’échange le compte ${gameAccountId}, déjà ${hit.kind === "product" ? `publié dans « ${hit.title} »` : "confié dans un autre échange"}.`,
      actionUrl: hit.kind === "product" ? `/admin/offers?gameId=${encodeURIComponent(gameAccountId)}` : "/admin/echanges",
      priority: "CRITICAL",
    });
    throw fieldError("gameAccountId", `Ce compte (ID ${gameAccountId}) est déjà en vente sur MISTERDOU : il ne peut pas servir à un échange.`, "GAME_ID_IN_USE", 409);
  }

  if (!input.videoKey.startsWith(`exchange/${userId}/`)) throw fieldError("videoKey", "Vidéo invalide : choisissez-la de nouveau.");
  const { sizeBytes } = await confirmPrivateUpload(input.videoKey, input.videoMime, await videoRules());
  const used = await prisma.exchangeRequest.count({ where: { videoKey: input.videoKey } });
  if (used > 0) throw conflict("MEDIA_EXISTS", "Cette vidéo est déjà utilisée par une autre demande.");

  const replyHours = await getIntSetting("exchangeReplyHours", 48);
  const created = await prisma.exchangeRequest.create({
    data: {
      number: `EX-${new Date().getFullYear()}-${randomInt(100_000, 999_999)}`,
      productId: product.id,
      clientId: userId,
      sellerId: product.sellerId,
      gameAccountId,
      proofCode,
      videoKey: input.videoKey,
      videoMime: input.videoMime,
      videoSize: sizeBytes,
      message: input.message?.trim() || null,
      replyDeadline: new Date(Date.now() + Math.max(1, replyHours) * 3_600_000),
    },
    select: { id: true, number: true },
  });
  await logAudit({
    actorId: userId,
    actorRole: auth.user.role?.name as RoleName | undefined,
    ip,
    action: "EXCHANGE_REQUESTED",
    resourceType: "ExchangeRequest",
    resourceId: created.id,
    metadata: { number: created.number, productId: product.id, gameAccountId },
  });
  const notice = {
    title: "Nouvelle demande d’échange 🔁",
    message: `Un client propose son compte en échange de « ${product.title} » (${created.number}). Regardez sa vidéo et annoncez le complément à ajouter, ou refusez, sous ${replyHours} h.`,
    priority: "CRITICAL" as const,
  };
  if (product.seller) await notifyUser(product.seller.userId, "SYSTEM", { ...notice, actionUrl: `/seller/echanges?id=${created.id}` });
  else await notifyTeam("EXCHANGES", "ADMIN_ALERT", { ...notice, actionUrl: `/admin/echanges?id=${created.id}` });

  void fingerprintExchangeVideo(created.id).catch((err) => logger.warn({ err, exchangeId: created.id }, "[échanges] empreinte de la vidéo non calculée"));
  return created;
}

// --- Listes -------------------------------------------------------------------

export async function listMyExchanges(auth: AuthContext) {
  const rows = await prisma.exchangeRequest.findMany({
    where: { clientId: auth.user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: exchangeSelect,
  });
  return rows.map((r) => summary(r, "client"));
}

export async function listSellerExchanges(auth: AuthContext) {
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id }, select: { id: true } });
  if (!seller) throw forbidden("Réservé aux vendeurs.");
  const rows = await prisma.exchangeRequest.findMany({
    where: { sellerId: seller.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: exchangeSelect,
  });
  return rows.map((r) => summary(r, "seller"));
}

export const teamListQuery = z.object({
  status: z.enum(["todo", "open", "closed", "all"]).default("todo"),
});

/** Console : « à traiter » = comptes à vérifier + demandes MISTERDOU sans réponse. */
export async function listTeamExchanges(filter: z.infer<typeof teamListQuery>["status"]) {
  const where: Prisma.ExchangeRequestWhereInput =
    filter === "todo"
      ? { OR: [{ status: "ACCEPTED" }, { status: "PENDING", sellerId: null }] }
      : filter === "open"
        ? { status: { in: [...OPEN_STATUSES] } }
        : filter === "closed"
          ? { status: { notIn: [...OPEN_STATUSES] } }
          : {};
  const [rows, todo] = await Promise.all([
    prisma.exchangeRequest.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100, select: exchangeSelect }),
    prisma.exchangeRequest.count({ where: { OR: [{ status: "ACCEPTED" }, { status: "PENDING", sellerId: null }] } }),
  ]);
  return { items: rows.map((r) => summary(r, "team")), todo };
}

export async function getExchange(id: string, auth: AuthContext) {
  const row = await load(id);
  return toDto(row, await sideOf(row, auth));
}

// --- Réponse du vendeur (ou de l'équipe) -----------------------------------------

export async function replyToExchange(id: string, input: z.infer<typeof replySchema>, auth: AuthContext, ip?: string) {
  const row = await load(id);
  const side = await sideOf(row, auth);
  if (!canReply(row, side)) {
    throw forbidden(row.sellerId ? "C’est au vendeur de ce compte de répondre." : "Réservé à l’équipe (permission « Échanges »).");
  }
  if (row.status !== "PENDING" && row.status !== "QUOTED") throw conflict("INVALID_STATE", "Cette demande n’attend plus de réponse.");
  if (row.status === "PENDING" && row.replyDeadline.getTime() < Date.now()) throw conflict("EXCHANGE_EXPIRED", "Le délai de réponse est dépassé.");

  const now = new Date();
  const quote = input.decision === "quote";
  const quoteHours = await getIntSetting("exchangeQuoteHours", 48);
  const claim = await prisma.exchangeRequest.updateMany({
    where: { id: row.id, status: { in: ["PENDING", "QUOTED"] } },
    data: quote
      ? {
          status: "QUOTED",
          topUpAmount: input.topUpAmount,
          replyMessage: input.message?.trim() || null,
          repliedById: auth.user.id,
          repliedAt: now,
          quoteExpiresAt: new Date(now.getTime() + Math.max(1, quoteHours) * 3_600_000),
        }
      : { status: "REJECTED", replyMessage: input.message, repliedById: auth.user.id, repliedAt: now, closedAt: now, closeReason: input.message },
  });
  if (claim.count === 0) throw conflict("INVALID_STATE", "Cette demande n’attend plus de réponse.");

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role?.name as RoleName | undefined,
    ip,
    action: quote ? "EXCHANGE_QUOTED" : "EXCHANGE_REJECTED",
    resourceType: "ExchangeRequest",
    resourceId: row.id,
    metadata: quote ? { topUpAmount: input.topUpAmount } : { reason: input.message },
  });
  await notifyUser(row.clientId, "SYSTEM", quote
    ? {
        title: input.topUpAmount > 0 ? "Échange possible : réponse reçue" : "Échange direct accepté 🎉",
        message:
          input.topUpAmount > 0
            ? `Pour échanger votre compte contre « ${row.product.title} », ajoutez ${input.topUpAmount.toLocaleString("fr-FR")} FCFA. Répondez sous ${quoteHours} h.`
            : `Votre compte s’échange contre « ${row.product.title} » sans rien ajouter. Confirmez sous ${quoteHours} h.`,
        actionUrl: `/account/echanges?id=${row.id}`,
        priority: "CRITICAL",
      }
    : {
        title: "Échange refusé",
        message: `Votre demande pour « ${row.product.title} » n’est pas acceptée : « ${input.message} ».`,
        actionUrl: `/account/echanges?id=${row.id}`,
        priority: "NORMAL",
      });
  return getExchange(row.id, auth);
}

// --- Accord du client ------------------------------------------------------------

/** Mensualités du complément : même nombre de mois que l'offre, apport au prorata. */
function installmentTerms(
  product: { paymentMode: PaymentMode; basePrice: number; installmentMonths: number | null; installmentDownPayment: number | null },
  topUp: number,
): { months: number; downPayment: number } | null {
  if (product.paymentMode !== "INSTALLMENTS" || topUp <= 0 || !product.installmentMonths) return null;
  const downPayment = Math.round((topUp * (product.installmentDownPayment ?? 0)) / Math.max(1, product.basePrice));
  try {
    return assertSplittable({ total: topUp, months: product.installmentMonths, downPayment });
  } catch {
    return null;
  }
}

export async function acceptExchange(id: string, input: z.infer<typeof acceptSchema>, auth: AuthContext, ip?: string) {
  const row = await load(id);
  if ((await sideOf(row, auth)) !== "client") throw forbidden("Seul le client peut accepter.");
  if (row.status !== "QUOTED") throw conflict("INVALID_STATE", "Aucune proposition à accepter.");
  if (!row.quoteExpiresAt || row.quoteExpiresAt.getTime() < Date.now()) throw conflict("EXCHANGE_EXPIRED", "La proposition a expiré.");
  if (row.product.status !== "ACTIVE" || row.product.deletedAt || !row.product.acceptsExchange) {
    throw conflict("EXCHANGE_UNAVAILABLE", "Ce compte n’est plus disponible à l’échange.");
  }
  const topUp = row.topUpAmount ?? 0;
  let paymentMode: PaymentMode = "ONE_TIME";
  if (input.paymentMode === "INSTALLMENTS") {
    if (!installmentTerms(row.product, topUp)) throw conflict("INSTALLMENTS_UNAVAILABLE", "Ce complément se règle en un seul paiement.");
    paymentMode = "INSTALLMENTS";
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Un seul échange (ou achat) à la fois sur une offre.
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${row.productId} FOR UPDATE`;
    const held = await tx.exchangeRequest.count({ where: { productId: row.productId, status: { in: [...HOLD_STATUSES] } } });
    const reserved = await tx.order.count({ where: { ...holdsReservation(now), items: { some: { productId: row.productId } } } });
    if (held > 0 || reserved > 0) throw conflict("PRODUCT_RESERVED", "Ce compte vient d’être réservé par un autre client.");
    await lockGameId(tx, row.gameAccountId);
    const hit = await findGameIdConflict(tx, row.gameAccountId, { exchangeId: row.id });
    if (hit) throw conflict("GAME_ID_IN_USE", `Votre compte (ID ${row.gameAccountId}) est déjà engagé ailleurs sur MISTERDOU.`);
    const claim = await tx.exchangeRequest.updateMany({
      where: { id: row.id, status: "QUOTED" },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
        paymentMode,
        encryptedLogin: encryptString(input.login.trim()),
        encryptedPassword: encryptString(input.password),
      },
    });
    if (claim.count === 0) throw conflict("INVALID_STATE", "Aucune proposition à accepter.");
    // Ce compte est engagé ici : ses autres demandes en attente sont closes.
    await tx.exchangeRequest.updateMany({
      where: { clientId: row.clientId, gameAccountId: row.gameAccountId, id: { not: row.id }, status: { in: ["PENDING", "QUOTED"] } },
      data: { status: "CANCELLED", closedAt: now, closeReason: `Compte engagé dans l’échange ${row.number}.` },
    });
  });

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role?.name as RoleName | undefined,
    ip,
    action: "EXCHANGE_ACCEPTED",
    resourceType: "ExchangeRequest",
    resourceId: row.id,
    metadata: { number: row.number, topUpAmount: topUp, paymentMode },
    severity: "WARNING",
  });
  await notifyTeam(
    "EXCHANGES",
    "ADMIN_ALERT",
    {
      title: "Compte à récupérer (échange)",
      message: `${row.number} : le client a confié son compte (ID ${row.gameAccountId}) contre « ${row.product.title} ». Connectez-vous, vérifiez-le par rapport à la vidéo, puis validez.`,
      actionUrl: `/admin/echanges?id=${row.id}`,
      priority: "CRITICAL",
    },
    { tag: `exchange-${row.id}` },
  );
  const sellerUser = await sellerUserIdOf(row);
  if (sellerUser) {
    await notifyUser(sellerUser, "SYSTEM", {
      title: "Échange accepté par le client",
      message: `Le client accepte votre proposition pour « ${row.product.title} » (${row.number}). L’équipe vérifie son compte ; l’offre est retirée de la boutique d’ici là.`,
      actionUrl: `/seller/echanges?id=${row.id}`,
      priority: "NORMAL",
    });
  }
  return getExchange(row.id, auth);
}

export async function declineExchange(id: string, auth: AuthContext, ip?: string) {
  const row = await load(id);
  if ((await sideOf(row, auth)) !== "client") throw forbidden("Seul le client peut décliner.");
  const claim = await prisma.exchangeRequest.updateMany({
    where: { id: row.id, status: "QUOTED" },
    data: { status: "DECLINED", closedAt: new Date(), closeReason: "Proposition déclinée par le client." },
  });
  if (claim.count === 0) throw conflict("INVALID_STATE", "Aucune proposition à décliner.");
  await logAudit({ actorId: auth.user.id, ip, action: "EXCHANGE_DECLINED", resourceType: "ExchangeRequest", resourceId: row.id });
  const sellerUser = await sellerUserIdOf(row);
  if (sellerUser) {
    await notifyUser(sellerUser, "SYSTEM", {
      title: "Proposition d’échange déclinée",
      message: `Le client ne donne pas suite à votre proposition pour « ${row.product.title} » (${row.number}).`,
      actionUrl: `/seller/echanges?id=${row.id}`,
      priority: "LOW",
    });
  }
  return getExchange(row.id, auth);
}

/** Le client renonce (avant la commande, ou tant que le complément n'est pas en vérification). */
export async function cancelExchange(id: string, auth: AuthContext, ip?: string) {
  const row = await load(id);
  if ((await sideOf(row, auth)) !== "client") throw forbidden("Seul le client peut annuler sa demande.");
  const reason = "Demande annulée par le client.";

  if (row.status === "AWAITING_PAYMENT" && row.orderId) {
    const orderId = row.orderId;
    const done = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING_PAYMENT", payments: { none: { status: { in: ["PROCESSING", "SUCCESS"] } } } },
        data: { status: "CANCELLED" },
      });
      if (claim.count === 0) return false;
      await tx.payment.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "CANCELLED", failureReason: reason } });
      const plan = await tx.installmentPlan.findUnique({ where: { orderId }, select: { id: true } });
      if (plan) {
        await tx.installmentPlan.update({ where: { id: plan.id }, data: { status: "CANCELLED" } });
        await tx.installment.updateMany({ where: { planId: plan.id, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "CANCELLED" } });
      }
      return true;
    });
    if (!done) throw conflict("INVALID_STATE", "Votre paiement est en cours de vérification : l’échange ne peut plus être annulé.");
    await cancelExchangeForOrder(orderId, reason);
  } else {
    const claim = await prisma.exchangeRequest.updateMany({
      where: { id: row.id, status: { in: ["PENDING", "QUOTED", "ACCEPTED"] } },
      data: { status: "CANCELLED", closedAt: new Date(), closeReason: reason, ...ERASE_CLIENT_SECRETS },
    });
    if (claim.count === 0) throw conflict("INVALID_STATE", "Cette demande ne peut plus être annulée.");
    const sellerUser = await sellerUserIdOf(row);
    if (sellerUser) {
      await notifyUser(sellerUser, "SYSTEM", {
        title: `Échange ${row.number} annulé`,
        message: `Le client a annulé sa demande pour « ${row.product.title} ».`,
        actionUrl: `/seller/echanges?id=${row.id}`,
        priority: "LOW",
      });
    }
    if (row.status === "ACCEPTED") {
      await notifyTeam("EXCHANGES", "ADMIN_ALERT", {
        title: `Échange ${row.number} annulé`,
        message: "Le client a annulé : ne poursuivez pas la vérification de son compte.",
        actionUrl: `/admin/echanges?id=${row.id}`,
        priority: "NORMAL",
      });
    }
  }
  await logAudit({ actorId: auth.user.id, ip, action: "EXCHANGE_CANCELLED", resourceType: "ExchangeRequest", resourceId: row.id, metadata: { by: "client" } });
  return getExchange(row.id, auth);
}

// --- Vérification du compte par l'équipe ------------------------------------------------

async function teamRow(id: string, auth: AuthContext) {
  const row = await load(id);
  if ((await sideOf(row, auth)) !== "team") throw forbidden("Réservé à l’équipe (permission « Échanges »).");
  return row;
}

/** L'équipe a besoin d'un code de connexion : le client est prévenu. */
export async function requestCustodyCode(id: string, auth: AuthContext, ip?: string) {
  const row = await teamRow(id, auth);
  if (row.status !== "ACCEPTED") throw conflict("INVALID_STATE", "Ce compte n’est pas en vérification.");
  await prisma.exchangeRequest.update({
    where: { id: row.id },
    data: { custodyCodeRequestedAt: new Date(), custodyCodeEncrypted: null, custodyCodeExpiresAt: null },
  });
  await logAudit({ actorId: auth.user.id, ip, action: "EXCHANGE_CODE_REQUESTED", resourceType: "ExchangeRequest", resourceId: row.id });
  await notifyUser(row.clientId, "SYSTEM", {
    title: "Code de connexion demandé",
    message: `Pour vérifier votre compte (échange ${row.number}), l’équipe a besoin du code reçu par e-mail. Saisissez-le vite : il ne reste valable que quelques minutes.`,
    actionUrl: `/account/echanges?id=${row.id}`,
    priority: "CRITICAL",
  });
  return getExchange(row.id, auth);
}

/** Le client transmet le code de connexion demandé (valable 10 minutes). */
export async function provideCustodyCode(id: string, code: string, auth: AuthContext, ip?: string) {
  const row = await load(id);
  if ((await sideOf(row, auth)) !== "client") throw forbidden();
  if (row.status !== "ACCEPTED" || !row.custodyCodeRequestedAt) throw conflict("INVALID_STATE", "Aucun code n’est demandé.");
  const ttl = await getIntSetting("verificationCodeTtlMinutes", 10);
  await prisma.exchangeRequest.update({
    where: { id: row.id },
    data: { custodyCodeEncrypted: encryptString(code.trim()), custodyCodeExpiresAt: new Date(Date.now() + ttl * 60_000) },
  });
  await logAudit({ actorId: auth.user.id, ip, action: "EXCHANGE_CODE_PROVIDED", resourceType: "ExchangeRequest", resourceId: row.id });
  await notifyTeam(
    "EXCHANGES",
    "ADMIN_ALERT",
    {
      title: "Code de connexion reçu",
      message: `${row.number} : le client a donné son code (valable ${ttl} min). Connectez-vous maintenant.`,
      actionUrl: `/admin/echanges?id=${row.id}`,
      priority: "CRITICAL",
    },
    { tag: `exchange-${row.id}` },
  );
  return getExchange(row.id, auth);
}

/**
 * Identifiants du compte du client : l'équipe pendant et après la vérification,
 * le vendeur une fois l'échange conclu. Chaque affichage est journalisé.
 */
export async function revealClientAccount(id: string, auth: AuthContext, ip?: string) {
  const row = await load(id);
  const side = await sideOf(row, auth);
  const allowed =
    (side === "team" && ["ACCEPTED", "AWAITING_PAYMENT", "COMPLETED"].includes(row.status)) || (side === "seller" && row.status === "COMPLETED");
  if (!allowed) throw forbidden("Les identifiants ne sont pas disponibles à cette étape.");
  const full = await prisma.exchangeRequest.findUnique({
    where: { id: row.id },
    select: { encryptedLogin: true, encryptedPassword: true, custodyCodeEncrypted: true, custodyCodeExpiresAt: true },
  });
  if (!full?.encryptedLogin || !full.encryptedPassword) throw notFound("Identifiants effacés.");
  let login: string;
  let password: string;
  try {
    login = decryptString(full.encryptedLogin);
    password = decryptString(full.encryptedPassword);
  } catch {
    throw badRequest("CREDENTIAL_UNREADABLE", "Identifiants illisibles.");
  }
  const code =
    side === "team" && full.custodyCodeEncrypted && (full.custodyCodeExpiresAt?.getTime() ?? 0) > Date.now()
      ? decryptString(full.custodyCodeEncrypted)
      : null;
  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role?.name as RoleName | undefined,
    ip,
    action: "EXCHANGE_CLIENT_ACCOUNT_REVEALED",
    resourceType: "ExchangeRequest",
    resourceId: row.id,
    metadata: { side },
    severity: "WARNING",
  });
  return { number: row.number, gameAccountId: row.gameAccountId, login, password, code, codeExpiresAt: code ? full.custodyCodeExpiresAt!.toISOString() : null };
}

/** Commande du complément (montant = complément, éventuellement en mensualités). */
async function createExchangeOrder(tx: Tx, row: ExchangeRow): Promise<{ orderId: string; token: string | null }> {
  const topUp = row.topUpAmount ?? 0;
  const product = await tx.product.findUniqueOrThrow({
    where: { id: row.productId },
    select: { id: true, title: true, division: true, teamPower: true, coins: true, sellerId: true },
  });
  const terms = row.paymentMode === "INSTALLMENTS" ? installmentTerms(row.product, topUp) : null;
  const split = terms !== null;
  const orderNumber = `MD-${new Date().getFullYear()}-${randomInt(1_000_000, 9_999_999)}`;
  const token = topUp > 0 ? `mdpay_${randomBytes(18).toString("base64url")}` : null;
  const order = await tx.order.create({
    data: {
      orderNumber,
      buyerId: row.clientId,
      status: "PENDING_PAYMENT",
      paymentMode: split ? "INSTALLMENTS" : "ONE_TIME",
      totalAmount: topUp,
      buyerMessage: `Échange ${row.number}`,
      items: {
        create: {
          productId: product.id,
          title: product.title,
          division: product.division,
          teamPower: product.teamPower,
          coins: product.coins,
          unitPrice: topUp,
          quantity: 1,
          sellerId: product.sellerId,
        },
      },
      ...(token
        ? {
            payments: {
              create: {
                userId: row.clientId,
                paymentNumber: `PAY-${orderNumber}`,
                type: split ? "INITIAL_INSTALLMENT" : "ORDER_PAYMENT",
                amount: split ? terms!.downPayment : topUp,
                currency: "XOF",
                provider: "WAVE_LINK",
                status: "PENDING",
                transactionToken: token,
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  if (split && token) {
    const plan = await createInstallmentPlan(tx, {
      orderId: order.id,
      orderNumber,
      buyerId: row.clientId,
      totalAmount: topUp,
      downPayment: terms!.downPayment,
      months: terms!.months,
      from: new Date(),
    });
    await tx.payment.updateMany({ where: { transactionToken: token }, data: { installmentPlanId: plan.id } });
  }
  await tx.exchangeRequest.update({ where: { id: row.id }, data: { orderId: order.id } });
  return { orderId: order.id, token };
}

export async function decideCustody(id: string, input: z.infer<typeof custodyDecisionSchema>, auth: AuthContext, ip?: string) {
  const row = await teamRow(id, auth);
  if (row.status !== "ACCEPTED") throw conflict("INVALID_STATE", "Ce compte n’est pas en vérification.");
  const now = new Date();
  const sellerUser = await sellerUserIdOf(row);

  if (input.decision === "refuse") {
    const claim = await prisma.exchangeRequest.updateMany({
      where: { id: row.id, status: "ACCEPTED" },
      data: {
        status: "CUSTODY_REFUSED",
        custodyById: auth.user.id,
        custodyAt: now,
        custodyNote: input.reason,
        closedAt: now,
        closeReason: input.reason,
        ...ERASE_CLIENT_SECRETS,
      },
    });
    if (claim.count === 0) throw conflict("INVALID_STATE", "Ce compte n’est pas en vérification.");
    await logAudit({
      actorId: auth.user.id,
      ip,
      action: "EXCHANGE_CUSTODY_REFUSED",
      resourceType: "ExchangeRequest",
      resourceId: row.id,
      metadata: { reason: input.reason },
      severity: "WARNING",
    });
    await notifyUser(row.clientId, "SYSTEM", {
      title: `Échange ${row.number} : compte refusé`,
      message: `L’équipe n’a pas pu valider votre compte : « ${input.reason} ». L’échange est annulé. Par précaution, changez le mot de passe de votre compte.`,
      actionUrl: `/account/echanges?id=${row.id}`,
      priority: "CRITICAL",
    });
    if (sellerUser) {
      await notifyUser(sellerUser, "SYSTEM", {
        title: `Échange ${row.number} annulé`,
        message: `Le compte du client n’a pas été validé par l’équipe. « ${row.product.title} » est de nouveau en vente.`,
        actionUrl: `/seller/echanges?id=${row.id}`,
        priority: "NORMAL",
      });
    }
    return getExchange(row.id, auth);
  }

  const topUp = row.topUpAmount ?? 0;
  const { token } = await prisma.$transaction(async (tx) => {
    const claim = await tx.exchangeRequest.updateMany({
      where: { id: row.id, status: "ACCEPTED" },
      data: { status: "AWAITING_PAYMENT", custodyById: auth.user.id, custodyAt: now, custodyNote: input.note?.trim() || null },
    });
    if (claim.count === 0) throw conflict("INVALID_STATE", "Ce compte n’est pas en vérification.");
    const created = await createExchangeOrder(tx, row);
    // Sans complément : livraison immédiate, la remise croisée a lieu tout de suite.
    if (topUp === 0) await deliverOrder(tx, created.orderId, { ctx: { actorId: auth.user.id, ip } });
    return created;
  });

  await logAudit({
    actorId: auth.user.id,
    ip,
    action: "EXCHANGE_CUSTODY_CONFIRMED",
    resourceType: "ExchangeRequest",
    resourceId: row.id,
    metadata: { number: row.number, topUpAmount: topUp },
    severity: "WARNING",
  });
  if (topUp > 0) {
    await notifyUser(row.clientId, "SYSTEM", {
      title: "Compte vérifié : réglez le complément",
      message: `L’équipe a validé votre compte (${row.number}). Réglez ${topUp.toLocaleString("fr-FR")} FCFA pour recevoir « ${row.product.title} ».`,
      actionUrl: `/checkout/${token}`,
      priority: "CRITICAL",
    });
    if (sellerUser) {
      await notifyUser(sellerUser, "SYSTEM", {
        title: "Compte du client vérifié",
        message: `${row.number} : l’équipe a validé le compte du client. L’échange se conclut dès que le complément est payé.`,
        actionUrl: `/seller/echanges?id=${row.id}`,
        priority: "NORMAL",
      });
    }
  }
  return getExchange(row.id, auth);
}

// --- Signalement du vendeur après l'échange ---------------------------------------------

export async function reportExchange(id: string, message: string, auth: AuthContext, ip?: string) {
  const row = await load(id);
  if ((await sideOf(row, auth)) !== "seller") throw forbidden("Réservé au vendeur de ce compte.");
  if (row.status !== "COMPLETED" || !row.completedAt || !row.orderId) throw conflict("INVALID_STATE", "L’échange n’est pas conclu.");
  const days = await getIntSetting("payoutHoldDays", 3);
  if (Date.now() - row.completedAt.getTime() > days * 86_400_000) {
    throw conflict("INVALID_STATE", `Le délai de signalement (${days} jours après l’échange) est dépassé : contactez le support.`);
  }
  const ticket = await prisma.supportTicket.create({
    data: {
      orderId: row.orderId,
      reporterId: auth.user.id,
      category: "OTHER",
      subject: `Échange ${row.number} : problème sur le compte reçu`,
      description: message,
    },
    select: { id: true },
  });
  await logAudit({
    actorId: auth.user.id,
    ip,
    action: "EXCHANGE_REPORTED",
    resourceType: "ExchangeRequest",
    resourceId: row.id,
    metadata: { ticketId: ticket.id },
    severity: "CRITICAL",
  });
  for (const permission of ["EXCHANGES", "SUPPORT"] as const) {
    await notifyTeam(permission, "ADMIN_ALERT", {
      title: `Échange ${row.number} signalé par le vendeur`,
      message: message.slice(0, 160),
      actionUrl: `/admin/support`,
      priority: "CRITICAL",
    });
  }
  return { ticketId: ticket.id };
}

// --- Tâches automatiques ------------------------------------------------------------------

export async function runExchangeJobs(now = new Date()): Promise<{ expired: number; purged: number }> {
  let expired = 0;
  const stale = await prisma.exchangeRequest.findMany({
    where: {
      OR: [
        { status: "PENDING", replyDeadline: { lt: now } },
        { status: "QUOTED", quoteExpiresAt: { lt: now } },
      ],
    },
    take: 200,
    select: { id: true, number: true, status: true, clientId: true, sellerId: true, product: { select: { title: true } } },
  });
  for (const e of stale) {
    const reason = e.status === "PENDING" ? "Pas de réponse dans les délais." : "Proposition non acceptée dans les délais.";
    const claim = await prisma.exchangeRequest.updateMany({
      where: { id: e.id, status: e.status },
      data: { status: "EXPIRED", closedAt: now, closeReason: reason },
    });
    if (claim.count === 0) continue;
    expired += 1;
    await notifyUser(e.clientId, "SYSTEM", {
      title: `Demande d’échange ${e.number} expirée`,
      message: `${reason} Votre demande pour « ${e.product.title} » est close.`,
      actionUrl: `/account/echanges?id=${e.id}`,
      priority: "LOW",
    });
    const sellerUser = await sellerUserIdOf(e);
    if (sellerUser) {
      await notifyUser(sellerUser, "SYSTEM", {
        title: `Demande d’échange ${e.number} expirée`,
        message: `${reason} (« ${e.product.title} »).`,
        actionUrl: `/seller/echanges?id=${e.id}`,
        priority: "LOW",
      });
    }
  }

  // Vidéos : effacées après le délai de conservation suivant la fin de l'échange.
  const days = await getIntSetting("exchangeVideoRetentionDays", 30);
  const old = await prisma.exchangeRequest.findMany({
    where: { closedAt: { lt: new Date(now.getTime() - days * 86_400_000) }, videoKey: { not: null }, videoPurgedAt: null },
    take: 100,
    select: { id: true, videoKey: true },
  });
  let purged = 0;
  for (const e of old) {
    try {
      await deletePrivate(e.videoKey!);
      await prisma.exchangeRequest.update({ where: { id: e.id }, data: { videoPurgedAt: now } });
      purged += 1;
    } catch (err) {
      logger.warn({ err, exchangeId: e.id }, "[échanges] vidéo non effacée, nouvel essai plus tard");
    }
  }
  return { expired, purged };
}

export function startExchangeJobs(): NodeJS.Timeout {
  const run = async () => {
    try {
      const result = await runExchangeJobs();
      if (result.expired || result.purged) logger.info(result, "[échanges] demandes expirées, vidéos effacées");
    } catch (err) {
      logger.error({ err }, "[échanges] échec de la tâche des échanges");
    }
  };
  void run();
  const timer = setInterval(() => void run(), 30 * 60 * 1000);
  timer.unref();
  return timer;
}
