import { request, requestPaged, type PageMeta } from "./api";

// ---------------------------------------------------------------------------
// Notifications — GET /notifications, POST /notifications/:id/read,
// POST /notifications/read-all, GET|PATCH /notifications/preferences.
// Labels FR alignés sur NOTIFICATION_TYPES (packages/shared).
// ---------------------------------------------------------------------------

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  channel?: string | null;
  priority?: string | null;
  actionUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
};

export type NotificationMeta = PageMeta & { unread?: number };

export type NotificationPage = { items: NotificationItem[]; meta: NotificationMeta };

export type NotificationPreferences = {
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
  isDefault?: boolean;
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  KYC_VERIFIED: "Vérification acceptée",
  KYC_REJECTED: "Vérification refusée",
  NEW_MESSAGE: "Nouveau message",
  ORDER_CONFIRMED: "Commande confirmée",
  ORDER_DELIVERED: "Commande livrée",
  ORDER_REFUNDED: "Commande remboursée",
  PAYMENT_CONFIRMED: "Paiement confirmé",
  UPCOMING_INSTALLMENT: "Prochaine échéance",
  INSTALLMENT_OVERDUE: "Échéance en retard",
  PRODUCT_SOLD: "Produit vendu",
  SELLER_PAYOUT_AVAILABLE: "Solde disponible",
  FEATURED_ACTIVATED: "Mise en avant activée",
  FEATURED_EXPIRED: "Mise en avant expirée",
  ADMIN_ALERT: "Alerte admin",
  SYSTEM: "Système",
};

export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

export async function fetchNotifications(params: {
  page?: number;
  perPage?: number;
  unreadOnly?: boolean;
}): Promise<NotificationPage> {
  const search = new URLSearchParams();
  search.set("page", String(params.page ?? 1));
  search.set("perPage", String(params.perPage ?? 20));
  if (params.unreadOnly) search.set("unreadOnly", "true");
  return requestPaged<NotificationItem, NotificationMeta>(
    `/api/v1/notifications?${search.toString()}`,
  );
}

export function markNotificationRead(id: string): Promise<unknown> {
  return request(`/api/v1/notifications/${id}/read`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function markAllNotificationsRead(): Promise<unknown> {
  return request("/api/v1/notifications/read-all", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return request<NotificationPreferences>("/api/v1/notifications/preferences");
}

export function saveNotificationPreferences(body: {
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
  sms?: boolean;
}): Promise<NotificationPreferences> {
  return request<NotificationPreferences>("/api/v1/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
