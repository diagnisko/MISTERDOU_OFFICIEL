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

// Point d'arrivée après connexion ou inscription : les offres pour tous les
// membres (clients comme vendeurs) ; seule l'équipe rejoint sa console.
export function homeForRole(role: string | undefined): string {
  if (role === "ADMIN" || role === "STAFF") return "/admin";
  return "/offres";
}

/**
 * Retour vers la page demandée avant la connexion, seulement pour une page
 * de catalogue ou de paiement (fiche d'un compte, paiement en cours). Les
 * pages du compte ne sont jamais un point d'arrivée : on va aux offres.
 */
export function landingAfterLogin(role: string | undefined, next: string | null): string {
  const staff = role === "ADMIN" || role === "STAFF";
  const safe = next && next.startsWith("/") && !next.startsWith("//");
  if (!staff && safe && /^\/(catalogue|checkout|offres|pret-ou-prestation)(\/|\?|$)/.test(next)) return next;
  return homeForRole(role);
}
