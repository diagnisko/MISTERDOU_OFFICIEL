import { request, requestPaged, type PageMeta } from "./api";

// ---------------------------------------------------------------------------
// Support (tickets) — libellés FR partagés entre l'espace membre et l'admin.
// Endpoints : GET|POST /support/tickets, GET|PATCH /support/tickets/:id,
// GET /support/tickets/mine, GET|PATCH /admin/support/tickets[/:id].
// ---------------------------------------------------------------------------

export type SupportTicketStatus = "CREATED" | "PENDING" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  VERIFICATION_CODE: "Aide au code de vérification",
  SELLER_REPORT: "Signalement d’un vendeur",
  PAYMENT_ISSUE: "Problème de paiement",
  DELIVERY: "Livraison",
  OTHER: "Autre",
};

export const SUPPORT_CATEGORY_OPTIONS = [
  { value: "VERIFICATION_CODE", label: "Aide au code de vérification" },
  { value: "SELLER_REPORT", label: "Signalement d’un vendeur" },
  { value: "PAYMENT_ISSUE", label: "Problème de paiement" },
  { value: "DELIVERY", label: "Livraison" },
  { value: "OTHER", label: "Autre" },
] as const;

export const SUPPORT_STATUS_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "CREATED", label: "Créée" },
  { value: "PENDING", label: "En attente" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "RESOLVED", label: "Résolue" },
  { value: "CLOSED", label: "Fermée" },
] as const;

export function supportCategoryLabel(category: string): string {
  return SUPPORT_CATEGORY_LABELS[category] ?? category;
}

export function supportStatusLabel(status: string): string {
  const found = SUPPORT_STATUS_OPTIONS.find((option) => option.value === status);
  return found ? found.label : status;
}

/** Statuts clos : plus aucune action possible côté demandeur. */
export function isTicketClosed(status: string): boolean {
  return status === "CLOSED" || status === "RESOLVED";
}

export type TicketPerson = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  role?: string | null;
};

export type SupportTicket = {
  id: string;
  code: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  reporter?: TicketPerson | null;
  assignedTo?: TicketPerson | null;
};

export type SupportTicketMeta = PageMeta;

export function personLabel(person: TicketPerson | null | undefined): string {
  if (!person) return "—";
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || person.email || "—";
}

// --- Espace membre ---

export async function fetchMyTickets(params: {
  page?: number;
  perPage?: number;
}): Promise<{ items: SupportTicket[]; meta: SupportTicketMeta }> {
  const search = new URLSearchParams();
  search.set("page", String(params.page ?? 1));
  search.set("perPage", String(params.perPage ?? 10));
  return requestPaged<SupportTicket, SupportTicketMeta>(
    `/api/v1/support/tickets/mine?${search.toString()}`,
  );
}

export function fetchTicket(id: string): Promise<SupportTicket> {
  return request<SupportTicket>(`/api/v1/support/tickets/${id}`);
}

export function createTicket(body: {
  category: string;
  subject: string;
  description: string;
  orderId?: string;
}): Promise<SupportTicket> {
  return request<SupportTicket>("/api/v1/support/tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateMyTicket(id: string, status: "RESOLVED" | "CLOSED"): Promise<unknown> {
  return request(`/api/v1/support/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
