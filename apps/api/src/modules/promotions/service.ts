import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { Prisma, PromotionStatus, RoleName } from "@misterdou/db";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { notifyMany, notifyTeam, notifyUser } from "../../lib/notify.js";
import { approvePaymentProof, rejectPaymentProof } from "../payments/proofs.js";
import { logger } from "../../lib/logger.js";
import { getIntSetting } from "../settings/service.js";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Promotions à fenêtre de dates (admin) + mises en avant payantes (vendeur).
// Product.featuredUntil = source de vérité de la visibilité ;
// Promotion (fenêtre de prix) et FeaturedPurchase (paiement) l'entourent.
// ---------------------------------------------------------------------------

export const FEATURED_DAILY_RATE_KEY = "featuredDailyRate";
export const FEATURED_MAX_DAYS = 90;
const DAY_MS = 86_400_000;

/** Tarif journalier de la mise en avant (Settings.featuredDailyRate, défaut 200 FCFA). */
export async function featuredDailyRate(): Promise<number> {
  const rate = await getIntSetting(FEATURED_DAILY_RATE_KEY, 200);
  return rate > 0 ? rate : 200;
}

export interface PromotionActor {
  actorId: string;
  actorRole?: RoleName;
  ip?: string;
}

// --- Création (admin) ------------------------------------------------------

export interface CreatePromotionInput {
  productId: string;
  title?: string;
  promoPrice?: number | null;
  discountPercent?: number | null;
  startsAt: Date;
  endsAt: Date;
}

export async function createPromotion(input: CreatePromotionInput, actor: PromotionActor) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { id: true, title: true, basePrice: true, sellerId: true },
  });
  if (!product) throw notFound("Offre introuvable.");
  // Les offres des vendeurs se mettent en avant par leurs forfaits : l'équipe
  // ne gère les promotions que des offres MISTERDOU.
  if (product.sellerId !== null) throw forbidden("Les promotions de l’équipe portent uniquement sur les offres MISTERDOU.");

  const hasPrice = input.promoPrice != null;
  const hasPercent = input.discountPercent != null;
  if (!hasPrice && !hasPercent) {
    throw badRequest("VALIDATION_ERROR", "Indiquez un prix promo ou un pourcentage de remise.");
  }
  if (hasPrice && (!Number.isInteger(input.promoPrice) || (input.promoPrice as number) <= 0 || (input.promoPrice as number) >= product.basePrice)) {
    throw badRequest("VALIDATION_ERROR", `Le prix promo doit être un entier strictement inférieur à ${product.basePrice} FCFA.`);
  }
  if (hasPercent && ((input.discountPercent as number) < 1 || (input.discountPercent as number) > 99)) {
    throw badRequest("VALIDATION_ERROR", "Le pourcentage de remise doit être compris entre 1 et 99.");
  }
  if (input.startsAt.getTime() >= input.endsAt.getTime()) {
    throw badRequest("VALIDATION_ERROR", "La fin de la promo doit être postérieure à son début.");
  }
  if (input.endsAt.getTime() <= Date.now()) {
    throw badRequest("VALIDATION_ERROR", "La fenêtre de la promo est déjà passée.");
  }

  // Une seule promo non-annulée par fenêtre : deux prix promo simultanés sur
  // le même produit seraient ambiguïtés pour l'acheteur.
  const overlap = await prisma.promotion.findFirst({
    where: {
      productId: product.id,
      status: { not: "CANCELLED" },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true },
  });
  if (overlap) throw conflict("PROMO_OVERLAP", "Une autre promo couvre déjà cette fenêtre pour cette offre.");

  const status: PromotionStatus = input.startsAt.getTime() > Date.now() ? "SCHEDULED" : "ACTIVE";
  const created = await prisma.promotion.create({
    data: {
      productId: product.id,
      title: input.title?.trim() || product.title,
      promoPrice: input.promoPrice ?? null,
      discountPercent: input.discountPercent ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status,
      createdById: actor.actorId,
    },
    select: { id: true, status: true },
  });

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "PROMOTION_CREATED",
    resourceType: "Promotion",
    resourceId: created.id,
    metadata: {
      productId: product.id,
      promoPrice: input.promoPrice ?? null,
      discountPercent: input.discountPercent ?? null,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
    },
  });
  logger.info({ promotionId: created.id, productId: product.id }, "[promotions] promo créée");
  return { id: created.id, status: created.status };
}

