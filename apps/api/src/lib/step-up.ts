import type { FastifyRequest } from "fastify";
import { prisma } from "@misterdou/db";
import { verifyPassword } from "./password.js";
import { logAudit } from "./audit.js";
import { badRequest } from "./errors.js";
import { requireAuth } from "./auth-context.js";

// ---------------------------------------------------------------------------
// Confirmation par mot de passe avant une action irréversible de l'équipe
// (suppressions, solde ou annulation d'un échéancier…). La session seule ne
// suffit pas : un poste laissé ouvert ne doit pas permettre ces actions.
// ---------------------------------------------------------------------------

/** Membres de l'équipe : vérifie le mot de passe envoyé dans `body.password`. */
export async function requireTeamPassword(request: FastifyRequest): Promise<void> {
  const auth = requireAuth(request);
  const role = auth.user.role?.name;
  if (role !== "ADMIN" && role !== "STAFF") return;
  const password = (request.body as { password?: unknown } | undefined)?.password;
  if (typeof password !== "string" || password.length === 0) {
    throw badRequest("PASSWORD_REQUIRED", "Confirmez avec votre mot de passe.");
  }
  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { passwordHash: true } });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    await logAudit({
      actorId: auth.user.id,
      actorRole: role,
      ip: request.ip,
      action: "DELETE_PASSWORD_FAILED",
      resourceType: "User",
      resourceId: auth.user.id,
      metadata: { url: request.url },
      severity: "WARNING",
    });
    throw badRequest("INVALID_PASSWORD", "Mot de passe incorrect : rien n’a été fait.");
  }
}
