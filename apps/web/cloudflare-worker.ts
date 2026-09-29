// Point d'entrée du site sur Cloudflare Workers (voir wrangler.jsonc).
// /api/* part directement vers le Worker de l'API par la liaison de service
// « API » : même origine pour le navigateur (cookies de session), aucune
// adresse publique pour l'API. Tout le reste est rendu par Next.js (OpenNext).

// @ts-ignore `.open-next/worker.js` est produit par `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";

type Env = { API: { fetch(request: Request): Promise<Response> } };

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return env.API.fetch(request);
    return handler.fetch(request, env, ctx);
  },
};
