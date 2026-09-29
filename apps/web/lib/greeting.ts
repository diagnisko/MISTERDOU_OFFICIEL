// Message d'accueil affiché une seule fois après inscription ou connexion.
// Transmis à la page d'arrivée par sessionStorage (onglet courant uniquement).

export type Greeting =
  | { kind: "welcome"; firstName?: string | null }
  | { kind: "return"; firstName?: string | null; previousLoginAt: string | null };

const KEY = "md_greeting";

export function setGreeting(greeting: Greeting) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(greeting));
  } catch {
    /* stockage indisponible : pas de message, rien de bloquant */
  }
}

export function takeGreeting(): Greeting | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as Greeting;
  } catch {
    return null;
  }
}

// Point d'arrivée après connexion : l'accueil (les offres) pour tous les
// membres ; seule l'équipe d'administration rejoint sa console.
export function homeForRole(role: string | undefined): string {
  if (role === "ADMIN" || role === "STAFF") return "/admin";
  return "/";
}
