import type { ApiErrorCode } from "@misterdou/shared";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (code: ApiErrorCode, message: string, details?: unknown) =>
  new ApiError(code, 400, message, details);

export const unauthorized = (message = "Connectez-vous pour continuer.") =>
  new ApiError("UNAUTHORIZED", 401, message);

export const forbidden = (message = "Vous n’avez pas accès à cette action.") =>
  new ApiError("FORBIDDEN", 403, message);

export const notFound = (message = "Élément introuvable : il a peut-être été supprimé. Rechargez la page.") =>
  new ApiError("NOT_FOUND", 404, message);

export const conflict = (code: ApiErrorCode, message: string) =>
  new ApiError(code, 409, message);