import { z } from "zod";
import { hasAccountAccess } from "../orders/service.js";
import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { decryptString, encryptString } from "../../lib/storage.js";
import { logAudit } from "../../lib/audit.js";
import { notifyMany, notifyUser, teamOnDuty } from "../../lib/notify.js";
import { getIntSetting } from "../settings/service.js";

// ---------------------------------------------------------------------------
// Codes de vérification (connexion au jeu d'un compte acheté).
// Le client demande un code depuis sa commande. Compte d'un vendeur : c'est à
// lui de le fournir (alerte prioritaire) ; l'administrateur et les managers
// ORDERS peuvent le faire à sa place. Compte MISTERDOU : l'équipe le fournit. Le code est
// chiffré au repos et valable peu de temps (verificationCodeTtlMinutes) ;
// une fois expiré, le client peut en redemander un.
// ---------------------------------------------------------------------------

export type CodeActor = { actorId: string; actorRole?: RoleName; ip?: string };

/** Qui peut fournir un code : toute l'équipe (admin, managers ORDERS) ou seulement le vendeur. */
export type ProviderScope = { kind: "team" } | { kind: "seller"; sellerUserId: string };

export const provideCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Code trop court")
    .max(32, "Code trop long")
    .regex(/^[A-Za-z0-9 -]+$/, "Lettres, chiffres, espaces ou tirets uniquement"),
});


export type ClientCodeView = {
  id: string;
  status: "PENDING" | "PROVIDED" | "EXPIRED";
  code: string | null;
  requestedAt: string;
  providedAt: string | null;
  expiresAt: string | null;
};

type CodeRow = {
  id: string;
  status: string;
  codeEncrypted: string | null;
  createdAt: Date;
  providedAt: Date | null;
  expiresAt: Date | null;
};

function toClientView(row: CodeRow, now = new Date()): ClientCodeView {
  const expired = row.status === "PROVIDED" && (!row.expiresAt || row.expiresAt <= now);
  let code: string | null = null;
  if (row.status === "PROVIDED" && !expired && row.codeEncrypted) {
    try {
      code = decryptString(row.codeEncrypted);
    } catch {
      code = null;
    }
  }
  return {
    id: row.id,
    status: row.status === "PENDING" ? "PENDING" : expired ? "EXPIRED" : "PROVIDED",
    code,
    requestedAt: row.createdAt.toISOString(),
    providedAt: row.providedAt ? row.providedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

const codeRowSelect = { id: true, status: true, codeEncrypted: true, createdAt: true, providedAt: true, expiresAt: true } as const;

/** Dernière demande de code d'une commande, vue client (code en clair seulement s'il est encore valable). */
export async function latestCodeForOrder(orderId: string): Promise<ClientCodeView | null> {
  const row = await prisma.verificationCodeRequest.findFirst({
    where: { orderId, status: { in: ["PENDING", "PROVIDED"] } },
    orderBy: { createdAt: "desc" },
    select: codeRowSelect,
  });
  return row ? toClientView(row) : null;
}

/**
 * Le client demande un code. Idempotent : une demande en attente ou un code
 * encore valable est renvoyé tel quel, sans relancer l'équipe.
 */
export async function requestVerificationCode(orderId: string, actor: CodeActor): Promise<ClientCodeView> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: actor.actorId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMode: true,
      items: { select: { title: true, product: { select: { seller: { select: { userId: true } } } } } },
    },
  });
  if (!order) throw notFound("Commande introuvable.");
  if (!hasAccountAccess(order)) {
    throw conflict("ORDER_NOT_DELIVERED", "Le code se demande une fois l’accès ouvert (compte livré, ou apport validé en mensualités).");
  }

  const current = await latestCodeForOrder(order.id);
  if (current && current.status !== "EXPIRED") return current;

  const created = await prisma.verificationCodeRequest.create({
    data: { orderId: order.id, requesterId: actor.actorId },
    select: codeRowSelect,
  });

  await logAudit({
    ...actor,
    action: "VERIFICATION_CODE_REQUESTED",
    resourceType: "Order",
    resourceId: order.id,
    metadata: { orderNumber: order.orderNumber, requestId: created.id },
  });

  // Prévenir : le vendeur en premier (c'est son travail), l'équipe en appui.
  const title = order.items[0]?.title ?? "un compte";
  // Équipe en service (créneaux) avec la permission Commandes.
  const team = (await teamOnDuty("ORDERS")).map((id) => ({ id }));
  const sellerUserId = order.items[0]?.product.seller?.userId ?? null;
  await notifyMany("ADMIN_ALERT", [
    ...(sellerUserId
      ? [
          {
            userId: sellerUserId,
            params: {
              title: "Code de vérification à envoyer",
              message: `Votre client (commande ${order.orderNumber}) attend le code pour « ${title} ». Envoyez-le depuis votre espace vendeur : il est valable quelques minutes.`,
              actionUrl: "/seller#codes",
              priority: "CRITICAL" as const,
            },
          },
        ]
      : []),
    ...team
      .filter((u) => u.id !== sellerUserId)
      .map((u) => ({
        userId: u.id,
        params: sellerUserId
          ? {
              title: "Code demandé (vendeur prévenu)",
              message: `Commande ${order.orderNumber}, « ${title} » : le vendeur doit fournir le code. Vous pouvez le faire à sa place s'il tarde.`,
              actionUrl: "/admin/codes",
              priority: "NORMAL" as const,
            }
          : {
              title: "Code de vérification demandé",
              message: `Le client de la commande ${order.orderNumber} attend un code pour « ${title} ».`,
              actionUrl: "/admin/codes",
              priority: "CRITICAL" as const,
            },
      })),
  ], { push: { tag: `code-${order.id}` } });

  return toClientView(created);
}

