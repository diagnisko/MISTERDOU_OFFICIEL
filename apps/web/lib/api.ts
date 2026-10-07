import type { ApiEnvelope, ApiErrorCode } from "@misterdou/shared";
import { documentLocale, hasMessage, translate } from "./i18n-core";

/**
 * Message d'erreur dans la langue choisie. En français (langue de base), le
 * texte précis du serveur est gardé ; en anglais ou en arabe, le code d'erreur
 * donne une traduction générique quand elle existe.
 */
function localizedError(code: string, serverMessage: string): string {
  const locale = documentLocale();
  const key = `apiError.${code}`;
  if (locale === "fr" || !hasMessage(key)) return serverMessage;
  return translate(locale, key);
}

const BROWSER_BASE = "";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
    // Créneau d'un manager terminé en pleine session : la console se ferme (admin/layout.tsx).
    if (code === "OUTSIDE_SHIFT" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<ShiftClosed>(OUTSIDE_SHIFT_EVENT, { detail: shiftClosed(message, details) }));
    }
  }
}

/** Émis quand l'API répond OUTSIDE_SHIFT (detail : ShiftClosed). */
export const OUTSIDE_SHIFT_EVENT = "misterdou:outside-shift";

/** Espace de gestion fermé hors des créneaux d'un manager (titre, message, horaires). */
export type ShiftClosed = { title: string; message: string; schedule: string | null };

export function shiftClosed(message: string, details: unknown): ShiftClosed {
  const d = (details ?? {}) as Partial<ShiftClosed>;
  return {
    title: typeof d.title === "string" ? d.title : "Espace de gestion fermé",
    message: typeof d.message === "string" ? d.message : message,
    schedule: typeof d.schedule === "string" ? d.schedule : null,
  };
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
    throw new ApiClientError("SERVICE_UNAVAILABLE" as ApiErrorCode, localizedError("SERVICE_UNAVAILABLE", "API injoignable"), String(err));
  }

  let payload: ApiEnvelope = { ok: false, error: { code: "INTERNAL_ERROR" as ApiErrorCode, message: "Réponse illisible" } };
  try {
    payload = (await res.json()) as ApiEnvelope;
  } catch {
    /* corps non JSON — enveloppe par défaut */
  }

  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, localizedError(payload.error.code, payload.error.message), payload.error.details);
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
    throw new ApiClientError("INTERNAL_ERROR" as ApiErrorCode, localizedError("INTERNAL_ERROR", "Impossible d’envoyer le fichier"), String(err));
  }

  let payload: ApiEnvelope = { ok: false, error: { code: "INTERNAL_ERROR" as ApiErrorCode, message: "Réponse illisible" } };
  try {
    payload = (await res.json()) as ApiEnvelope;
  } catch {
    /* ignore */
  }
  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, localizedError(payload.error.code, payload.error.message), payload.error.details);
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
    throw new ApiClientError("SERVICE_UNAVAILABLE" as ApiErrorCode, localizedError("SERVICE_UNAVAILABLE", "API injoignable"), String(err));
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
    throw new ApiClientError(payload.error.code, localizedError(payload.error.code, payload.error.message), payload.error.details);
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
export function errorMessage(err: unknown, fallback?: string): string {
  const locale = documentLocale();
  if (err instanceof ApiClientError) {
    if (err.code !== "FORBIDDEN") return err.message;
    return locale === "fr" ? PERMISSION_MESSAGE : translate(locale, "apiError.FORBIDDEN");
  }
  fallback ??= locale === "fr" ? "Une erreur est survenue." : translate(locale, "apiError.INTERNAL_ERROR");
  if (typeof err === "string" && err.trim().length > 0) return err;
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  return fallback;
}

export function isPermissionError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "FORBIDDEN";
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