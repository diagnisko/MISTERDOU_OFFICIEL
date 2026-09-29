// Utilitaires partagés des tests (§39) : marqueur, usines de données,
// contexte d'authentification, mini-application Fastify et nettoyage FK-safe.
//
// Règles :
//  - TOUTE donnée créée porte le marqueur `p13-…` (e-mail, prénom, slug,
//    titre) pour que le nettoyage et le contrôle de leftovers soient fiables ;
//  - le nettoyage part des utilisateurs du fichier puis remonte les relations
//    dans l'ordre des contraintes FK (d'abord les enfants RESTRICT) ;
//  - la base NEON n'est jamais touchée (voir test/setup.ts).
import { randomInt, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { prisma } from "@misterdou/db";
import type { PaymentMode, ProductStatus, RoleName, SellerStatus, UserStatus } from "@misterdou/db";
import { ApiError } from "../src/lib/errors.js";
import { hashPasswordWith } from "../src/lib/password.js";
import { registerErrorHandler } from "../src/lib/error-handler.js";
import { createSession, findActiveSession, type ActiveSession } from "../src/lib/sessions.js";
import { deleteFile, encryptString, putFile } from "../src/lib/storage.js";

// ---------------------------------------------------------------------------
// Marqueur & horodatage de la suite
// ---------------------------------------------------------------------------

/** Horodatage de démarrage : sert deborne pour les nettoyages ciblés. */
export const SUITE_STARTED_AT = new Date();

export function marker(): string {
  return "p13-" + randomUUID().slice(0, 8);
}

/** Test utilisé par les contrôles SQL de leftovers (e-mail + prénom). */
export function isSuiteRow(row: { email?: string | null; firstName?: string | null }): boolean {
  return (row.email ?? "").startsWith("p13-") || (row.firstName ?? "").startsWith("P13-");
}

// ---------------------------------------------------------------------------
// Suivi des lignes créées par un fichier de test
// ---------------------------------------------------------------------------

export interface Tracked {
  userIds: string[];
  sellerIds: string[];
  productIds: string[];
  orderIds: string[];
  paymentIds: string[];
  planIds: string[];
  promotionIds: string[];
  featuredIds: string[];
  withdrawalIds: string[];
  conversationIds: string[];
  settingsKeys: string[];
  fileKeys: string[];
}

export function tracker(): Tracked {
  return {
    userIds: [],
    sellerIds: [],
    productIds: [],
    orderIds: [],
    paymentIds: [],
    planIds: [],
    promotionIds: [],
    featuredIds: [],
    withdrawalIds: [],
    conversationIds: [],
    settingsKeys: [],
    fileKeys: [],
  };
}

/** Enregistre un id créé hors usine (commandes, paiements, échéanciers…). */
export function track(t: Tracked, collection: Exclude<keyof Tracked, "fileKeys">, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const bucket = t[collection] as string[];
  if (!bucket.includes(id)) bucket.push(id);
  return id;
}

// ---------------------------------------------------------------------------
// Nettoyage
// ---------------------------------------------------------------------------

async function sweepForeignNotifications(): Promise<void> {
  // Alerte admins / rappels d'échéanciers générés par NOS actions à destination
  // d'utilisateurs existants (dev). On ne touche JAMAIS aux notifications
  // destinées à un utilisateur de test (p13-…), y compris ceux des autres
  // fichiers de la suite.
  const testUsers = await prisma.user.findMany({
    where: { OR: [{ email: { startsWith: "p13-" } }, { firstName: { startsWith: "P13-" } }] },
    select: { id: true },
  });
  const testIds = testUsers.map((u) => u.id);
  if (testIds.length === 0) return;
  await prisma.notification.deleteMany({
    where: {
      createdAt: { gte: SUITE_STARTED_AT },
      userId: { notIn: testIds },
      type: { in: ["ADMIN_ALERT", "UPCOMING_INSTALLMENT", "INSTALLMENT_OVERDUE"] },
    },
  });
}

/** Supprime dans l'ordre FK toutes les lignes créées par le fichier courant. */
export async function cleanup(t: Tracked): Promise<void> {
  // Discussions produit (les messages suivent le fil ; un auteur ne peut pas partir avant).
  await prisma.productThread.deleteMany({
    where: { OR: [{ clientId: { in: t.userIds } }, { productId: { in: t.productIds } }, { messages: { some: { authorId: { in: t.userIds } } } }] },
  });
  // Notifications + journal (avant les entités : AuditLog.userId est SET NULL).
  await prisma.notification.deleteMany({ where: { userId: { in: t.userIds } } });
  await sweepForeignNotifications();
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { in: t.userIds } },
        // Écrits par nos webhooks/tests sans acteur (userId null) dans la fenêtre.
        { userId: null, createdAt: { gte: SUITE_STARTED_AT } },
      ],
    },
  });

  // Messagerie (Message.senderId RESTRICT, Conversation participant RESTRICT).
  await prisma.message.deleteMany({ where: { conversationId: { in: t.conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: t.conversationIds } } });

  // Support (reporter RESTRICT, orderId SET NULL).
  await prisma.supportTicket.deleteMany({ where: { reporterId: { in: t.userIds } } });

  // Échéanciers (InstallmentPlan.orderId RESTRICT → avant Order). Les plans
  // sont aussi repérés via NOS commandes : createOrder en ouvre sans que le
  // fichier de test les enregistre explicitement.
  const ourOrders = await prisma.order.findMany({
    where: { OR: [{ buyerId: { in: t.userIds } }, { id: { in: t.orderIds } }] },
    select: { id: true },
  });
  const ourOrderIds = ourOrders.map((o) => o.id);
  await prisma.installment.deleteMany({
    where: { OR: [{ planId: { in: t.planIds } }, { plan: { orderId: { in: ourOrderIds } } }] },
  });
  await prisma.installmentPlan.deleteMany({
    where: { OR: [{ id: { in: t.planIds } }, { orderId: { in: ourOrderIds } }] },
  });

  // Part vendeur d'une vente (Commission → OrderItem, PendingCredit → Order).
  await prisma.commission.deleteMany({
    where: { OR: [{ sellerId: { in: t.sellerIds } }, { orderItem: { orderId: { in: ourOrderIds } } }] },
  });
  await prisma.pendingCredit.deleteMany({
    where: { OR: [{ sellerId: { in: t.sellerIds } }, { orderId: { in: ourOrderIds } }] },
  });

  // Retraits (sellerId + requestedById RESTRICT).
  await prisma.withdrawal.deleteMany({
    where: { OR: [{ sellerId: { in: t.sellerIds } }, { id: { in: t.withdrawalIds } }] },
  });

  // Paiements puis commandes (Payment.userId / Order.buyerId RESTRICT).
  await prisma.payment.deleteMany({
    where: { OR: [{ userId: { in: t.userIds } }, { id: { in: t.paymentIds } }] },
  });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: t.orderIds } } });
  await prisma.order.deleteMany({
    where: { OR: [{ buyerId: { in: t.userIds } }, { id: { in: t.orderIds } }] },
  });

  // Mises en avant / promotions / produits (toutes RESTRICT vers Product).
  await prisma.featuredProduct.deleteMany({
    where: { OR: [{ productId: { in: t.productIds } }, { id: { in: t.featuredIds } }] },
  });
  await prisma.promotion.deleteMany({
    where: { OR: [{ productId: { in: t.productIds } }, { id: { in: t.promotionIds } }] },
  });
  await prisma.productCredential.deleteMany({ where: { productId: { in: t.productIds } } });
  await prisma.productImage.deleteMany({ where: { productId: { in: t.productIds } } });
  await prisma.productReview.deleteMany({ where: { productId: { in: t.productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: t.productIds } } });

  // Vendeur (Seller.userId RESTRICT → après Product/Withdrawal/Commission).
  await prisma.commission.deleteMany({ where: { sellerId: { in: t.sellerIds } } });
  await prisma.sellerBalance.deleteMany({ where: { sellerId: { in: t.sellerIds } } });
  await prisma.pendingCredit.deleteMany({ where: { sellerId: { in: t.sellerIds } } });
  await prisma.seller.deleteMany({ where: { id: { in: t.sellerIds } } });

  // Paramètres créés par les tests (les lignes dev ne sont JAMAIS touchées).
  if (t.settingsKeys.length > 0) {
    await prisma.settings.deleteMany({ where: { key: { in: t.settingsKeys } } });
  }

  // Enfants directs de User.
  await prisma.identityVerification.deleteMany({ where: { userId: { in: t.userIds } } });
  await prisma.location.deleteMany({ where: { userId: { in: t.userIds } } });
  await prisma.phoneVerification.deleteMany({ where: { userId: { in: t.userIds } } });
  await prisma.managerProfile.deleteMany({ where: { userId: { in: t.userIds } } });
  await prisma.pushToken.deleteMany({ where: { userId: { in: t.userIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: t.userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: t.userIds } } });

  // Utilisateurs (dernier : toutes les FK RESTRICT sont résolues ci-dessus).
  await prisma.user.deleteMany({ where: { id: { in: t.userIds } } });

  // Fichiers chiffrés du storage privé.
  for (const key of t.fileKeys) {
    await deleteFile(key).catch(() => undefined);
  }
  t.fileKeys.length = 0;
}

