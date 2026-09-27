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

export const unauthorized = (message = "Non authentifié") =>
  new ApiError("UNAUTHORIZED", 401, message);

export const forbidden = (message = "Accès refusé") =>
  new ApiError("FORBIDDEN", 403, message);

export const notFound = (message = "Ressource introuvable") =>
  new ApiError("NOT_FOUND", 404, message);

export const conflict = (code: ApiErrorCode, message: string) =>
  new ApiError(code, 409, message);