/** Portée de l'acteur, ou 403 s'il ne peut fournir aucun code. */
export async function resolveProviderScope(auth: {
  user: { id: string; role?: { name: RoleName } | null };
  isAdminSession?: boolean;
}): Promise<ProviderScope> {
  const role = auth.user.role?.name;
  if (role === "ADMIN" && auth.isAdminSession) return { kind: "team" };
  if (role === "STAFF") {
    const profile = await prisma.managerProfile.findUnique({ where: { userId: auth.user.id }, select: { permissions: true } });
    if (profile?.permissions.includes("ORDERS")) return { kind: "team" };
  }
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id }, select: { id: true } });
  if (seller) return { kind: "seller", sellerUserId: auth.user.id };
  throw forbidden("Vous ne pouvez pas fournir de code de vérification.");
}

function scopeWhere(scope: ProviderScope) {
  return scope.kind === "team"
    ? {}
    : { order: { items: { some: { product: { seller: { userId: scope.sellerUserId } } } } } };
}

export type ProviderCodeRow = {
  id: string;
  status: "PENDING" | "PROVIDED" | "EXPIRED";
  orderId: string;
  orderNumber: string;
  productTitle: string;
  buyerName: string;
  requestedAt: string;
  providedAt: string | null;
  expiresAt: string | null;
  providedBy: string | null;
  /** Qui doit fournir le code : le vendeur du compte (nom public) ou null (MISTERDOU). */
  sellerName: string | null;
};

/** File des demandes : en attente d'abord, puis les dernières traitées. */
export async function listCodeRequests(scope: ProviderScope, status: "PENDING" | "ALL" = "PENDING"): Promise<ProviderCodeRow[]> {
  const rows = await prisma.verificationCodeRequest.findMany({
    where: { ...scopeWhere(scope), ...(status === "PENDING" ? { status: "PENDING" as const } : { status: { not: "CANCELLED" as const } }) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      ...codeRowSelect,
      orderId: true,
      providedById: true,
      order: {
        select: {
          orderNumber: true,
          buyer: { select: { firstName: true, lastName: true } },
          items: { select: { title: true, product: { select: { seller: { select: { user: { select: { firstName: true, lastName: true } } } } } } }, take: 1 },
        },
      },
    },
  });
  // L'auteur réel n'est montré qu'à l'équipe : le vendeur voit « Équipe MISTERDOU ».
  const providerIds = [...new Set(rows.map((r) => r.providedById).filter((id): id is string => Boolean(id)))];
  const providers = providerIds.length
    ? await prisma.user.findMany({ where: { id: { in: providerIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = (id: string | null) => {
    if (!id) return null;
    if (scope.kind === "seller" && id !== scope.sellerUserId) return "Équipe MISTERDOU";
    if (scope.kind === "seller") return "Vous";
    const p = providers.find((u) => u.id === id);
    return p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || "Membre" : "Membre";
  };
  return rows.map((r) => {
    const view = toClientView(r);
    return {
      id: r.id,
      status: view.status,
      orderId: r.orderId,
      orderNumber: r.order.orderNumber,
      productTitle: r.order.items[0]?.title ?? "Compte",
      buyerName: [r.order.buyer.firstName, r.order.buyer.lastName?.[0] ? r.order.buyer.lastName[0] + "." : null].filter(Boolean).join(" ") || "Client",
      requestedAt: view.requestedAt,
      providedAt: view.providedAt,
      expiresAt: view.expiresAt,
      providedBy: nameOf(r.providedById),
      sellerName: (() => {
        const u = r.order.items[0]?.product.seller?.user;
        return u ? [u.firstName, u.lastName?.[0] ? `${u.lastName[0]}.` : null].filter(Boolean).join(" ") || "Vendeur" : null;
      })(),
    };
  });
}

/** Fournit le code d'une demande en attente. Premier arrivé, premier servi. */
export async function provideVerificationCode(requestId: string, code: string, scope: ProviderScope, actor: CodeActor) {
  const row = await prisma.verificationCodeRequest.findFirst({
    where: { id: requestId, ...scopeWhere(scope) },
    select: { id: true, status: true, orderId: true, order: { select: { orderNumber: true, buyerId: true, items: { select: { title: true }, take: 1 } } } },
  });
  if (!row) throw notFound("Demande introuvable.");
  if (row.status !== "PENDING") throw conflict("INVALID_STATE", "Un code a déjà été fourni pour cette demande.");

  const ttlMinutes = await getIntSetting("verificationCodeTtlMinutes", 10);
  const providedAt = new Date();
  const expiresAt = new Date(providedAt.getTime() + ttlMinutes * 60_000);
  const claim = await prisma.verificationCodeRequest.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "PROVIDED", codeEncrypted: encryptString(code), providedById: actor.actorId, providedAt, expiresAt },
  });
  if (claim.count === 0) throw conflict("INVALID_STATE", "Un code a déjà été fourni pour cette demande.");

  await logAudit({
    ...actor,
    action: "VERIFICATION_CODE_PROVIDED",
    resourceType: "Order",
    resourceId: row.orderId,
    metadata: { orderNumber: row.order.orderNumber, requestId: row.id, providerScope: scope.kind, ttlMinutes },
    severity: "WARNING",
  });
  await notifyUser(row.order.buyerId, "SYSTEM", {
    title: "Votre code de vérification est arrivé",
    message: `Code pour « ${row.order.items[0]?.title ?? "votre compte"} », valable ${ttlMinutes} minutes.`,
    actionUrl: `/account/orders/${row.orderId}`,
    priority: "CRITICAL",
  });
  return { id: row.id, expiresAt: expiresAt.toISOString() };
}
