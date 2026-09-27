import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { Payment, RoleName } from "@misterdou/db";
import { badRequest, forbidden, notFound, conflict, unauthorized, ApiError } from "../../lib/errors.js";
import { decryptString } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { notifyUser } from "../../lib/notify.js";
import { logger } from "../../lib/logger.js";
import { assertSplittable, createInstallmentPlan } from "../installments/service.js";
import { promoRelationSelect, resolvePrice } from "../../lib/pricing.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface OrderActor {
  actorId: string;
  actorRole?: RoleName;
  ip?: string;
}

// ---------------------------------------------------------------------------
// Création — atomique côté serveur : Order (PENDING_PAYMENT) + OrderItem
// (snapshot immuable) + Payment ORDER_PAYMENT. Le montant est TOUJOURS
// recalculé serveur (prix ou promo active) : la valeur envoyée par le client
// n'est jamais utilisée.
// ---------------------------------------------------------------------------

export const createOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(5).default(1),
  // La page d'arrivée décide du mode d'achat : /offres encaisse en un seul
  // coup, /pret-ou-prestation ouvre l'échéancier. Défaut ONE_TIME = page
  // catalogue, donc le comportement historique est préservé.
  paymentMode: z.enum(["ONE_TIME", "INSTALLMENTS"]).default("ONE_TIME"),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export async function createOrder(input: CreateOrderInput, ctx: { actorId: string }): Promise<{ orderId: string; orderNumber: string; amount: number; token: string }> {
  // Le statut du compte est relu côté serveur avant chaque commande.
  const buyer = await prisma.user.findUnique({
    where: { id: ctx.actorId },
    select: { status: true },
  });
  if (!buyer) throw unauthorized();
  if (buyer.status !== "ACTIVE") throw forbidden("Votre compte est suspendu.");
  const verification = await prisma.identityVerification.findFirst({
    where: { userId: ctx.actorId },
    orderBy: { submittedAt: "desc" },
    select: { status: true },
  });
  if (verification?.status !== "VERIFIED") {
    throw new ApiError("KYC_REQUIRED", 403, "Votre identité doit être vérifiée avant tout achat.");
  }

  const now = new Date();
  const product = await prisma.product.findFirst({
    where: { id: input.productId, status: "ACTIVE", publishedAt: { not: null }, deletedAt: null },
    select: {
      id: true,
      title: true,
      division: true,
      teamPower: true,
      coins: true,
      basePrice: true,
      featuredPriceOverride: true,
      paymentMode: true,
      installmentDownPayment: true,
      installmentMonths: true,
      ...promoRelationSelect(now),
    },
  });
  if (!product) throw notFound("Produit indisponible");

  // Prix DEBITÉ calculé serveur : promotion à fenêtre active prioritaire,
  // puis promo permanente, puis prix de base. Même code que le catalogue.
  const { price: unitPrice, promotionId } = resolvePrice(product);
  const totalAmount = unitPrice * input.quantity;
  const discountAmount = Math.max(0, product.basePrice - unitPrice) * input.quantity;

  // Un produit à tranches refusera toujours l'achat comptant : les deux prix
  // affichés sur le site seraient alors contradictoires.
  if (product.paymentMode !== input.paymentMode) {
    throw conflict(
      product.paymentMode === "INSTALLMENTS" ? "INSTALLMENTS_REQUIRED" : "INSTALLMENTS_UNAVAILABLE",
      product.paymentMode === "INSTALLMENTS"
        ? "Cette offre se règle en plusieurs fois, pas en un seul paiement."
        : "Cette offre doit être réglée en un seul paiement.",
    );
  }
  if (input.paymentMode === "INSTALLMENTS") {
    // L'apport est un montant absolu posé par l'admin : il s'applique tel quel,
    // mais il ne peut pas dépasser le prix promotionnel de l'instant.
    assertSplittable({
      total: totalAmount,
      months: product.installmentMonths,
      downPayment: product.installmentDownPayment,
    });
  }

  const orderNumber = `MD-${new Date().getFullYear()}-${randomInt(1_000_000, 9_999_999)}`;
  const transactionToken = `mdpay_${randomBytes(18).toString("base64url")}`;
  const split = input.paymentMode === "INSTALLMENTS";
  const downPayment = product.installmentDownPayment ?? 0;

  // Commande + échéancier + premier règlement dans UNE transaction : une
  // commande en tranches sans plan (ou un plan sans échéances) n'existe pas,
  // sinon l'acheteur se retrouverait avec un dossier financier incohérent.
  const { order, plan } = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber,
        buyerId: ctx.actorId,
        status: "PENDING_PAYMENT",
        paymentMode: split ? "INSTALLMENTS" : "ONE_TIME",
        totalAmount,
        discountAmount,
        // Snapshot de la promotion appliquée (fenêtre de dates active).
        ...(promotionId ? { promotionId } : {}),
        items: {
          create: {
            productId: product.id,
            title: product.title,
            division: product.division,
            teamPower: product.teamPower,
            coins: product.coins,
            unitPrice,
            quantity: input.quantity,
          },
        },
        payments: {
          create: {
            userId: ctx.actorId,
            paymentNumber: `PAY-${orderNumber}`,
            // En tranches, le premier règlement est l'APPORT : il ouvre le
            // dossier mais ne donne aucun accès au compte.
            type: split ? "INITIAL_INSTALLMENT" : "ORDER_PAYMENT",
            amount: split ? downPayment : totalAmount,
            currency: "XOF",
            provider: "PAYTECH",
            status: "PENDING",
            transactionToken,
          },
        },
      },
      select: { id: true, orderNumber: true, totalAmount: true },
    });

    const createdPlan = split
      ? await createInstallmentPlan(tx, {
          orderId: created.id,
          orderNumber,
          buyerId: ctx.actorId,
          totalAmount,
          downPayment,
          months: product.installmentMonths ?? 0,
          from: now,
        })
      : null;

    // L'apport doit pointer vers son plan, sinon settlePayment ne peut pas
    // le rattacher (champ porté par le paiement, pas par l'ordre).
    if (createdPlan) {
      await tx.payment.updateMany({
        where: { transactionToken },
        data: { installmentPlanId: createdPlan.id },
      });
    }

    return { order: created, plan: createdPlan };
  });

  await logAudit({
    actorId: ctx.actorId,
    action: "ORDER_CREATED",
    resourceType: "Order",
    resourceId: order.id,
    metadata: { orderNumber, totalAmount, productId: product.id, paymentMode: split ? "INSTALLMENTS" : "ONE_TIME" },
  });
  await notifyUser(ctx.actorId, "ORDER_CONFIRMED", {
    title: `Commande ${orderNumber}`,
    message: split
      ? `Réglez votre apport de ${downPayment.toLocaleString("fr-FR")} FCFA pour ouvrir votre échéancier. Le compte est livré à la solde totale.`
      : "Réglez votre commande pour recevoir votre accès.",
    actionUrl: `/checkout/${transactionToken}`,
  });
  logger.info(
    { orderNumber, totalAmount, paymentMode: split ? "INSTALLMENTS" : "ONE_TIME", planId: plan?.id },
    "[orders] commande créée (PENDING_PAYMENT)",
  );

  return { orderId: order.id, orderNumber, amount: totalAmount, token: transactionToken };
}

