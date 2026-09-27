import type { ApiEnvelope, ApiErrorCode, PublicMeta } from "@misterdou/shared";

const BROWSER_BASE = "";
const SERVER_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
  }
}

// CSRF double-submit : renvoie le header attendu par l'API depuis le cookie md_csrf
// (le cookie est lisible en JS ; sa valeur est recopiée dans le header).
function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|;\s*)md_csrf=([^;]+)/);
  if (!m || !m[1]) return {};
  return { "x-csrf-token": decodeURIComponent(m[1]) };
}

async function request<T>(
  path: string,
  init?: RequestInit,
  base: string = BROWSER_BASE,
): Promise<T> {
  let res: Response;
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(init?.method ?? "GET");
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(isMutating ? csrfHeader() : {}),
        ...(init?.headers ?? {}),
      },
      credentials: "include",
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiClientError("INTERNAL_ERROR" as ApiErrorCode, "API injoignable", String(err));
  }

  let payload: ApiEnvelope = { ok: false, error: { code: "INTERNAL_ERROR" as ApiErrorCode, message: "Réponse illisible" } };
  try {
    payload = (await res.json()) as ApiEnvelope;
  } catch {
    /* corps non JSON — enveloppe par défaut */
  }

  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, payload.error.message, payload.error.details);
  }
  return payload.data as T;
}

export interface UploadResult {
  key: string;
  mime: string;
  sizeBytes: number;
  purpose: string;
}

// Upload multipart (files KYC/captures) — stockage privé chiffré, clé retournée
// puis référencée dans les soumissions (KYC, produits…).
export async function uploadFile(file: File, purpose: string): Promise<UploadResult> {
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", file, file.name);

  let res: Response;
  try {
    res = await fetch("/api/v1/uploads", {
      method: "POST",
      headers: csrfHeader(),
      body: form,
      credentials: "include",
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiClientError("INTERNAL_ERROR" as ApiErrorCode, "Impossible d'envoyer le fichier", String(err));
  }

  let payload: ApiEnvelope = { ok: false, error: { code: "INTERNAL_ERROR" as ApiErrorCode, message: "Réponse illisible" } };
  try {
    payload = (await res.json()) as ApiEnvelope;
  } catch {
    /* ignore */
  }
  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, payload.error.message, payload.error.details);
  }
  return payload.data as UploadResult;
}

// --- Pagination ---
// `request()` ne remonte que `data` : les listes paginées ont besoin du
// `meta { page, perPage, total, … }` de l'enveloppe (les notifications ajoutent
// un compteur `unread`).
export type PageMeta = { page: number; perPage: number; total: number };

export type PagedResult<T, M extends PageMeta = PageMeta> = { items: T[]; meta: M };

export async function requestPaged<T, M extends PageMeta = PageMeta>(
  path: string,
): Promise<PagedResult<T, M>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
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

  const raw = (payload.meta ?? {}) as Record<string, unknown>;
  const items = Array.isArray(payload.data) ? (payload.data as T[]) : [];
  const page = Number(raw.page ?? 1);
  const perPage = Number(raw.perPage ?? items.length);
  const total = Number(raw.total ?? items.length);
  return {
    items,
    meta: {
      ...raw,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      perPage: Number.isFinite(perPage) && perPage > 0 ? perPage : Math.max(items.length, 1),
      total: Number.isFinite(total) && total >= 0 ? total : items.length,
    } as unknown as M,
  };
}

// --- Typed helpers ---

export const PERMISSION_MESSAGE =
  "Permission insuffisante — ce module est réservé aux rôles autorisés.";

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

export async function getPublicMeta(base?: string): Promise<PublicMeta> {
  const data = await request<unknown>("/api/v1/meta", undefined, base);
  // Schéma zod chargé à la demande : zod reste hors du bundle initial (Phase 12).
  const { publicMetaSchema } = await import("@misterdou/shared");
  return publicMetaSchema.parse(data);
}

// Formatage monétaire D'AFFICHAGE uniquement (aucun calcul côté client ; les montants
// proviennent toujours du serveur).
export function formatXof(amount: number): string {
  return (
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount) +
    " FCFA"
  );
}

export { request };