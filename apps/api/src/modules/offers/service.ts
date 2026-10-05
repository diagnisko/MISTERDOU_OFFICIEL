import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { decryptString, encryptString } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { getIntSetting } from "../settings/service.js";
import { holdsReservation } from "../orders/fulfillment.js";

// ---------------------------------------------------------------------------
// Création et modification des offres.
// - Vendeur actif : son offre est publiée tout de suite, sans validation.
// - Équipe (permission PRODUCTS) : offres MISTERDOU (sans vendeur).
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
};

const credentialsFields = {
  loginId: text(3, 200),
  password: z.string().min(1).max(200),
};

export const createOfferSchema = z.object({ ...baseFields, credentials: z.object(credentialsFields) });
// Modification : identifiants facultatifs (les anciens restent s'ils sont absents).
export const updateOfferSchema = z.object({ ...baseFields, credentials: z.object(credentialsFields).optional() });

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

export type OfferOwner = { kind: "seller"; sellerId: string } | { kind: "team" };

export interface OfferActor {
  actorId: string;
  actorRole?: RoleName;
  ip?: string;
}

/** Lit un corps de requête ; message du premier champ invalide sinon. */
export function parseOffer<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest("VALIDATION_ERROR", `Champ invalide : ${issue?.path.join(".") || "offre"}.`, parsed.error.issues);
  }
  return parsed.data;
}

/** Règles de paiement : mensualités cohérentes avec le prix et le plafond du site. */
async function paymentTerms(input: UpdateOfferInput) {
  if (input.paymentMode === "ONE_TIME") return { installmentMonths: null, installmentDownPayment: null };
  const max = await getIntSetting("maxInstallments", 8);
  const months = input.installmentMonths ?? null;
  if (months === null || months < 2 || months > max) {
    throw badRequest("VALIDATION_ERROR", `Nombre de mensualités : entre 2 et ${max}.`);
  }
  const down = input.installmentDownPayment ?? 0;
  if (down >= input.basePrice) throw badRequest("VALIDATION_ERROR", "L’apport doit être inférieur au prix.");
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
  };
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
  const now = new Date();
  const product = await prisma.product.create({
    data: {
      ...fields(input),
      ...terms,
      slug: slugFor(input.title),
      ownerType: owner.kind === "seller" ? "VENDOR" : "ADMIN",
      sellerId: owner.kind === "seller" ? owner.sellerId : null,
      status: "ACTIVE",
      publishedAt: now,
      credential: { create: encryptedCredentials(input.credentials) },
    },
    select: { id: true, slug: true },
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
  return product;
}

/** Offre modifiable par cet auteur : la sienne, ni vendue, ni en cours d'achat. */
async function editable(productId: string, owner: OfferOwner) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, slug: true, status: true, sellerId: true },
  });
  if (!product) throw notFound("Offre introuvable.");
  const mine = owner.kind === "seller" ? product.sellerId === owner.sellerId : product.sellerId === null;
  if (!mine) throw forbidden("Cette offre ne vous appartient pas.");
  if (product.status === "SOLD") throw conflict("INVALID_STATE", "Cette offre est vendue : elle ne peut plus être modifiée.");
  // Bloquent la modification : un achat en tranches ouvert, ou une commande qui
  // réserve encore le compte (récente, ou preuve Wave en vérification).
  const busy = await prisma.orderItem.count({
    where: { productId, order: { OR: [{ status: { in: ["PARTIALLY_PAID", "PAID"] } }, holdsReservation()] } },
  });
  if (busy > 0) throw conflict("PRODUCT_RESERVED", "Un achat est en cours sur cette offre : réessayez plus tard.");
  return product;
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
  await prisma.product.update({
    where: { id: product.id },
    data: {
      ...fields(input),
      ...terms,
      ...(input.credentials
        ? {
            credential: {
              upsert: { create: encryptedCredentials(input.credentials), update: encryptedCredentials(input.credentials) },
            },
          }
        : {}),
    },
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "OFFER_UPDATED",
    resourceType: "Product",
    resourceId: product.id,
    metadata: { basePrice: input.basePrice, credentialsChanged: Boolean(input.credentials) },
  });
  return { id: product.id, slug: product.slug };
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
    severity: "WARNING",
  });
  return { id: product.id, removed: true };
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
