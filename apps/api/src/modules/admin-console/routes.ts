import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@misterdou/db";
import { sendOk } from "../../lib/envelope.js";
import { requireAdminSession, requireAuth, requirePermission } from "../../lib/auth-context.js";
import { adminPasswordResetLink } from "../auth/password-reset.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";

const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.coerce.number().int().min(10).max(100).default(25), q: z.string().trim().max(120).optional() });
const userStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]), reason: z.string().trim().min(5).max(300) });
const sellerStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]), reason: z.string().trim().min(5).max(300) });
const productStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]), reason: z.string().trim().min(5).max(300) });

function pageArgs(query: unknown) {
  return pageQuery.parse(query);
}

async function audit(request: FastifyRequest, action: string, resourceType: string, resourceId?: string, metadata?: unknown) {
  const auth = requireAuth(request);
  await logAudit({ actorId: auth.user.id, actorRole: auth.user.role?.name, sessionId: auth.id, ip: request.ip, userAgent: request.headers["user-agent"], action, resourceType, resourceId, metadata, severity: "WARNING" });
}

// Fiche complète d'un membre pour l'équipe : identité, coordonnées, dossiers
// d'identité (les pièces s'ouvrent par /admin/kyc/:id/files/:kind, permission
// KYC et journal d'audit), commandes et compte vendeur. Consultation journalisée.
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
    const where = {
      deletedAt: null,
      role: { name: "CLIENT" as const },
      ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { firstName: { contains: q, mode: "insensitive" as const } }, { lastName: { contains: q, mode: "insensitive" as const } }, { phoneNumber: { contains: q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, select: { id: true, email: true, phoneNumber: true, firstName: true, lastName: true, status: true, kycStatus: true, createdAt: true, _count: { select: { orders: true } } } }),
      prisma.user.count({ where }),
    ]);
    await audit(request, "ADMIN_CLIENTS_LISTED", "User", undefined, { total, page });
    return sendOk(reply, items, { page, perPage, total });
  });

  app.get("/admin/clients/:id", async (request, reply) => {
    await requirePermission(request, "SUPPORT");
    const { id } = request.params as { id: string };
    const dossier = await memberDossier(id);
    await audit(request, "ADMIN_MEMBER_VIEWED", "User", id);
    return sendOk(reply, dossier);
  });

  app.get("/admin/sellers/:id", async (request, reply) => {
    await requirePermission(request, "SELLERS");
    const { id } = request.params as { id: string };
    const seller = await prisma.seller.findUnique({ where: { id }, select: { userId: true } });
    if (!seller) throw notFound("Vendeur introuvable.");
    const dossier = await memberDossier(seller.userId);
    await audit(request, "ADMIN_MEMBER_VIEWED", "User", seller.userId, { sellerId: id });
    return sendOk(reply, dossier);
  });

  // Lien de réinitialisation du mot de passe à transmettre au client (ADMIN seul).
  app.post("/admin/clients/:id/password-reset-link", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = requireAdminSession(request);
    const { id } = request.params as { id: string };
    return sendOk(reply, await adminPasswordResetLink(id, { actorId: auth.user.id, actorRole: "ADMIN", ip: request.ip }));
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
             COALESCE(b."balanceAvailable", 0) AS "balanceAvailable"
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
    await audit(request, "ADMIN_SELLERS_LISTED", "Seller", undefined, { total: Number(count[0]?.count ?? 0), page });
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
    const where = {
      deletedAt: null,
      ...(platformOnly ? { sellerId: null } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, select: { id: true, slug: true, title: true, status: true, ownerType: true, sellerId: true, basePrice: true, paymentMode: true, featuredPriceOverride: true, createdAt: true } }),
      prisma.product.count({ where }),
    ]);
    await audit(request, "ADMIN_OFFERINGS_LISTED", "Product", undefined, { total, page });
    return sendOk(reply, items, { page, perPage, total });
  });

  app.patch("/admin/offerings/:id/status", async (request, reply) => {
    await requirePermission(request, "PRODUCTS");
    const { id } = request.params as { id: string };
    const input = productStatusSchema.safeParse(request.body);
    if (!input.success) throw badRequest("VALIDATION_ERROR", "Statut ou motif invalide.");
    const result = await prisma.product.updateMany({ where: { id, deletedAt: null }, data: { status: input.data.status, ...(input.data.status === "ACTIVE" ? { publishedAt: new Date() } : {}) } });
    if (result.count !== 1) throw notFound("Offre introuvable.");
    await audit(request, "ADMIN_OFFER_STATUS_CHANGED", "Product", id, { status: input.data.status, reason: input.data.reason });
    return sendOk(reply, { id, status: input.data.status });
  });

  app.get("/admin/orders", async (request, reply) => {
    await requirePermission(request, "ORDERS");
    const { page, perPage, q } = pageArgs(request.query);
    const where = q ? { OR: [{ orderNumber: { contains: q, mode: "insensitive" as const } }, { buyer: { email: { contains: q, mode: "insensitive" as const } } }] } : {};
    const [items, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, select: { id: true, orderNumber: true, status: true, paymentMode: true, totalAmount: true, createdAt: true, buyer: { select: { id: true, email: true, firstName: true, lastName: true } }, payments: { select: { status: true, amount: true, type: true } } } }),
      prisma.order.count({ where }),
    ]);
    await audit(request, "ADMIN_ORDERS_LISTED", "Order", undefined, { total, page });
    return sendOk(reply, items, { page, perPage, total });
  });

  app.get("/admin/payments", async (request, reply) => {
    await requirePermission(request, "PAYMENTS");
    const { page, perPage, q } = pageArgs(request.query);
    const where = q ? { OR: [{ paymentNumber: { contains: q, mode: "insensitive" as const } }, { providerReference: { contains: q, mode: "insensitive" as const } }] } : {};
    const [items, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, select: { id: true, paymentNumber: true, providerReference: true, type: true, amount: true, currency: true, status: true, paidAt: true, createdAt: true, user: { select: { email: true, firstName: true, lastName: true } }, order: { select: { orderNumber: true } } } }),
      prisma.payment.count({ where }),
    ]);
    await audit(request, "ADMIN_PAYMENTS_LISTED", "Payment", undefined, { total, page });
    return sendOk(reply, items, { page, perPage, total });
  });
}
