// Base URL utilisée par les composants serveur (Next) pour joindre l'API en interne.
// En production : pointée vers le service API (même réseau).
export function apiServerBase(env: NodeJS.ProcessEnv): string {
  return env.API_INTERNAL_URL ?? "http://localhost:4000";
}