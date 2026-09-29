import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { SessionKind } from "@misterdou/db";

// Hash du sid (jamais stocké en clair)
export function hashSessionToken(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

// sid aléatoire 256 bits
export function randomSid(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(params: {
  userId: string;
  kind: SessionKind;
  ip?: string;
  userAgent?: string;
  ttlSeconds: number;
  isAdminSession?: boolean;
}): Promise<string> {
  const sid = randomSid();
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  await prisma.session.create({
    data: {
      userId: params.userId,
      tokenHash: hashSessionToken(sid),
      kind: params.kind,
      ip: params.ip,
      userAgent: params.userAgent,
      expiresAt,
      isAdminSession: params.isAdminSession ?? false,
    },
  });
  return sid;
}

export type ActiveSession = Awaited<
  ReturnType<typeof findActiveSessionInternal>
>;

async function findActiveSessionInternal(sid: string) {
  const tokenHash = hashSessionToken(sid);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          role: true,
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  // Un compte suspendu/banni/supprimé perd TOUTES ses sessions immédiatement :
  // la révocation ne doit pas dépendre de la date d'expiration du cookie.
  if (session.user.status !== "ACTIVE" || session.user.deletedAt !== null) return null;
  return session;
}

export async function findActiveSession(
  sid: string,
): Promise<NonNullable<Awaited<ReturnType<typeof findActiveSessionInternal>>> | null> {
  return findActiveSessionInternal(sid);
}

export async function revokeSession(sid: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(sid) },
    data: { revokedAt: new Date() },
  });
}