// ---------------------------------------------------------------------------
// Livraison — appelée par settlePayment DANS la transaction du paiement
// (docs/06 §1.7). Idempotente via Order.deliveredAt : un double webhook ne
// livre jamais deux fois. KYC re-vérifié au moment de la délivrance.
// ---------------------------------------------------------------------------

export async function deliverOrderAfterSuccess(tx: Tx, payment: Payment, opts: { ctx?: OrderActor }) {
  if (!payment.orderId) {
    logger.warn({ paymentId: payment.id }, "[orders] paiement de commande sans orderId");
    return;
  }

  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      id: true,
      orderNumber: true,
      buyerId: true,
      deliveredAt: true,
      status: true,
      items: { select: { title: true, product: { select: { credential: { select: { id: true } }, seller: { select: { userId: true } } } } } },
    },
  });
  if (!order) {
    logger.warn({ paymentId: payment.id }, "[orders] commande introuvable — livraison ignorée");
    return;
  }
  if (order.status === "REFUNDED") {
    logger.warn({ orderId: order.id }, "[orders] commande remboursée — aucune livraison");
    return;
  }


  // Idempotence : un Order n'est livré qu'une seule fois.
  const claimed = await tx.order.updateMany({
    where: { id: order.id, deliveredAt: null, status: { not: "REFUNDED" } },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });
  if (claimed.count === 0) {
    logger.info({ orderId: order.id, paymentId: payment.id }, "[orders] livraison déjà effectuée (idempotent)");
    return;
  }

  const credential = order.items[0]?.product.credential ?? null;
  if (credential) {
    await tx.productCredential.update({
      where: { id: credential.id },
      data: { lastAccessedAt: new Date(), lastAccessedById: order.buyerId },
    });
  }

  await logAudit({
    ...opts.ctx,
    action: "ORDER_DELIVERED",
    resourceType: "Order",
    resourceId: order.id,
    metadata: { orderNumber: order.orderNumber, hasCredential: Boolean(credential) },
    severity: "WARNING",
  });
  await notifyUser(order.buyerId, "ORDER_DELIVERED", {
    title: `Commande ${order.orderNumber} livrée`,
    message: credential
      ? "Votre accès est disponible dans « Mes achats »."
      : "Votre commande est livrée — le vendeur doit encore saisir vos identifiants.",
    actionUrl: "/account",
    priority: "NORMAL",
  });

  // §59 — le vendeur est prévenu dès la livraison (produit vendu).
  const soldItem = order.items[0];
  if (soldItem?.product.seller) {
    await notifyUser(soldItem.product.seller.userId, "PRODUCT_SOLD", {
      title: "Produit vendu",
      message: `Votre offre « ${soldItem.title} » vient d'être vendue (commande ${order.orderNumber}).`,
      actionUrl: "/seller",
      priority: "NORMAL",
    });
  }
}

