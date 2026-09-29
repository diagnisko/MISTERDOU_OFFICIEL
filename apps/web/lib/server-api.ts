// Appels à l'API depuis le serveur du site (composants serveur).
// - Sur Cloudflare : par la liaison de service « API » (sans passer par Internet).
// - En local : par l'URL API_INTERNAL_URL (http://localhost:4000 par défaut).

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

type Fetcher = { fetch(request: Request): Promise<Response> };

async function cloudflareApi(): Promise<Fetcher | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as { API?: Fetcher };
    return env.API ?? null;
  } catch {
    return null; // hors Cloudflare (next dev, tests)
  }
}

export async function serverApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const api = await cloudflareApi();
  if (api) return api.fetch(new Request(`https://api.internal${path}`, init));
  return fetch(`${API_INTERNAL_URL}${path}`, init);
}
