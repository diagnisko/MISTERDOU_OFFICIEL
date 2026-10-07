import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import type { KycStatus, Prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAdminSession, requireAuth, requirePermission } from "../../lib/auth-context.js";
import { adminPasswordResetLink } from "../auth/password-reset.js";
import { deleteClientAccount } from "./delete-client.js";
import { requireTeamPassword } from "../../lib/step-up.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { MANAGER_PERMISSION_LABELS } from "@misterdou/shared";

const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(120).optional() });
const userStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]), reason: z.string().trim().min(5).max(300) });
const sellerStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]), reason: z.string().trim().min(5).max(300) });
const productStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]), reason: z.string().trim().min(5).max(300) });

// Filtre « Identité » de la liste des clients.
const KYC_FILTERS: Record<string, KycStatus[] | undefined> = {
  all: undefined,
  verified: ["VERIFIED"],
  pending: ["PENDING", "IN_PROGRESS"],
  rejected: ["REJECTED"],
  none: ["NOT_SUBMITTED"],
};
const offeringStatusQuery = z.object({ status: z.enum(["PENDING_REVIEW", "ACTIVE", "DRAFT", "SUSPENDED", "SOLD"]).optional() });
const clientFilterQuery = z.object({ kyc: z.enum(["all", "verified", "pending", "rejected", "none"]).default("all") });

/**
 * Recherche d'un membre : chaque mot doit se retrouver dans le prénom, le nom,
 * l'e-mail (y compris l'e-mail Google) ou le téléphone. « abdou sow » trouve
 * donc Abdou Sow, et un e-mail complet trouve son compte.
 */
function memberSearch(q: string | undefined): Prisma.UserWhereInput {
  const words = (q ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return {};
  return {
    AND: words.map((word) => {
      const digits = word.replace(/[^0-9]/g, "");
      return {
        OR: [
          { email: { contains: word, mode: "insensitive" as const } },
          { googleEmail: { contains: word, mode: "insensitive" as const } },
          { firstName: { contains: word, mode: "insensitive" as const } },
          { lastName: { contains: word, mode: "insensitive" as const } },
          ...(digits.length >= 3 ? [{ phoneNumber: { contains: digits } }] : []),
        ],
      };
    }),
  };
}

function pageArgs(query: unknown) {
  return pageQuery.parse(query);
}

async function audit(request: FastifyRequest, action: string, resourceType: string, resourceId?: string, metadata?: unknown) {
  const auth = requireAuth(request);
  await logAudit({ actorId: auth.user.id, actorRole: auth.user.role?.name, sessionId: auth.id, ip: request.ip, userAgent: request.headers["user-agent"], action, resourceType, resourceId, metadata, severity: "WARNING" });
}

// Fiche complète d'un membre pour l'équipe : identité, coordonnées, dossiers
// d'identité (les pièces s'ouvrent par /admin/kyc/:id/files/:kind, permission
// KYC et journal d'audit), commandes et compte vendeur.
async function memberDossier(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true, email: true, googleEmail: true, countryCode: true, phoneNumber: true, firstName: true, lastName: true,
      birthDate: true, country: true, city: true, address: true, status: true, kycStatus: true, verifiedAt: true,
      lastLoginAt: true, createdAt: true, role: { select: { name: true } },
      _count: { select: { orders: true } },
      seller: { select: { id: true, status: true, sellerSince: true, registrationFee: true, registrationPaidAt: true, sellerBalance: { select: { balanceAvailable: true, balancePending: true, totalEarnings: true } }, _count: { select: { product: true } } } },
    },
  });
  if (!user) throw notFound("Membre introuvable.");
  const verifications = await prisma.identityVerification.findMany({
    where: { userId },
    orderBy: { submittedAt: "desc" },
    take: 5,
    select: {
      id: true, status: true, documentType: true, firstName: true, lastName: true, birthDate: true, country: true, city: true,
      address: true, submittedAt: true, reviewedAt: true, rejectionReason: true, documentBackKey: true, passportKey: true,
    },
  });
  return {
    ...user,
    role: user.role.name,
    verifications: verifications.map(({ documentBackKey, passportKey, ...v }) => ({
      ...v,
      // Pièces disponibles (sans exposer les clés de stockage).
      files: v.documentType === "PASSPORT" ? ["passport", "selfie"] : ["front", ...(documentBackKey ? ["back"] : []), "selfie"],
    })),
  };
}

