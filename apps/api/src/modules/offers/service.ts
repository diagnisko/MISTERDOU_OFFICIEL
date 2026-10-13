import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { fieldError, validationError } from "../../lib/validation-messages.js";
import { decryptString, encryptString } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { notifyTeam, notifyUser } from "../../lib/notify.js";
import { publicUrl } from "../../lib/media.js";
import { getIntSetting } from "../settings/service.js";
import { holdsReservation } from "../orders/fulfillment.js";
import { HOLD_STATUSES } from "../exchanges/hold.js";
import { assertGameIdFree, gameIdHistory, lockGameId, parseGameId } from "./game-id.js";
import { duplicateMediaFor } from "../media/fingerprint.js";
import { closeOpenExchangeRequests } from "../exchanges/lifecycle.js";

// ---------------------------------------------------------------------------
// Création et modification des offres.
// - Vendeur actif : son offre (nouvelle ou modifiée) attend la validation de
//   l'équipe (PENDING_REVIEW) avant d'apparaître sur le site. Refusée, elle
//   redevient un brouillon avec le motif ; le vendeur corrige et la renvoie.
// - Équipe (permission PRODUCTS) : offres MISTERDOU (sans vendeur), publiées
//   directement, et validation des offres des vendeurs.
// Les identifiants du compte sont chiffrés dès réception et ne sont jamais
// renvoyés en clair : ils ne sont remis qu'à l'acheteur, après paiement.
// ---------------------------------------------------------------------------

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const baseFields = {
  title: text(3, 120),
  description: text(10, 2000),
  division: text(2, 40),
  teamPower: z.number().int().min(0).max(100_000),
  coins: z.number().int().min(0).max(10_000_000),
  extraInfo: text(0, 1000).optional().nullable(),
  basePrice: z.number().int().min(500).max(50_000_000),
  paymentMode: z.enum(["ONE_TIME", "INSTALLMENTS"]),
  installmentMonths: z.number().int().min(2).max(24).optional().nullable(),
  installmentDownPayment: z.number().int().min(0).optional().nullable(),
  // ID du compte dans eFootball : obligatoire, unique sur le site (voir game-id.ts).
  gameAccountId: z.string().trim().min(1, "ID eFootball obligatoire").max(60),
  acceptsExchange: z.boolean().default(false),
};

const credentialsFields = {
  loginId: text(3, 200),
  password: z.string().min(1).max(200),
};

export const createOfferSchema = z.object({ ...baseFields, credentials: z.object(credentialsFields) });
/** Clé d'accès seule (saisie ou remplacement, à tout moment). */
export const credentialSchema = z.object(credentialsFields);
// Modification : identifiants facultatifs (les anciens restent s'ils sont absents).
export const updateOfferSchema = z.object({ ...baseFields, credentials: z.object(credentialsFields).optional() });

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

// seller : ses offres ; team : offres MISTERDOU ; moderator : toute offre (suppression par l'équipe).
export type OfferOwner = { kind: "seller"; sellerId: string } | { kind: "team" } | { kind: "moderator" };

export interface OfferActor {
  actorId: string;
  actorRole?: RoleName;
  ip?: string;
}

/** Lit un corps de requête ; sinon, erreur en français simple, champ par champ. */
export function parseOffer<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

/** Règles de paiement : mensualités cohérentes avec le prix et le plafond du site. */
async function paymentTerms(input: UpdateOfferInput) {
  if (input.paymentMode === "ONE_TIME") return { installmentMonths: null, installmentDownPayment: null };
  const max = await getIntSetting("maxInstallments", 8);
  const months = input.installmentMonths ?? null;
  if (months === null || months < 2 || months > max) {
    throw fieldError("installmentMonths", `Entre 2 et ${max} mois.`);
  }
  const down = input.installmentDownPayment ?? 0;
  if (down >= input.basePrice) throw fieldError("installmentDownPayment", "L’apport doit être plus petit que le prix.");
  return { installmentMonths: months, installmentDownPayment: down };
}