// --- Liste / annulation (admin) -------------------------------------------

export async function listPromotions(args: { page: number; perPage: number; q?: string }) {
  const { page, perPage, q } = args;
  const where = q
    ? {
        OR: [
          { product: { title: { contains: q, mode: "insensitive" as const } } },
          { product: { slug: { contains: q, mode: "insensitive" as const } } },
          { title: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      orderBy: { startsAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        title: true,
        promoPrice: true,
        discountPercent: true,
        startsAt: true,
        endsAt: true,
        status: true,
        createdAt: true,
        createdById: true,
        product: { select: { id: true, slug: true, title: true, basePrice: true } },
      },
    }),
    prisma.promotion.count({ where }),
  ]);

  // Les créateurs ne portent pas de FK (parité base) : jointure manuelle.
  const creatorIds = [...new Set(rows.map((r) => r.createdById))];
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const creatorById = new Map(creators.map((u) => [u.id, u]));

  return {
    items: rows.map((r) => ({ ...r, createdBy: creatorById.get(r.createdById) ?? null })),
    total,
  };
}

export async function cancelPromotion(id: string, actor: PromotionActor) {
  const found = await prisma.promotion.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!found) throw notFound("Promotion introuvable.");
  if (found.status === "CANCELLED") throw conflict("ALREADY_CANCELLED", "Cette promotion est déjà annulée.");
  await prisma.promotion.update({ where: { id }, data: { status: "CANCELLED" } });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "PROMOTION_CANCELLED",
    resourceType: "Promotion",
    resourceId: id,
    severity: "WARNING",
  });
  return { id, status: "CANCELLED" as const };
}

// --- Mise en avant — paiement (vendeur / propriétaire) ---------------------

function transactionToken(): string {
  return "mdpay_" + randomBytes(18).toString("base64url");
}

async function assertFeaturedOwner(product: { seller: { userId: string } | null }, actorId: string, actorRole?: RoleName) {
  const isSellerOwner = product.seller !== null && product.seller.userId === actorId;
  const isAdmin = actorRole === "ADMIN";
  if (!isSellerOwner && !isAdmin) {
    throw forbidden("Seul le propriétaire de cette offre peut la mettre en avant.");
  }
}

export type FeaturedPaymentMethod = "AUTO" | "BALANCE" | "WAVE";

export interface RequestFeaturedResult {
  purchaseId: string;
  /** Toujours false : une mise en avant s'active quand l'équipe la valide. */
  activated: boolean;
  /** true = payée (solde), en attente de validation ; false = paiement Wave à finaliser. */
  pendingReview: boolean;
  amount: number;
  days: number;
  dailyRate: number;
  token: string | null;
  featuredUntil: string | null;
}