export async function registerAdminConsoleRoutes(app: FastifyInstance) {
  // Ce que la console doit afficher : un manager ne voit que les modules qui lui sont attribués.
  app.get("/admin/me/access", async (request, reply) => {
    const auth = requireAuth(request);
    const role = auth.user.role?.name;
    if (role === "ADMIN" && auth.isAdminSession) {
      return sendOk(reply, { role: "ADMIN" as const, permissions: Object.keys(MANAGER_PERMISSION_LABELS) });
    }
    if (role === "STAFF") {
      const profile = await prisma.managerProfile.findUnique({ where: { userId: auth.user.id }, select: { permissions: true, title: true } });
      return sendOk(reply, { role: "STAFF" as const, permissions: profile?.permissions ?? [], title: profile?.title ?? null });
    }
    throw forbidden();
  });

  app.get("/admin/overview", async (request, reply) => {
    await requirePermission(request, "STATS");
    const [users, clients, products, orders, payments, kyc, vendors, revenue] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, role: { name: "CLIENT" } } }),
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.order.count(),
      prisma.payment.count(),
      prisma.identityVerification.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "Seller" WHERE status = 'ACTIVE'`,
      prisma.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
    ]);
    return sendOk(reply, {
      users, clients, products, orders, payments, pendingKyc: kyc,
      activeSellers: Number(vendors[0]?.count ?? 0), settledRevenue: revenue._sum.amount ?? 0,
    });
  });

  app.get("/admin/clients", async (request, reply) => {
    await requirePermission(request, "SUPPORT");
    const { page, perPage, q } = pageArgs(request.query);
    const { kyc } = clientFilterQuery.parse(request.query);
    // Clients et vendeurs (un vendeur reste un client) ; l'équipe n'y figure pas.
    const base = { deletedAt: null, role: { name: { in: ["CLIENT" as const, "VENDOR" as const] } }, ...memberSearch(q) };
    const where = { ...base, ...(KYC_FILTERS[kyc] ? { kycStatus: { in: KYC_FILTERS[kyc] } } : {}) };
    const [items, total, grouped] = await Promise.all([
      // Inscrits récemment en premier.
      prisma.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * perPage, take: perPage, select: { id: true, email: true, phoneNumber: true, firstName: true, lastName: true, status: true, kycStatus: true, createdAt: true, role: { select: { name: true } }, _count: { select: { orders: true } } } }),
      prisma.user.count({ where }),
      prisma.user.groupBy({ by: ["kycStatus"], where: base, _count: { _all: true } }),
    ]);
    const counted = (statuses: string[]) => grouped.filter((g) => statuses.includes(g.kycStatus)).reduce((n, g) => n + g._count._all, 0);
    const counts = {
      all: grouped.reduce((n, g) => n + g._count._all, 0),
      verified: counted(KYC_FILTERS.verified!),
      pending: counted(KYC_FILTERS.pending!),
      rejected: counted(KYC_FILTERS.rejected!),
      none: counted(KYC_FILTERS.none!),
    };
    return sendOk(reply, items.map(({ role, ...row }) => ({ ...row, role: role.name })), { page, perPage, total, counts });
  });

  // Recherche rapide de l'en-tête de la console : un membre par nom, e-mail ou téléphone.
  app.get("/admin/search/members", async (request, reply) => {
    await requirePermission(request, "SUPPORT");
    const { q } = pageArgs(request.query);
    if (!q || q.length < 2) return sendOk(reply, []);
    const items = await prisma.user.findMany({
      where: { deletedAt: null, role: { name: { in: ["CLIENT", "VENDOR"] } }, ...memberSearch(q) },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, email: true, firstName: true, lastName: true, kycStatus: true, role: { select: { name: true } } },
    });
    return sendOk(reply, items.map(({ role, ...row }) => ({ ...row, role: role.name })));
  });

  app.get("/admin/clients/:id", async (request, reply) => {
    await requirePermission(request, "SUPPORT");
    const { id } = request.params as { id: string };
    const dossier = await memberDossier(id);
    return sendOk(reply, dossier);
  });

  app.get("/admin/sellers/:id", async (request, reply) => {
    await requirePermission(request, "SELLERS");
    const { id } = request.params as { id: string };
    const seller = await prisma.seller.findUnique({ where: { id }, select: { userId: true } });
    if (!seller) throw notFound("Vendeur introuvable.");
    const dossier = await memberDossier(seller.userId);
    return sendOk(reply, dossier);
  });

  // Lien de réinitialisation du mot de passe à transmettre au client (ADMIN seul).
  app.post("/admin/clients/:id/password-reset-link", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = requireAdminSession(request);
    const { id } = request.params as { id: string };
    return sendOk(reply, await adminPasswordResetLink(id, { actorId: auth.user.id, actorRole: "ADMIN", ip: request.ip }));
  });

  // Suppression d'un compte client : administrateur, mot de passe confirmé.
  app.delete("/admin/clients/:id", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = requireAdminSession(request);
    await requireTeamPassword(request);
    const { id } = request.params as { id: string };
    return sendOk(reply, await deleteClientAccount(id, { actorId: auth.user.id, actorRole: "ADMIN", ip: request.ip }));
  });

  app.patch("/admin/clients/:id/status", async (request, reply) => {
    const actor = await requirePermission(request, "SUPPORT");
    const { id } = request.params as { id: string };
    const input = userStatusSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", "Statut ou motif invalide.");
    if (id === actor.user.id) throw conflict("SELF_ACTION", "Vous ne pouvez pas suspendre votre propre compte.");
    const result = await prisma.user.updateMany({ where: { id, deletedAt: null }, data: { status: input.data.status } });
    if (result.count !== 1) throw notFound("Client introuvable.");
    await audit(request, "ADMIN_CLIENT_STATUS_CHANGED", "User", id, { status: input.data.status, reason: input.data.reason });
    return sendOk(reply, { id, status: input.data.status });
  });

  app.get("/admin/sellers", async (request, reply) => {
    await requirePermission(request, "SELLERS");
    const { page, perPage, q } = pageArgs(request.query);
    const search = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
    const items = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT s.id, s.status, s."registrationFee", s."sellerSince", s."createdAt",
             u.id AS "userId", u.email, u."phoneNumber", u."firstName", u."lastName", u."kycStatus",
             COALESCE(b."balancePending", 0) AS "balancePending",
             COALESCE(b."balanceAvailable", 0) AS "balanceAvailable",
             (SELECT max(c."endsAt") FROM "SellerContract" c
               WHERE c."userId" = u.id AND c.status = 'ACTIVE' AND c."startsAt" <= NOW() AND c."endsAt" > NOW()) AS "contractUntil"
      FROM "Seller" s
      JOIN "User" u ON u.id = s."userId"
      LEFT JOIN "SellerBalance" b ON b."sellerId" = s.id
      WHERE (${search}::text IS NULL OR u.email ILIKE ${search} OR u."firstName" ILIKE ${search} OR u."lastName" ILIKE ${search})
      ORDER BY s."createdAt" DESC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
    `;
    const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "Seller" s JOIN "User" u ON u.id = s."userId"
      WHERE (${search}::text IS NULL OR u.email ILIKE ${search} OR u."firstName" ILIKE ${search} OR u."lastName" ILIKE ${search})
    `;
    return sendOk(reply, items, { page, perPage, total: Number(count[0]?.count ?? 0) });
  });

  app.patch("/admin/sellers/:id/status", async (request, reply) => {
    await requirePermission(request, "SELLERS");
    const { id } = request.params as { id: string };
    const input = sellerStatusSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", "Statut ou motif invalide.");
    const changed = await prisma.$executeRaw`
      UPDATE "Seller" SET status = ${input.data.status}::"SellerStatus", "updatedAt" = NOW() WHERE id = ${id}
    `;
    if (changed !== 1) throw notFound("Vendeur introuvable.");
    await audit(request, "ADMIN_SELLER_STATUS_CHANGED", "Seller", id, { status: input.data.status, reason: input.data.reason });
    return sendOk(reply, { id, status: input.data.status });
  });

  app.get("/admin/offerings", async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const { page, perPage, q } = pageArgs(request.query);
    // owner=platform : offres MISTERDOU seulement (promotions de l'équipe).
    const platformOnly = (request.query as { owner?: string }).owner === "platform";
    const { status } = offeringStatusQuery.parse(request.query);
    const where = {
      deletedAt: null,
      ...(platformOnly ? { sellerId: null } : {}),
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total, pendingReview] = await Promise.all([
      prisma.product.findMany({
        where,
        // À valider : les plus anciennes d'abord (premier arrivé, premier servi).
        orderBy: { createdAt: status === "PENDING_REVIEW" ? "asc" : "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, slug: true, title: true, status: true, ownerType: true, sellerId: true, basePrice: true, paymentMode: true,
          featuredPriceOverride: true, rejectedReason: true, createdAt: true, updatedAt: true,
          seller: { select: { user: { select: { firstName: true, lastName: true } } } },
          credential: { select: { id: true } },
        },
      }),
      prisma.product.count({ where }),
      prisma.product.count({ where: { deletedAt: null, status: "PENDING_REVIEW" } }),
    ]);
    return sendOk(
      reply,
      items.map(({ seller, credential, ...row }) => ({
        ...row,
        hasCredentials: credential !== null,
        sellerName: seller ? [seller.user.firstName, seller.user.lastName].filter(Boolean).join(" ") || "Vendeur" : null,
      })),
      { page, perPage, total, pendingReview },
    );
  });

  app.patch("/admin/offerings/:id/status", async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const { id } = request.params as { id: string };
    const input = productStatusSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", "Statut ou motif invalide.");
    // Un compte vendu ne change plus de statut (le remettre « en ligne » le revendrait).
    const result = await prisma.product.updateMany({ where: { id, deletedAt: null, status: { not: "SOLD" } }, data: { status: input.data.status, ...(input.data.status === "ACTIVE" ? { publishedAt: new Date() } : {}) } });
    if (result.count !== 1) {
      const sold = await prisma.product.count({ where: { id, deletedAt: null, status: "SOLD" } });
      if (sold) throw conflict("INVALID_STATE", "Ce compte est vendu : il ne peut pas être remis en vente ni désactivé.");
      throw notFound("Offre introuvable.");
    }
    await audit(request, "ADMIN_OFFER_STATUS_CHANGED", "Product", id, { status: input.data.status, reason: input.data.reason });
    return sendOk(reply, { id, status: input.data.status });
  });

  app.get("/admin/orders", async (request, reply) => {
    await requirePermission(request, "ORDERS");
    const { page, perPage, q } = pageArgs(request.query);
    const where = q ? { OR: [{ orderNumber: { contains: q, mode: "insensitive" as const } }, { buyer: { email: { contains: q, mode: "insensitive" as const } } }] } : {};
    const [items, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, select: { id: true, orderNumber: true, status: true, paymentMode: true, totalAmount: true, createdAt: true, buyer: { select: { id: true, email: true, firstName: true, lastName: true } }, payments: { select: { status: true, amount: true, type: true } }, items: { take: 1, select: { productId: true, title: true, product: { select: { credential: { select: { id: true } } } } } } } }),
      prisma.order.count({ where }),
    ]);
    return sendOk(
      reply,
      items.map(({ items: lines, ...row }) => ({
        ...row,
        item: lines[0] ? { productId: lines[0].productId, title: lines[0].title, hasCredentials: lines[0].product.credential !== null } : null,
      })),
      { page, perPage, total },
    );
  });

  app.get("/admin/payments", async (request, reply) => {
    await requirePermission(request, "PAYMENTS");
    const { page, perPage, q } = pageArgs(request.query);
    const where = q ? { OR: [{ paymentNumber: { contains: q, mode: "insensitive" as const } }, { providerReference: { contains: q, mode: "insensitive" as const } }] } : {};
    const [items, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, select: { id: true, paymentNumber: true, providerReference: true, type: true, amount: true, currency: true, status: true, paidAt: true, createdAt: true, user: { select: { email: true, firstName: true, lastName: true } }, order: { select: { orderNumber: true } } } }),
      prisma.payment.count({ where }),
    ]);
    return sendOk(reply, items, { page, perPage, total });
  });
}
