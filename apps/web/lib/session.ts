import { ApiClientError, request } from "./api";

// ---------------------------------------------------------------------------
// Résolution de session côté client.
// Une session peut être une session membre (/auth/me) OU une session
// d'administration (/auth/admin/me) : les deux sont acceptées pour les écrans
// communs (notifications, messagerie, support). Échec des deux → aucun écran
// protégé n'est monté (pas de boucle de reconnexion).
// ---------------------------------------------------------------------------

export type SessionUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role?: string | null;
};

export type ResolvedSession = { user: SessionUser; kind: "member" | "admin" };

/** true si l'erreur signifie « session absente ou expirée » (→ /login). */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "UNAUTHORIZED";
}

/** Renvoie la session courante ou `null` (aucune session exploitable). */
export async function resolveSession(): Promise<ResolvedSession | null> {
  // Erreur réseau / endpoint absent : on tente quand même la session admin.
  try {
    const member = await request<{ user: SessionUser }>("/api/v1/auth/me");
    if (member?.user?.id) return { user: member.user, kind: "member" };
  } catch {
    /* pas de session membre */
  }
  try {
    const admin = await request<{ user: SessionUser }>("/api/v1/auth/admin/me");
    if (admin?.user?.id) return { user: admin.user, kind: "admin" };
  } catch {
    /* aucune session */
  }
  return null;
}