export async function requestFeatured(
  productId: string,
  days: number,
  ctx: { actorId: string; actorRole?: RoleName; ip?: string },
  opts: { paymentMethod?: FeaturedPaymentMethod } = {},
): Promise<RequestFeaturedResult> {
  if (!Number.isInteger(days) || days < 1 || days > FEATURED_MAX_DAYS) {
    throw badRequest("VALIDATION_ERROR", `La durée doit être comprise entre 1 et ${FEATURED_MAX_DAYS} jours.`);
  }
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, title: true, slug: true, sellerId: true, seller: { select: { id: true, userId: true } } },
  });
  if (!product) throw notFound("Offre introuvable.");
  await assertFeaturedOwner(product, ctx.actorId, ctx.actorRole);

  const dailyRate = await featuredDailyRate();
  const amount = dailyRate * days;
  const method = opts.paymentMethod ?? "AUTO";
  const now = new Date();

  // --- R10 : solde d'abord, Wave en secours ---------------------------------
  if (method !== "WAVE" && product.seller) {
    const balance = await prisma.sellerBalance.findUnique({
      where: { sellerId: product.seller.id },
      select: { balanceAvailable: true },
    });
    const available = balance?.balanceAvailable ?? 0;
    // AUTO → solde si suffisant, sinon on retombe sur Wave ;
    // BALANCE explicite → refus net si le solde ne couvre pas le montant.
    if (available >= amount || method === "BALANCE") {
      if (available < amount) {
        throw conflict(
          "INSUFFICIENT_BALANCE",
          `Solde disponible insuffisant : ${amount} FCFA requis, ${available} FCFA disponibles.`,
        );
      }
      const paymentNumber = `PAY-FEAT-${randomInt(1_000_000, 9_999_999)}`;
      const { purchaseId } = await prisma.$transaction(async (tx) => {
        const debited = await tx.sellerBalance.updateMany({
          where: { sellerId: product.seller!.id, balanceAvailable: { gte: amount } },
          data: { balanceAvailable: { decrement: amount } },
        });
        if (debited.count === 0) {
          throw conflict("INSUFFICIENT_BALANCE", "Solde disponible insuffisant.");
        }
        const payment = await tx.payment.create({
          data: {
            paymentNumber,
            userId: ctx.actorId,
            type: "FEATURED",
            amount,
            currency: "XOF",
            provider: "BALANCE",
            status: "SUCCESS",
            paidAt: now,
          },
          select: { id: true },
        });
        const purchase = await tx.featuredProduct.create({
          data: {
            productId: product.id,
            sellerId: product.sellerId,
            purchasedById: ctx.actorId,
            paymentId: payment.id,
            days,
            dailyRate,
            totalPaid: amount,
            startedAt: now,
            expiresAt: new Date(now.getTime() + days * DAY_MS),
            status: "PENDING",
          },
          select: { id: true },
        });
        // Pas d'activation ici : l'équipe valide la demande (page Promotions).
        return { purchaseId: purchase.id };
      });
      await notifyTeam("PRODUCTS", "ADMIN_ALERT", {
        title: "Mise en avant à valider",
        message: `« ${product.title} » : ${days} jour${days > 1 ? "s" : ""}, ${amount} FCFA payés par le solde du vendeur.`,
        actionUrl: "/admin/promotions",
        priority: "CRITICAL",
      });

      await logAudit({
        actorId: ctx.actorId,
        actorRole: ctx.actorRole,
        ip: ctx.ip,
        action: "FEATURED_PAID_BALANCE",
        resourceType: "FeaturedProduct",
        resourceId: purchaseId,
        metadata: { productId: product.id, days, amount, paymentNumber },
        severity: "WARNING",
      });
      logger.info({ purchaseId, productId: product.id, days, amount }, "[promotions] mise en avant payée par solde, à valider");
      return { purchaseId, activated: false, pendingReview: true, amount, days, dailyRate, token: null, featuredUntil: null };
    }
  }

  // --- Wave : paiement PENDING → lien Wave + preuve → validation → activateFeatured
  const token = transactionToken();
  const paymentNumber = `PAY-FEAT-${randomInt(1_000_000, 9_999_999)}`;

  const { purchaseId } = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        paymentNumber,
        userId: ctx.actorId,
        type: "FEATURED",
        amount,
        currency: "XOF",
        provider: "WAVE_LINK",
        status: "PENDING",
        transactionToken: token,
      },
      select: { id: true },
    });
    const purchase = await tx.featuredProduct.create({
      data: {
        productId: product.id,
        sellerId: product.sellerId,
        purchasedById: ctx.actorId,
        paymentId: payment.id,
        days,
        dailyRate,
        totalPaid: amount,
        startedAt: now,
        expiresAt: new Date(now.getTime() + days * DAY_MS),
        status: "PENDING",
      },
      select: { id: true },
    });
    return { purchaseId: purchase.id };
  });

  await logAudit({
    actorId: ctx.actorId,
    action: "FEATURED_REQUESTED",
    resourceType: "FeaturedProduct",
    resourceId: purchaseId,
    metadata: { productId: product.id, days, amount, paymentNumber },
  });
  logger.info({ purchaseId, productId: product.id, days, amount }, "[promotions] mise en avant demandée");
  return { purchaseId, activated: false, pendingReview: false, amount, days, dailyRate, token, featuredUntil: null };
}