// ---------------------------------------------------------------------------
// Usines de données
// ---------------------------------------------------------------------------

const ROLE_ID_CACHE = new Map<RoleName, string>();

// Coût scrypt volontairement bas pour les usines de test : le hash est
// auto-descriptif (params N/r/p empaquetés dedans), donc verifyPassword lit
// la force réelle du hash → la logique de vérification reste intacte.
const FAST_SCRYPT = { N: 2048, r: 8, p: 1 };

export async function getRoleId(name: RoleName): Promise<string> {
  const cached = ROLE_ID_CACHE.get(name);
  if (cached) return cached;
  const role = await prisma.role.findUniqueOrThrow({ where: { name }, select: { id: true } });
  ROLE_ID_CACHE.set(name, role.id);
  return role.id;
}

export interface TestUser {
  id: string;
  email: string;
  firstName: string;
}

export interface CreateUserOptions {
  role?: RoleName;
  status?: UserStatus;
  password?: string;
  twoFactorEnabled?: boolean;
  /** Préférences de notifications (défaut : tout activé, inApp inclus). */
  prefs?: { inApp?: boolean; push?: boolean; email?: boolean; sms?: boolean };
  phone?: boolean;
  /** Dossier KYC directement VERIFIED (achat sans refaire la revue complète). */
  kycVerified?: boolean;
}

