import type pg from "pg";
import type { VantaDoc } from "./vanta-map.js";

// ---------------------------------------------------------------------------
// Lecture de l'ancien site « Vanta » (Prisma, PostgreSQL). Une seule
// transaction READ ONLY, annulée à la fin : rien n'est jamais écrit là-bas.
// Les montants Decimal arrivent en texte et sont convertis en nombres.
// ---------------------------------------------------------------------------

export interface VantaUser {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  passwordHash: string | null;
  country: string | null;
  address: string | null;
  verificationStatus: string;
  accountStatus: string;
  authProvider: string;
  providerAccountId: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface VantaProduct {
  id: string;
  title: string;
  slug: string;
  description: string;
  importantInfo: string | null;
  features: unknown;
  priceTotal: number;
  initialDepositAmount: number;
  installmentsCount: number;
  status: string;
  createdAt: Date;
  media: Array<{ id: string; mediaType: string; url: string; position: number; isMain: boolean }>;
}

export interface VantaPlan {
  id: string;
  purchaseId: string;
  userId: string;
  productId: string;
  purchaseStatus: string;
  purchaseCreatedAt: Date;
  totalPrice: number;
  initialDepositAmount: number;
  initialDepositStatus: string;
  remainingAmount: number;
  installmentsCount: number;
  startDate: Date | null;
  status: string;
  /** Date de validation de l'apport (preuve confirmée), sinon début de l'échéancier. */
  depositPaidAt: Date | null;
  schedules: Array<{ id: string; installmentNumber: number; dueDate: Date; amount: number; status: string; paidAt: Date | null }>;
  /** Identifiants du compte remis au client (« E-mail : … / Mot de passe : … »). */
  access: string | null;
}

export interface VantaData {
  users: VantaUser[];
  documents: Map<string, VantaDoc[]>;
  /** Dernière demande de vérification acceptée, par client. */
  verifiedAt: Map<string, { submittedAt: Date; reviewedAt: Date | null }>;
  products: VantaProduct[];
  plans: VantaPlan[];
}

const num = (v: unknown) => Number(v ?? 0);

export async function readVanta(client: pg.Client): Promise<VantaData> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const q = async <T extends pg.QueryResultRow>(sql: string) => (await client.query<T>(sql)).rows;

    const users = await q<VantaUser>(`
      SELECT u.id, r.name AS role, u."firstName", u."lastName", u.email, u.phone, u."passwordHash", u.country, u.address,
             u."verificationStatus", u."accountStatus", u."authProvider", u."providerAccountId", u."avatarUrl", u."createdAt"
      FROM "User" u JOIN "Role" r ON r.id = u."roleId" ORDER BY u."createdAt", u.id`);

    const documents = new Map<string, VantaDoc[]>();
    for (const d of await q<VantaDoc & { userId: string }>(
      `SELECT "userId", "documentType", side, "fileUrl", "uploadedAt" FROM "IdentityDocument"`,
    )) {
      const list = documents.get(d.userId) ?? [];
      list.push({ documentType: d.documentType, side: d.side, fileUrl: d.fileUrl, uploadedAt: d.uploadedAt });
      documents.set(d.userId, list);
    }

    const verifiedAt = new Map<string, { submittedAt: Date; reviewedAt: Date | null }>();
    for (const v of await q<{ userId: string; submittedAt: Date; reviewedAt: Date | null }>(
      `SELECT DISTINCT ON ("userId") "userId", "submittedAt", "reviewedAt" FROM "VerificationRequest"
       WHERE status = 'CONFIRMED' ORDER BY "userId", "submittedAt" DESC`,
    )) verifiedAt.set(v.userId, { submittedAt: v.submittedAt, reviewedAt: v.reviewedAt });

    const mediaRows = await q<{ id: string; productId: string; mediaType: string; url: string; position: number; isMain: boolean }>(
      `SELECT id, "productId", "mediaType", url, position, "isMain" FROM "ProductMedia" ORDER BY "productId", position, "createdAt"`,
    );
    const products = (
      await q<Omit<VantaProduct, "media" | "priceTotal" | "initialDepositAmount"> & { priceTotal: string; initialDepositAmount: string }>(`
        SELECT id, title, slug, description, "importantInfo", features, "priceTotal", "initialDepositAmount", "installmentsCount", status, "createdAt"
        FROM "Product" ORDER BY "createdAt"`)
    ).map((p) => ({
      ...p,
      priceTotal: num(p.priceTotal),
      initialDepositAmount: num(p.initialDepositAmount),
      media: mediaRows.filter((m) => m.productId === p.id).map(({ productId: _p, ...m }) => m),
    }));

    // Échéanciers dont l'apport est payé (les réservations sans apport restent sur l'ancien site).
    const planRows = await q<Record<string, unknown>>(`
      SELECT pp.id, pp."purchaseId", pu."userId", pu."productId", pu.status AS "purchaseStatus", pu."createdAt" AS "purchaseCreatedAt",
             pu."totalPrice", pp."initialDepositAmount", pp."initialDepositStatus", pp."remainingAmount", pp."installmentsCount",
             pp."startDate", pp.status,
             (SELECT max(c."reviewedAt") FROM "PaymentSubmission" s JOIN "PaymentConfirmation" c ON c."paymentSubmissionId" = s.id
               WHERE s."paymentPlanId" = pp.id AND c.decision = 'CONFIRMED') AS "depositPaidAt",
             (SELECT a.content FROM "AccessInformation" a WHERE a."purchaseId" = pu.id ORDER BY a."createdAt" DESC LIMIT 1) AS access
      FROM "PaymentPlan" pp JOIN "Purchase" pu ON pu.id = pp."purchaseId"
      WHERE pp."initialDepositStatus" = 'PAID'
      ORDER BY pu."createdAt"`);
    const scheduleRows = await q<Record<string, unknown>>(`
      SELECT id, "paymentPlanId", "installmentNumber", "dueDate", amount, status, "paidAt" FROM "PaymentSchedule"
      ORDER BY "paymentPlanId", "installmentNumber"`);
    const plans: VantaPlan[] = planRows.map((p) => ({
      id: String(p.id),
      purchaseId: String(p.purchaseId),
      userId: String(p.userId),
      productId: String(p.productId),
      purchaseStatus: String(p.purchaseStatus),
      purchaseCreatedAt: p.purchaseCreatedAt as Date,
      totalPrice: num(p.totalPrice),
      initialDepositAmount: num(p.initialDepositAmount),
      initialDepositStatus: String(p.initialDepositStatus),
      remainingAmount: num(p.remainingAmount),
      installmentsCount: Number(p.installmentsCount),
      startDate: (p.startDate as Date | null) ?? null,
      status: String(p.status),
      depositPaidAt: (p.depositPaidAt as Date | null) ?? null,
      access: (p.access as string | null) ?? null,
      schedules: scheduleRows
        .filter((s) => s.paymentPlanId === p.id)
        .map((s) => ({
          id: String(s.id),
          installmentNumber: Number(s.installmentNumber),
          dueDate: s.dueDate as Date,
          amount: num(s.amount),
          status: String(s.status),
          paidAt: (s.paidAt as Date | null) ?? null,
        })),
    }));

    return { users, documents, verifiedAt, products, plans };
  } finally {
    await client.query("ROLLBACK");
  }
}