// ---------------------------------------------------------------------------
// Historique du client + détail — projections SANS credentials.
// ---------------------------------------------------------------------------

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: string;
  totalAmount: number;
  itemCount: number;
  firstItem: { title: string; division: string; teamPower: number; coins: number } | null;
  createdAt: string;
  deliveredAt: string | null;
  canReveal: boolean;
};

export async function listMyOrders(userId: string): Promise<OrderSummary[]> {
  const orders = await prisma.order.findMany({
    where: { buyerId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { items: { select: { title: true, division: true, teamPower: true, coins: true, quantity: true } } },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentMode: o.paymentMode,
    totalAmount: o.totalAmount,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    firstItem: o.items[0]
      ? { title: o.items[0].title, division: o.items[0].division, teamPower: o.items[0].teamPower, coins: o.items[0].coins }
      : null,
    createdAt: o.createdAt.toISOString(),
    deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
    canReveal: o.status === "DELIVERED",
  }));
}

export async function getMyOrder(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: userId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      discountAmount: true,
      currency: true,
      paymentMode: true,
      createdAt: true,
      deliveredAt: true,
      items: {
        select: {
          id: true,
          title: true,
          division: true,
          teamPower: true,
          coins: true,
          unitPrice: true,
          quantity: true,
          productId: true,
        },
      },
      payments: {
        select: { id: true, paymentNumber: true, type: true, amount: true, status: true, paidAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) throw notFound("Commande introuvable");
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    canReveal: order.status === "DELIVERED",
  };
}

// ---------------------------------------------------------------------------
// Révélation — propriétaire, après livraison, tracée. Une commande remboursée
// ne livre plus rien (§15 « rembourser → révoquer l'accès »).
// ---------------------------------------------------------------------------

export async function revealCredentials(orderId: string, ctx: OrderActor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      buyerId: true,
      status: true,
      items: {
        select: {
          title: true,
          product: { select: { credential: { select: { id: true, encryptedEmail: true, encryptedPassword: true } } } },
        },
      },
    },
  });
  if (!order) throw notFound("Commande introuvable");
  if (order.buyerId !== ctx.actorId) throw notFound("Commande introuvable");
  if (order.status === "REFUNDED") throw conflict("ORDER_REFUNDED", "Accès révoqué : cette commande a été remboursée.");
  if (order.status !== "DELIVERED") {
    throw badRequest("ORDER_NOT_DELIVERED", "La livraison n'est pas encore confirmée.");
  }

  const item = order.items[0];
  const credential = item?.product.credential;
  if (!item || !credential) throw notFound("Aucun accès à livrer pour cette commande");

  let email: string;
  let password: string;
  try {
    email = decryptString(credential.encryptedEmail);
    password = decryptString(credential.encryptedPassword);
  } catch {
    throw badRequest("CREDENTIAL_UNREADABLE", "Identifiants illisibles — signalez-le, un remboursement vous est proposé.");
  }

  await prisma.productCredential.update({
    where: { id: credential.id },
    data: { lastAccessedAt: new Date(), lastAccessedById: ctx.actorId },
  });
  await logAudit({
    ...ctx,
    action: "ORDER_CREDENTIAL_REVEALED",
    resourceType: "ProductCredential",
    resourceId: credential.id,
    metadata: { orderId: order.id, orderNumber: order.orderNumber, productTitle: item.title },
    severity: "WARNING",
  });

  return { title: item.title, orderNumber: order.orderNumber, email, password };
}