export async function createUser(t: Tracked, opts: CreateUserOptions = {}): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8);
  const email = `p13-${suffix}@example.com`;
  const firstName = `P13-${suffix}`;
  const roleId = await getRoleId(opts.role ?? "CLIENT");
  const passwordHash = await hashPasswordWith(opts.password ?? "MotDePasse123!", FAST_SCRYPT);
  const phone = opts.phone ? `+221${randomInt(70_000_000, 79_999_999)}` : null;

  const user = await prisma.user.create({
    data: {
      roleId,
      email,
      firstName,
      lastName: "Test",
      passwordHash,
      status: opts.status ?? "ACTIVE",
      twoFactorEnabled: opts.twoFactorEnabled ?? false,
      ...(phone ? { countryCode: "+221", phoneNumber: phone } : {}),
      notificationPreference: {
        create: {
          inApp: opts.prefs?.inApp ?? true,
          push: opts.prefs?.push ?? true,
          email: opts.prefs?.email ?? true,
          sms: opts.prefs?.sms ?? false,
        },
      },
      ...(phone
        ? {
            phoneVerifications: {
              create: { phoneNumber: phone, countryCode: "+221", status: "VERIFIED", verifiedAt: new Date() },
            },
          }
        : {}),
    },
    select: { id: true, email: true, firstName: true },
  });
  t.userIds.push(user.id);

  if (opts.kycVerified) {
    await prisma.identityVerification.create({
      data: {
        userId: user.id,
        status: "VERIFIED",
        documentType: "NATIONAL_ID",
        documentFrontKey: `kyc/${user.id}/kyc_front/none`,
        selfieKey: `kyc/${user.id}/kyc_selfie/none`,
        firstName,
        lastName: "Test",
        country: "SN",
        reviewedAt: new Date(),
      },
    });
    await prisma.user.update({ where: { id: user.id }, data: { kycStatus: "VERIFIED", verifiedAt: new Date() } });
  }

  return { id: user.id, email, firstName };
}

