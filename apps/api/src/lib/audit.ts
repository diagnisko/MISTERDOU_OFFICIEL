import { randomBytes } from "node:crypto";
import { prisma } from "@misterdou/db";
import type { AuditSeverity, RoleName } from "@misterdou/db";

export interface AuditEntry {
  actorId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  actorRole?: RoleName;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: unknown;
  severity?: AuditSeverity;
}

// Journaliser chaque action sensible (docs/05 §6). Ne lève JAMAIS d'erreur bloquante :
// log + rethrow uniquement si l'audit échoue.
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.actorId,
        sessionId: entry.sessionId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        actorRole: entry.actorRole,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata !== undefined ? (entry.metadata as never) : undefined,
        severity: entry.severity ?? "INFO",
      },
    });
  } catch (err) {
    // L'audit ne doit pas faire échouer l'action métier (il est déjà en échec si la BDD tombe).
    // En production on alerterait ici.
    console.error("[audit] échec de journalisation :", err);
  }
}

export function randomCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}