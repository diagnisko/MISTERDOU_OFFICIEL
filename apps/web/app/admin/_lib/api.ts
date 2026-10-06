import type { ApiEnvelope, ApiErrorCode } from "@misterdou/shared";
import { ApiClientError, formatXof, request } from "@/lib/api";

// ---------------------------------------------------------------------------
// Accès API de l'espace administration.
// Mêmes règles que la console (`lib/api.ts`) : same-origin /api/v1, cookies de
// session, CSRF double-submit (cookie md_csrf → header x-csrf-token), enveloppe
// { ok, data, meta } / { ok:false, error:{ code, message } }.
// `requestPaged` existe parce que `request()` de la console ne remonte pas le
// `meta` de pagination ({ page, perPage, total }).
// ---------------------------------------------------------------------------

export { ApiClientError, formatXof, request };

export type PageMeta = { page: number; perPage: number; total: number };

export type PagedResult<T> = { items: T[]; meta: PageMeta; extra: Record<string, unknown> };

export const PERMISSION_MESSAGE =
  "Permission insuffisante — ce module est réservé aux rôles autorisés.";

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|;\s*)md_csrf=([^;]+)/);
  if (!m || !m[1]) return {};
  return { "x-csrf-token": decodeURIComponent(m[1]) };
}

/** GET paginé : renvoie les données ET le meta de pagination. */
export async function requestPaged<T>(path: string): Promise<PagedResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      credentials: "include",
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiClientError("INTERNAL_ERROR" as ApiErrorCode, "API injoignable", String(err));
  }

  let payload: ApiEnvelope<unknown, Record<string, unknown>> = {
    ok: false,
    error: { code: "INTERNAL_ERROR" as ApiErrorCode, message: "Réponse illisible" },
  };
  try {
    payload = (await res.json()) as ApiEnvelope<unknown, Record<string, unknown>>;
  } catch {
    /* corps non JSON — enveloppe par défaut */
  }

  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, payload.error.message, payload.error.details);
  }

  const meta = payload.meta ?? {};
  const items = Array.isArray(payload.data) ? (payload.data as T[]) : [];
  const page = Number(meta.page ?? 1);
  const perPage = Number(meta.perPage ?? items.length);
  const total = Number(meta.total ?? items.length);
  return {
    items,
    // Le meta brut : certaines listes y ajoutent des compteurs (ex. clients par statut).
    extra: meta,
    meta: {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      perPage: Number.isFinite(perPage) && perPage > 0 ? perPage : Math.max(items.length, 1),
      total: Number.isFinite(total) && total >= 0 ? total : items.length,
    },
  };
}

/** Message lisible pour toute erreur (403 → alerte de permission imposée). */
export function errorMessage(err: unknown, fallback = "Une erreur est survenue."): string {
  if (err instanceof ApiClientError) {
    return err.code === "FORBIDDEN" ? PERMISSION_MESSAGE : err.message;
  }
  if (typeof err === "string" && err.trim().length > 0) return err;
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  return fallback;
}

export function isPermissionError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "FORBIDDEN";
}

export function isErrorCode(err: unknown, code: string): boolean {
  return err instanceof ApiClientError && err.code === code;
}

/** Construit "?a=b&c=d" en ignorant les valeurs vides. */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** "2026-09-26" (input type=date) → ISO 8601. */
export function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** 570 → "09:30". */
export function minutesToTime(minutes: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