/** Session réelle (cookie signé simulé) → contexte `request.auth` des routes. */
export async function authFor(
  userId: string,
  opts: { isAdminSession?: boolean; ttlSeconds?: number } = {},
): Promise<ActiveSession> {
  const sid = await createSession({
    userId,
    kind: "COOKIE",
    ttlSeconds: opts.ttlSeconds ?? 3600,
    isAdminSession: opts.isAdminSession ?? false,
    userAgent: "vitest",
    ip: "127.0.0.1",
  });
  const session = await findActiveSession(sid);
  if (!session) throw new Error("[tests] session de test invalide (utilisateur suspendu ?)");
  return session;
}

/**
 * Compte ADMIN avec session renforcée (2FA + isAdminSession), exigée par
 * `requirePermission` pour tout accès /admin.
 */
export async function createAdmin(
  t: Tracked,
  opts: CreateUserOptions = {},
): Promise<{ user: TestUser; session: ActiveSession }> {
  const user = await createUser(t, { role: "ADMIN", twoFactorEnabled: true, ...opts });
  const session = await authFor(user.id, { isAdminSession: true });
  return { user, session };
}

/** Compte STAFF avec profil manager portant les permissions demandées. */
export async function createStaff(
  t: Tracked,
  permissions: string[],
  opts: CreateUserOptions = {},
): Promise<{ user: TestUser; session: ActiveSession }> {
  const user = await createUser(t, { role: "STAFF", ...opts });
  await prisma.managerProfile.create({
    data: { userId: user.id, title: "P13-test", permissions: permissions as never },
  });
  const session = await authFor(user.id);
  return { user, session };
}

export interface TestSeller {
  id: string;
  userId: string;
}

export async function createSeller(
  t: Tracked,
  user: TestUser,
  opts: {
    status?: SellerStatus;
    balanceAvailable?: number;
    balancePending?: number;
    registrationFee?: number;
    registrationPaid?: boolean;
  } = {},
): Promise<TestSeller> {
  const seller = await prisma.seller.create({
    data: {
      userId: user.id,
      status: opts.status ?? "ACTIVE",
      registrationFee: opts.registrationFee ?? 1000,
      sellerSince: new Date(),
      ...(opts.registrationPaid ? { registrationPaidAt: new Date() } : {}),
    },
    select: { id: true },
  });
  t.sellerIds.push(seller.id);
  await prisma.sellerBalance.create({
    data: {
      sellerId: seller.id,
      balanceAvailable: opts.balanceAvailable ?? 0,
      balancePending: opts.balancePending ?? 0,
      totalEarnings: opts.balanceAvailable ?? 0,
    },
  });
  return { id: seller.id, userId: user.id };
}

export interface TestProduct {
  id: string;
  slug: string;
  title: string;
  basePrice: number;
  sellerId: string | null;
}

export interface CreateProductOptions {
  sellerId?: string | null;
  title?: string;
  basePrice?: number;
  division?: string;
  teamPower?: number;
  coins?: number;
  paymentMode?: PaymentMode;
  installmentMonths?: number | null;
  installmentDownPayment?: number | null;
  featuredPriceOverride?: number | null;
  status?: ProductStatus;
  published?: boolean;
  withCredential?: boolean;
}