// --- Activation (appelée par settlePayment DANS la transaction) ------------

export async function activateFeatured(tx: Tx, payment: { id: string; userId: string }): Promise<void> {
  const purchase = await tx.featuredProduct.findFirst({
    where: { paymentId: payment.id, status: "PENDING" },
    select: { id: true, productId: true, days: true },
  });
  if (!purchase) return; // pas une mise en avant (ou déjà traitée)

  const product = await tx.product.findUnique({
    where: { id: purchase.productId },
    select: { id: true, title: true, slug: true, featuredUntil: true },
  });
  if (!product) return;

  const now = new Date();
  // Prolongation : les jours déjà payés ne sont jamais perdus.
  const base = product.featuredUntil && product.featuredUntil > now ? product.featuredUntil : now;
  const expiresAt = new Date(base.getTime() + purchase.days * DAY_MS);

  await tx.product.update({ where: { id: product.id }, data: { featuredUntil: expiresAt } });
  await tx.featuredProduct.update({
    where: { id: purchase.id },
    data: { status: "ACTIVE", startedAt: base, expiresAt },
  });

  await notifyUser(payment.userId, "FEATURED_ACTIVATED", {
    title: "Mise en avant activée",
    message: `« ${product.title} » est mis en avant pendant ${purchase.days} jour${purchase.days > 1 ? "s" : ""} (jusqu'au ${expiresAt.toLocaleDateString("fr-FR")}).`,
    actionUrl: "/catalogue/" + product.slug,
    priority: "NORMAL",
  });
}

// --- Activation admin (offerte, sans paiement) -----------------------------

export async function adminFeature(
  productId: string,
  days: number,
  actor: PromotionActor,
): Promise<{ featuredUntil: string }> {
  if (!Number.isInteger(days) || days < 1 || days > FEATURED_MAX_DAYS) {
    throw badRequest("VALIDATION_ERROR", `La durée doit être comprise entre 1 et ${FEATURED_MAX_DAYS} jours.`);
  }
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, title: true, slug: true, featuredUntil: true, sellerId: true },
  });
  if (!product) throw notFound("Offre introuvable.");
  if (product.sellerId !== null) throw forbidden("La mise en avant d’une offre de vendeur passe par ses forfaits.");

  const now = new Date();
  const base = product.featuredUntil && product.featuredUntil > now ? product.featuredUntil : now;
  const expiresAt = new Date(base.getTime() + days * DAY_MS);

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: product.id }, data: { featuredUntil: expiresAt } });
    await tx.featuredProduct.create({
      data: {
        productId: product.id,
        sellerId: product.sellerId,
        purchasedById: actor.actorId,
        days,
        dailyRate: 0,
        totalPaid: 0,
        startedAt: base,
        expiresAt,
        status: "ACTIVE",
      },
    });
  });

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "FEATURED_ACTIVATED_ADMIN",
    resourceType: "Product",
    resourceId: product.id,
    metadata: { days, featuredUntil: expiresAt.toISOString() },
    severity: "WARNING",
  });
  await notifyUser(actor.actorId, "FEATURED_ACTIVATED", {
    title: "Mise en avant activée",
    message: `« ${product.title} » est mis en avant pendant ${days} jour${days > 1 ? "s" : ""} (jusqu'au ${expiresAt.toLocaleDateString("fr-FR")}).`,
    actionUrl: "/catalogue/" + product.slug,
  });
  return { featuredUntil: expiresAt.toISOString() };
}

// --- Historique (admin) ----------------------------------------------------