function slugFor(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "offre"}-${randomBytes(3).toString("hex")}`;
}

function fields(input: UpdateOfferInput) {
  return {
    title: input.title,
    description: input.description,
    division: input.division,
    teamPower: input.teamPower,
    coins: input.coins,
    extraInfo: input.extraInfo?.trim() || null,
    basePrice: input.basePrice,
    paymentMode: input.paymentMode,
    gameAccountId: parseGameId(input.gameAccountId),
    acceptsExchange: input.acceptsExchange,
  };
}

/** Qui publie, pour l'alerte envoyée à l'équipe quand l'ID est déjà en ligne. */
async function publisherLabel(owner: OfferOwner): Promise<string> {
  if (owner.kind !== "seller") return "L’équipe a voulu publier une offre MISTERDOU";
  const seller = await prisma.seller.findUnique({
    where: { id: owner.sellerId },
    select: { user: { select: { firstName: true, lastName: true, email: true } } },
  });
  const name = [seller?.user.firstName, seller?.user.lastName].filter(Boolean).join(" ") || seller?.user.email || "Un vendeur";
  return `${name} a voulu publier une offre`;
}

function encryptedCredentials(c: { loginId: string; password: string }) {
  return { encryptedEmail: encryptString(c.loginId), encryptedPassword: encryptString(c.password) };
}

/** Vendeur actif du compte connecté (sinon refus). */
export async function activeSellerId(userId: string): Promise<string> {
  const seller = await prisma.seller.findUnique({ where: { userId }, select: { id: true, status: true } });
  if (!seller) throw forbidden("Devenez vendeur pour publier une offre.");
  if (seller.status !== "ACTIVE") throw forbidden("Votre compte vendeur n’est pas actif.");
  return seller.id;
}

export async function createOffer(input: CreateOfferInput, owner: OfferOwner, actor: OfferActor) {
  const terms = await paymentTerms(input);
  const data = fields(input);
  const sellerId = owner.kind === "seller" ? owner.sellerId : null;
  const context = await publisherLabel(owner);
  const now = new Date();
  const product = await prisma.$transaction(async (tx) => {
    await lockGameId(tx, data.gameAccountId);
    await assertGameIdFree(tx, data.gameAccountId, { sellerId, context });
    return tx.product.create({
      data: {
        ...data,
        ...terms,
        slug: slugFor(input.title),
        ownerType: owner.kind === "seller" ? "VENDOR" : "ADMIN",
        sellerId,
        // Offre d'un vendeur : en ligne seulement après validation de l'équipe.
        status: owner.kind === "seller" ? "PENDING_REVIEW" : "ACTIVE",
        publishedAt: owner.kind === "seller" ? null : now,
        credential: { create: encryptedCredentials(input.credentials) },
      },
      select: { id: true, slug: true },
    });
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "OFFER_CREATED",
    resourceType: "Product",
    resourceId: product.id,
    metadata: { owner: owner.kind, basePrice: input.basePrice, paymentMode: input.paymentMode },
  });
  if (owner.kind === "seller") await askForReview(input.title, false);
  return product;
}

/** Prévient l'équipe (admins, managers « Produits ») qu'une offre attend sa validation. */
async function askForReview(title: string, edited: boolean) {
  await notifyTeam("PRODUCTS", "ADMIN_ALERT", {
    title: edited ? "Offre modifiée à revalider" : "Nouvelle offre à valider",
    message: `« ${title} » attend votre validation avant d’apparaître sur le site.`,
    actionUrl: "/admin/offers?status=PENDING_REVIEW",
    priority: "NORMAL",
  });
}

/** Offre modifiable par cet auteur : la sienne, ni vendue, ni en cours d'achat. */
async function editable(productId: string, owner: OfferOwner) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      slug: true,
      status: true,
      sellerId: true,
      title: true,
      seller: { select: { userId: true } },
      ...CONTENT_SELECT,
    },
  });
  if (!product) throw notFound("Offre introuvable.");
  const mine =
    owner.kind === "moderator" ? true : owner.kind === "seller" ? product.sellerId === owner.sellerId : product.sellerId === null;
  if (!mine) throw forbidden("Cette offre ne vous appartient pas.");
  if (product.status === "SOLD") throw conflict("INVALID_STATE", "Cette offre est vendue : elle ne peut plus être modifiée.");
  // Bloquent la modification : un achat en tranches ouvert, ou une commande qui
  // réserve encore le compte (récente, ou preuve Wave en vérification).
  const busy = await prisma.orderItem.count({
    where: { productId, order: { OR: [{ status: { in: ["PARTIALLY_PAID", "PAID"] } }, holdsReservation()] } },
  });
  if (busy > 0) throw conflict("PRODUCT_RESERVED", "Un achat est en cours sur cette offre : réessayez plus tard.");
  const exchanging = await prisma.exchangeRequest.count({ where: { productId, status: { in: [...HOLD_STATUSES] } } });
  if (exchanging > 0) throw conflict("PRODUCT_RESERVED", "Un échange est en cours sur cette offre : réessayez quand il sera terminé.");
  return product;
}

// Contenu d'une offre : le changer renvoie l'offre d'un vendeur en validation.
// « Échange accepté » n'en fait pas partie (simple préférence du vendeur).
const CONTENT_SELECT = {
  description: true,
  division: true,
  teamPower: true,
  coins: true,
  extraInfo: true,
  basePrice: true,
  paymentMode: true,
  installmentMonths: true,
  installmentDownPayment: true,
  gameAccountId: true,
} as const;

type OfferContent = {
  title: string;
  description: string;
  division: string;
  teamPower: number;
  coins: number;
  extraInfo: string | null;
  basePrice: number;
  paymentMode: string;
  installmentMonths: number | null;
  installmentDownPayment: number | null;
  gameAccountId: string | null;
};

function contentChanged(before: OfferContent, after: OfferContent): boolean {
  return (Object.keys(after) as Array<keyof OfferContent>).some((key) => before[key] !== after[key]);
}

export async function getOfferForEdit(productId: string, owner: OfferOwner) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      deletedAt: null,
      ...(owner.kind === "seller" ? { sellerId: owner.sellerId } : { sellerId: null }),
    },
    select: {
      id: true,
      slug: true,
      status: true,
      title: true,
      description: true,
      division: true,
      teamPower: true,
      coins: true,
      extraInfo: true,
      basePrice: true,
      paymentMode: true,
      installmentMonths: true,
      installmentDownPayment: true,
      rejectedReason: true,
      gameAccountId: true,
      acceptsExchange: true,
      credential: { select: { id: true } },
    },
  });
  if (!product) throw notFound("Offre introuvable.");
  const { credential, ...rest } = product;
  return { ...rest, hasCredentials: credential !== null };
}

export async function updateOffer(productId: string, input: UpdateOfferInput, owner: OfferOwner, actor: OfferActor) {
  const product = await editable(productId, owner);
  const terms = await paymentTerms(input);
  const data = fields(input);
  // Un vendeur qui modifie le contenu de son offre la renvoie en validation (elle
  // quitte le site d'ici là). Changer seulement « Échange accepté » ne la retire pas.
  const changed =
    Boolean(input.credentials) ||
    contentChanged(product, {
      title: data.title,
      description: data.description,
      division: data.division,
      teamPower: data.teamPower,
      coins: data.coins,
      extraInfo: data.extraInfo,
      basePrice: data.basePrice,
      paymentMode: data.paymentMode,
      installmentMonths: terms.installmentMonths,
      installmentDownPayment: terms.installmentDownPayment,
      gameAccountId: data.gameAccountId,
    });
  const review = owner.kind === "seller" && (changed || product.status !== "ACTIVE");
  const sellerId = owner.kind === "seller" ? owner.sellerId : product.sellerId;
  const context = await publisherLabel(owner);
  await prisma.$transaction(async (tx) => {
    await lockGameId(tx, data.gameAccountId);
    await assertGameIdFree(tx, data.gameAccountId, { sellerId, context, exclude: { productId: product.id } });
    await tx.product.update({
      where: { id: product.id },
      data: {
        ...data,
        ...terms,
        ...(review ? { status: "PENDING_REVIEW" as const, rejectedReason: null, reviewedBy: null } : {}),
        ...(input.credentials
          ? {
              credential: {
                upsert: { create: encryptedCredentials(input.credentials), update: encryptedCredentials(input.credentials) },
              },
            }
          : {}),
      },
    });
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "OFFER_UPDATED",
    resourceType: "Product",
    resourceId: product.id,
    metadata: {
      basePrice: input.basePrice,
      credentialsChanged: Boolean(input.credentials),
      sentToReview: review,
      acceptsExchange: input.acceptsExchange,
    },
  });
  if (review) await askForReview(input.title, true);
  if (!input.acceptsExchange) await closeOpenExchangeRequests(product.id, "Le vendeur n’accepte plus d’échange pour ce compte.");
  return { id: product.id, slug: product.slug, status: review ? "PENDING_REVIEW" : product.status };
}

/** Interrupteur « Échange accepté » seul : jamais de nouvelle validation. */
export async function setOfferExchange(productId: string, acceptsExchange: boolean, owner: OfferOwner, actor: OfferActor) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, sellerId: true, status: true },
  });
  if (!product) throw notFound("Offre introuvable.");
  const mine =
    owner.kind === "moderator" ? true : owner.kind === "seller" ? product.sellerId === owner.sellerId : product.sellerId === null;
  if (!mine) throw forbidden("Cette offre ne vous appartient pas.");
  if (product.status === "SOLD") throw conflict("INVALID_STATE", "Cette offre est vendue.");
  await prisma.product.update({ where: { id: product.id }, data: { acceptsExchange } });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "OFFER_EXCHANGE_SET",
    resourceType: "Product",
    resourceId: product.id,
    metadata: { acceptsExchange },
  });
  if (!acceptsExchange) await closeOpenExchangeRequests(product.id, "Le vendeur n’accepte plus d’échange pour ce compte.");
  return { id: product.id, acceptsExchange };
}

// ---------------------------------------------------------------------------
// Validation des offres des vendeurs (équipe, permission PRODUCTS)
// ---------------------------------------------------------------------------

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("reject"), reason: text(5, 300) }),
]);

/** Fiche complète d'une offre à valider : contenu, médias, vendeur. Jamais les identifiants. */
export async function getOfferForReview(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      slug: true,
      status: true,
      title: true,
      description: true,
      division: true,
      teamPower: true,
      coins: true,
      extraInfo: true,
      basePrice: true,
      paymentMode: true,
      installmentMonths: true,
      installmentDownPayment: true,
      rejectedReason: true,
      gameAccountId: true,
      acceptsExchange: true,
      createdAt: true,
      updatedAt: true,
      credential: { select: { id: true } },
      images: { orderBy: { position: "asc" }, select: { id: true, objectKey: true, mimeType: true } },
      seller: { select: { id: true, user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!product) throw notFound("Offre introuvable.");
  const { credential, images, seller, ...rest } = product;
  const [history, duplicates] = await Promise.all([
    product.gameAccountId ? gameIdHistory(product.gameAccountId, product.id) : Promise.resolve([]),
    duplicateMediaFor(images.map((m) => m.id)),
  ]);
  return {
    ...rest,
    hasCredentials: credential !== null,
    // Ventes et échanges passés de ce même compte (republication après vente).
    gameIdHistory: history,
    media: images.map((m) => ({
      id: m.id,
      url: publicUrl(m.objectKey),
      video: m.mimeType.startsWith("video/"),
      // Même fichier déjà vu ailleurs (autre offre ou vidéo d'échange) : simple alerte.
      duplicates: duplicates.get(m.id) ?? [],
    })),
    seller: seller
      ? { id: seller.id, name: [seller.user.firstName, seller.user.lastName].filter(Boolean).join(" ") || "Vendeur", email: seller.user.email }
      : null,
  };
}

/** Valide (mise en ligne) ou refuse (brouillon + motif) une offre de vendeur en attente. */
export async function reviewOffer(productId: string, input: z.infer<typeof reviewDecisionSchema>, actor: OfferActor) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, title: true, status: true, sellerId: true, seller: { select: { userId: true } } },
  });
  if (!product || !product.sellerId || !product.seller) throw notFound("Offre de vendeur introuvable.");
  if (product.status !== "PENDING_REVIEW") throw conflict("ALREADY_REVIEWED", "Cette offre a déjà été traitée.");

  const approve = input.decision === "approve";
  const claimed = await prisma.product.updateMany({
    where: { id: product.id, status: "PENDING_REVIEW" },
    data: approve
      ? { status: "ACTIVE", publishedAt: new Date(), reviewedBy: actor.actorId, rejectedReason: null }
      : { status: "DRAFT", reviewedBy: actor.actorId, rejectedReason: input.reason },
  });
  if (claimed.count === 0) throw conflict("ALREADY_REVIEWED", "Cette offre a déjà été traitée.");

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: approve ? "OFFER_APPROVED" : "OFFER_REJECTED",
    resourceType: "Product",
    resourceId: product.id,
    metadata: approve ? {} : { reason: input.reason },
    severity: "WARNING",
  });
  await notifyUser(product.seller.userId, "SYSTEM", approve
    ? {
        title: "Offre validée 🎉",
        message: `« ${product.title} » est maintenant en ligne, visible par tous les clients.`,
        actionUrl: "/seller",
        priority: "NORMAL",
      }
    : {
        title: "Offre à corriger",
        message: `« ${product.title} » n’a pas été validée (motif : « ${input.reason} »). Corrigez-la puis enregistrez-la pour la renvoyer.`,
        actionUrl: `/seller/offres/${product.id}`,
        priority: "CRITICAL",
      });
  return { id: product.id, status: approve ? ("ACTIVE" as const) : ("DRAFT" as const) };
}

/** Retrait : l'offre disparaît du site (suppression douce, historique conservé). */
export async function removeOffer(productId: string, owner: OfferOwner, actor: OfferActor) {
  const product = await editable(productId, owner);
  await prisma.product.update({
    where: { id: product.id },
    data: { status: "ARCHIVED", deletedAt: new Date(), featuredUntil: null },
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "OFFER_REMOVED",
    resourceType: "Product",
    resourceId: product.id,
    metadata: { by: owner.kind },
    severity: "WARNING",
  });
  await closeOpenExchangeRequests(product.id, "Ce compte a été retiré de la vente.");
  // Offre d'un vendeur supprimée par l'équipe : il est prévenu.
  if (owner.kind === "moderator" && product.seller) {
    await notifyUser(product.seller.userId, "SYSTEM", {
      title: "Offre retirée par l’équipe",
      message: `« ${product.title} » a été retirée du site par l’équipe MISTERDOU. Contactez le support pour en savoir plus.`,
      actionUrl: "/seller",
      priority: "NORMAL",
    });
  }
  return { id: product.id, removed: true };
}

/**
 * Saisit ou remplace la clé d'accès (identifiants) d'une offre, à TOUT moment :
 * y compris vendue ou en mensualités (le reste de l'offre, lui, ne bouge plus
 * pendant un achat). L'acheteur qui a déjà accès au compte la voit aussitôt
 * dans sa commande et en est prévenu.
 */
export async function setOfferCredential(
  productId: string,
  input: z.infer<typeof credentialSchema>,
  owner: Exclude<OfferOwner, { kind: "team" }> | { kind: "team" },
  actor: OfferActor,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, title: true, sellerId: true, credential: { select: { id: true } } },
  });
  if (!product) throw notFound("Offre introuvable.");
  if (owner.kind === "seller" && product.sellerId !== owner.sellerId) throw forbidden("Cette offre ne vous appartient pas.");

  const replaced = product.credential !== null;
  await prisma.productCredential.upsert({
    where: { productId: product.id },
    create: { productId: product.id, ...encryptedCredentials(input) },
    update: encryptedCredentials(input),
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: replaced ? "PRODUCT_CREDENTIAL_REPLACED" : "PRODUCT_CREDENTIAL_SET",
    resourceType: "Product",
    resourceId: product.id,
    metadata: { by: owner.kind },
    severity: "WARNING",
  });

  // Acheteurs qui ont déjà accès (livré, ou apport validé en mensualités).
  const orders = await prisma.order.findMany({
    where: {
      items: { some: { productId: product.id } },
      OR: [{ status: { in: ["PAID", "DELIVERED", "COMPLETED"] } }, { status: "PARTIALLY_PAID", paymentMode: "INSTALLMENTS" }],
    },
    select: { id: true, buyerId: true },
  });
  for (const order of orders) {
    await notifyUser(order.buyerId, "SYSTEM", {
      title: replaced ? "Identifiants du compte mis à jour" : "Identifiants du compte disponibles",
      message: `Les identifiants de « ${product.title} » sont ${replaced ? "mis à jour" : "disponibles"} : ouvrez votre commande et touchez « Afficher les identifiants ».`,
      actionUrl: `/account/orders/${order.id}`,
      priority: "CRITICAL",
    });
  }
  return { id: product.id, replaced, notifiedBuyers: orders.length };
}

/**
 * « Clé d'accès » : identifiants du compte, pour l'équipe (codes de vérification,
 * aide au client). Chaque affichage est tracé dans le journal d'audit.
 */
export async function revealOfferCredential(productId: string, actor: OfferActor) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, title: true, credential: { select: { id: true, encryptedEmail: true, encryptedPassword: true } } },
  });
  if (!product) throw notFound("Offre introuvable.");
  if (!product.credential) throw notFound("Aucun identifiant enregistré pour ce compte.");
  let email: string;
  let password: string;
  try {
    email = decryptString(product.credential.encryptedEmail);
    password = decryptString(product.credential.encryptedPassword);
  } catch {
    throw badRequest("CREDENTIAL_UNREADABLE", "Identifiants illisibles : saisissez-les de nouveau dans l'offre.");
  }
  await prisma.productCredential.update({
    where: { id: product.credential.id },
    data: { lastAccessedAt: new Date(), lastAccessedById: actor.actorId },
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "PRODUCT_CREDENTIAL_REVEALED",
    resourceType: "Product",
    resourceId: product.id,
    severity: "WARNING",
  });
  return { title: product.title, email, password };
}