export async function createProduct(t: Tracked, opts: CreateProductOptions = {}): Promise<TestProduct> {
  const suffix = randomUUID().slice(0, 8);
  const title = opts.title ?? `Offre ${suffix}`;
  const product = await prisma.product.create({
    data: {
      sellerId: opts.sellerId ?? null,
      ownerType: opts.sellerId ? "VENDOR" : "ADMIN",
      title,
      slug: `p13-${suffix}`,
      description: `Description de test ${suffix}`,
      division: opts.division ?? "Champion",
      teamPower: opts.teamPower ?? 4200,
      coins: opts.coins ?? 1_000_000,
      basePrice: opts.basePrice ?? 50_000,
      paymentMode: opts.paymentMode ?? "ONE_TIME",
      installmentMonths: opts.installmentMonths ?? null,
      installmentDownPayment: opts.installmentDownPayment ?? null,
      featuredPriceOverride: opts.featuredPriceOverride ?? null,
      status: opts.status ?? "ACTIVE",
      publishedAt: opts.published === false ? null : new Date(),
    },
    select: { id: true, slug: true, title: true, basePrice: true, sellerId: true },
  });
  t.productIds.push(product.id);

  if (opts.withCredential) {
    await prisma.productCredential.create({
      data: {
        productId: product.id,
        encryptedEmail: encryptString(`compte-${suffix}@example.com`),
        encryptedPassword: encryptString(`MotDePasse-${suffix}`),
      },
    });
  }
  return product;
}

/** Écrit un fichier réel dans le storage privé (KYC) et le trace pour nettoyage. */
export async function putStorageFile(t: Tracked, objectKey: string, content = "contenu-de-test"): Promise<string> {
  await putFile(objectKey, Buffer.from(content, "utf8"), "image/png");
  t.fileKeys.push(objectKey);
  return objectKey;
}

// ---------------------------------------------------------------------------
// Mini-application Fastify (tests de routes IN-PROCESS via app.inject)
// ---------------------------------------------------------------------------

export interface MiniAppOptions {
  /** Session injectée sur chaque requête (null = non authentifié). */
  auth?: ActiveSession | null;
  /** Conserve le corps JSON brut dans request.rawBody (webhook HMAC). */
  rawJson?: boolean;
}

type RawBodyRequest = FastifyRequest & { rawBody?: string };

/**
 * Application minimale : PAS de rate-limit, swagger, CSRF ni cookies —
 * uniquement l'enveloppe d'erreurs, l'auth injectée et les routes demandées.
 * Le serveur n'est JAMAIS démarré : tout passe par app.inject().
 */
export async function buildMiniApp(opts: MiniAppOptions, register: (app: FastifyInstance) => Promise<void>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  if (opts.rawJson) {
    app.addContentTypeParser<string>(
      "application/json",
      { parseAs: "string" },
      (request, body, done) => {
        const raw = typeof body === "string" ? body : String(body);
        (request as RawBodyRequest).rawBody = raw;
        if (raw.trim().length === 0) {
          done(null, undefined);
          return;
        }
        try {
          done(null, JSON.parse(raw));
        } catch {
          const parseError = Object.assign(new Error("JSON invalide"), {
            statusCode: 400,
            code: "FST_ERR_CTP_INVALID_JSON",
          });
          done(parseError, undefined);
        }
      },
    );
  }

  app.decorateRequest("auth", null);
  app.addHook("preValidation", async (request) => {
    if (opts.auth) request.auth = opts.auth;
  });

  await registerErrorHandler(app);
  await register(app);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Corps `multipart/form-data` synthétique pour app.inject(). */
export function multipartBody(
  parts: Array<
    | { name: string; value: string }
    | { name: string; filename: string; contentType: string; data: Buffer }
  >,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----p13${randomUUID().replaceAll("-", "")}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, "utf8"));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`,
          "utf8",
        ),
      );
      chunks.push(part.data);
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}`, "utf8"),
      );
    }
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/** Capture l'ApiError attendue ; fait échouer le test si rien n'est levé. */
export async function expectApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("[tests] une ApiError était attendue mais aucune exception n'a été levée");
}