export async function listFeaturedPurchases(args: { page: number; perPage: number; pending?: boolean }) {
  const { page, perPage } = args;
  // Demandes à traiter : en attente, hors mises en avant offertes par l'équipe.
  const where: Prisma.FeaturedProductWhereInput = args.pending ? { status: "PENDING", paymentId: { not: null } } : {};
  const [rows, total] = await Promise.all([
    prisma.featuredProduct.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        days: true,
        dailyRate: true,
        totalPaid: true,
        status: true,
        startedAt: true,
        expiresAt: true,
        createdAt: true,
        product: { select: { id: true, slug: true, title: true } },
        purchasedById: true,
        payment: {
          select: {
            paymentNumber: true,
            status: true,
            provider: true,
            proofs: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
          },
        },
      },
    }),
    prisma.featuredProduct.count({ where }),
  ]);

  const buyerIds = [...new Set(rows.map((r) => r.purchasedById))];
  const buyers = buyerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: buyerIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const buyerById = new Map(buyers.map((u) => [u.id, u]));

  return {
    items: rows.map(({ payment, ...r }) => ({
      ...r,
      payment: payment
        ? { paymentNumber: payment.paymentNumber, status: payment.status, provider: payment.provider, pendingProofId: payment.proofs[0]?.id ?? null }
        : null,
      purchasedBy: buyerById.get(r.purchasedById) ?? null,
    })),
    total,
  };
}

// --- Validation par l'équipe -------------------------------------------------

async function pendingPurchase(id: string) {
  const purchase = await prisma.featuredProduct.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      days: true,
      totalPaid: true,
      sellerId: true,
      purchasedById: true,
      product: { select: { title: true, slug: true } },
      payment: { select: { id: true, status: true, provider: true, proofs: { where: { status: "PENDING" }, take: 1, select: { id: true } } } },
    },
  });
  if (!purchase || !purchase.payment) throw notFound("Demande introuvable.");
  if (purchase.status !== "PENDING") throw conflict("ALREADY_REVIEWED", "Cette demande a déjà été traitée.");
  return purchase as typeof purchase & { payment: NonNullable<typeof purchase.payment> };
}

/** Valide une demande : activation (solde déjà débité) ou validation de la preuve Wave. */
export async function approveFeaturedRequest(id: string, actor: PromotionActor) {
  const purchase = await pendingPurchase(id);
  const { payment } = purchase;
  if (payment.status === "SUCCESS") {
    await prisma.$transaction((tx) => activateFeatured(tx, { id: payment.id, userId: purchase.purchasedById }));
  } else if (payment.status === "PROCESSING" && payment.proofs[0]) {
    // Paiement Wave : valider la preuve active la mise en avant (même porte que Paiements).
    await approvePaymentProof(payment.proofs[0].id, { actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip });
  } else {
    throw conflict("AWAITING_PAYMENT", "Le vendeur n’a pas encore envoyé sa preuve de paiement Wave.");
  }
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "FEATURED_APPROVED",
    resourceType: "FeaturedProduct",
    resourceId: id,
    metadata: { days: purchase.days, amount: purchase.totalPaid },
    severity: "WARNING",
  });
  return { id, status: "ACTIVE" as const };
}

