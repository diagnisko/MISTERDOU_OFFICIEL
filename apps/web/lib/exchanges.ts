import { request } from "./api";

// Échanges de comptes : types et appels partagés (client, vendeur, console).

export type ExchangeStatus =
  | "PENDING"
  | "QUOTED"
  | "ACCEPTED"
  | "AWAITING_PAYMENT"
  | "COMPLETED"
  | "REJECTED"
  | "DECLINED"
  | "CUSTODY_REFUSED"
  | "EXPIRED"
  | "CANCELLED";

export const OPEN_STATUSES: ExchangeStatus[] = ["PENDING", "QUOTED", "ACCEPTED", "AWAITING_PAYMENT"];

export type ExchangeSummary = {
  id: string;
  number: string;
  status: ExchangeStatus;
  createdAt: string;
  updatedAt: string;
  topUpAmount: number | null;
  gameAccountId: string;
  product: { id: string; title: string; slug: string; imageUrl: string | null };
  counterpart: string;
  sellerName: string | null;
  waitingFor: "seller" | "team" | "client" | null;
};

export type Exchange = {
  id: string;
  number: string;
  status: ExchangeStatus;
  side: "client" | "seller" | "team";
  createdAt: string;
  replyDeadline: string;
  quoteExpiresAt: string | null;
  topUpAmount: number | null;
  replyMessage: string | null;
  repliedAt: string | null;
  message: string | null;
  gameAccountId: string;
  proofCode: string;
  video: { url: string; mimeType: string | null } | null;
  videoPurged: boolean;
  paymentMode: "ONE_TIME" | "INSTALLMENTS";
  acceptedAt: string | null;
  custodyAt: string | null;
  custodyNote: string | null;
  completedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  product: { id: string; title: string; slug: string; price: number; available: boolean; imageUrl: string | null; canSplit: boolean };
  seller: string;
  client: { name: string; email: string | null } | null;
  custody: { codeRequested: boolean; codeProvided: boolean; codeExpiresAt: string | null; code: string | null };
  order: { id: string | null; orderNumber: string; status: string; checkoutUrl: string | null; paymentUnderReview: boolean } | null;
  actions: {
    reply: boolean;
    accept: boolean;
    decline: boolean;
    cancel: boolean;
    provideCode: boolean;
    custody: boolean;
    revealClientAccount: boolean;
    report: boolean;
  };
};

export type ClientAccount = { number: string; gameAccountId: string; login: string; password: string; code: string | null; codeExpiresAt: string | null };

export type Prepared = {
  product: { id: string; title: string; slug: string; price: number; imageUrl: string | null };
  proof: { code: string; token: string; expiresAt: string };
  videoMaxBytes: number;
  videoMaxSeconds: number;
};

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const exchangesApi = {
  prepare: (productId: string) => request<Prepared>(`/api/v1/exchanges/prepare?productId=${encodeURIComponent(productId)}`),
  videoUploadUrl: (mimeType: string, sizeBytes: number) =>
    post<{ key: string; uploadUrl: string; headers: Record<string, string> }>("/api/v1/exchanges/video/upload-url", { mimeType, sizeBytes }),
  create: (body: { productId: string; gameAccountId: string; videoKey: string; videoMime: string; message: string | null; proofToken: string }) =>
    post<{ id: string; number: string }>("/api/v1/exchanges", body),
  mine: () => request<ExchangeSummary[]>("/api/v1/exchanges/mine"),
  seller: () => request<ExchangeSummary[]>("/api/v1/seller/exchanges"),
  team: (status: "todo" | "open" | "closed" | "all") =>
    request<{ items: ExchangeSummary[]; todo: number }>(`/api/v1/admin/exchanges?status=${status}`),
  get: (id: string) => request<Exchange>(`/api/v1/exchanges/${id}`),
  reply: (id: string, body: { decision: "quote"; topUpAmount: number; message?: string | null } | { decision: "reject"; message: string }) =>
    post<Exchange>(`/api/v1/exchanges/${id}/reply`, body),
  accept: (id: string, body: { paymentMode: "ONE_TIME" | "INSTALLMENTS"; login: string; password: string }) =>
    post<Exchange>(`/api/v1/exchanges/${id}/accept`, body),
  decline: (id: string) => post<Exchange>(`/api/v1/exchanges/${id}/decline`),
  cancel: (id: string) => post<Exchange>(`/api/v1/exchanges/${id}/cancel`),
  provideCode: (id: string, code: string) => post<Exchange>(`/api/v1/exchanges/${id}/custody-code`, { code }),
  clientAccount: (id: string) => request<ClientAccount>(`/api/v1/exchanges/${id}/client-account`),
  report: (id: string, message: string) => post<{ ticketId: string }>(`/api/v1/exchanges/${id}/report`, { message }),
  requestCode: (id: string) => post<Exchange>(`/api/v1/admin/exchanges/${id}/code-request`),
  custody: (id: string, body: { decision: "confirm"; note?: string | null } | { decision: "refuse"; reason: string }) =>
    post<Exchange>(`/api/v1/admin/exchanges/${id}/custody`, body),
};

/** Pastille de statut (classes des tableaux de bord). */
export function statusTone(status: ExchangeStatus): string {
  switch (status) {
    case "COMPLETED":
      return "dash-pill-paid";
    case "PENDING":
    case "QUOTED":
    case "ACCEPTED":
    case "AWAITING_PAYMENT":
      return "dash-pill-due";
    case "REJECTED":
    case "CUSTODY_REFUSED":
      return "dash-pill-late";
    default:
      return "dash-pill-none";
  }
}