/** Refuse une demande : solde remboursé, ou paiement Wave annulé. */
export async function rejectFeaturedRequest(id: string, reason: string, actor: PromotionActor) {
  const purchase = await pendingPurchase(id);
  const { payment } = purchase;
  if (payment.proofs[0]) {
    // La preuve Wave en attente est refusée avec le même motif.
    await rejectPaymentProof(payment.proofs[0].id, reason, { actorId: actor.actorId, actorRole: actor.actorRole, ip: actor.ip }).catch(() => undefined);
  }
  const refundBalance = payment.status === "SUCCESS" && payment.provider === "BALANCE" && purchase.sellerId !== null;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.featuredProduct.updateMany({
      where: { id, status: "PENDING" },
      data: { status: refundBalance ? "REFUNDED" : "CANCELLED" },
    });
    if (claimed.count === 0) throw conflict("ALREADY_REVIEWED", "Cette demande a déjà été traitée.");
    if (refundBalance) {
      await tx.sellerBalance.update({ where: { sellerId: purchase.sellerId! }, data: { balanceAvailable: { increment: purchase.totalPaid } } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
    } else {
      await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "CANCELLED" } });
    }
  });
  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "FEATURED_REJECTED",
    resourceType: "FeaturedProduct",
    resourceId: id,
    metadata: { reason, refunded: refundBalance ? purchase.totalPaid : 0 },
    severity: "WARNING",
  });
  await notifyUser(purchase.purchasedById, "SYSTEM", {
    title: "Mise en avant refusée",
    message: refundBalance
      ? `La mise en avant de « ${purchase.product.title} » n’a pas été validée (motif : « ${reason} »). ${purchase.totalPaid} FCFA sont revenus sur votre solde.`
      : `La mise en avant de « ${purchase.product.title} » n’a pas été validée (motif : « ${reason} »). Si vous avez déjà payé par Wave, contactez le support pour le remboursement.`,
    actionUrl: "/seller",
    priority: "CRITICAL",
  });
  return { id, status: refundBalance ? ("REFUNDED" as const) : ("CANCELLED" as const) };
}

// --- Jobs périodiques : expiration + synchronisation des statuts -----------

export async function runPromotionJobs(now = new Date()): Promise<{ expiredFeatured: number; promotionsSynced: number }> {
  // 1. Mises en avant arrivées à échéance → EXPIRED + notif à l'acheteur.
  const ended = await prisma.featuredProduct.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    select: {
      id: true,
      productId: true,
      purchasedById: true,
      product: { select: { title: true, slug: true } },
    },
  });
  // Mises en avant échues : UNE updateMany + UN envoi groupé (l'ancienne
  // boucle émettait 1 UPDATE + ~3 requêtes de notification PAR ligne).
  if (ended.length > 0) {
    await prisma.featuredProduct.updateMany({
      where: { id: { in: ended.map((row) => row.id) } },
      data: { status: "EXPIRED" },
    });
    await notifyMany(
      "FEATURED_EXPIRED",
      ended.map((row) => ({
        userId: row.purchasedById,
        params: {
          title: "Mise en avant terminée",
          message: `La mise en avant de « ${row.product.title} » est terminée. Renouveillez-la pour retrouver la visibilité.`,
          actionUrl: "/catalogue/" + row.product.slug,
        },
      })),
    );
  }

  // 2. Produits dont la fenêtre de visibilité est terminée → retrait.
  const cleared = await prisma.product.updateMany({
    where: { featuredUntil: { not: null, lt: now } },
    data: { featuredUntil: null },
  });

  // 3. Synchronisation des statuts de promotions (la fenêtre de dates fait foi).
  await prisma.promotion.updateMany({
    where: { status: "SCHEDULED", startsAt: { lte: now } },
    data: { status: "ACTIVE" },
  });
  const promotions = await prisma.promotion.updateMany({
    where: { status: { in: ["SCHEDULED", "ACTIVE"] }, endsAt: { lte: now } },
    data: { status: "EXPIRED" },
  });

  if (ended.length > 0 || cleared.count > 0 || promotions.count > 0) {
    logger.info({ expiredFeatured: ended.length, cleared: cleared.count, promotions: promotions.count }, "[promotions] jobs exécutés");
  }
  return { expiredFeatured: ended.length, promotionsSynced: promotions.count };
}

const JOBS_INTERVAL_MS = 6 * 60 * 60_000; // 6 h, aligné sur les jobs d'échéanciers

export function startPromotionJobs(): NodeJS.Timeout {
  runPromotionJobs().catch((err) => logger.error({ err }, "[promotions] job initial échoué"));
  const timer = setInterval(() => {
    runPromotionJobs().catch((err) => logger.error({ err }, "[promotions] job périodique échoué"));
  }, JOBS_INTERVAL_MS);
  timer.unref();
  return timer;
}
