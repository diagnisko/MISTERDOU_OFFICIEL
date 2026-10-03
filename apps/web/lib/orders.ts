import { request, formatXof } from "./api";
import type { Schedule } from "./installments";

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: string;
  totalAmount: number;
  itemCount: number;
  firstItem: { title: string; division: string; teamPower: number; coins: number } | null;
  createdAt: string;
  deliveredAt: string | null;
  receivedAt: string | null;
  canReveal: boolean;
};

export type VerificationCode = {
  id: string;
  status: "PENDING" | "PROVIDED" | "EXPIRED";
  code: string | null;
  requestedAt: string;
  providedAt: string | null;
  expiresAt: string | null;
};

export type OrderReport = { id: string; category: string; subject: string; status: string; createdAt: string };

export type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  discountAmount: number;
  currency: string;
  paymentMode: string;
  createdAt: string;
  deliveredAt: string | null;
  receivedAt: string | null;
  autoConfirmAt: string | null;
  canReveal: boolean;
  canConfirmReceipt: boolean;
  /** Règlement ouvert à reprendre (page de paiement). */
  checkoutUrl: string | null;
  /** Preuve de paiement Wave en cours de vérification par l'équipe. */
  paymentUnderReview: boolean;
  verificationCode: VerificationCode | null;
  schedule: Schedule | null;
  reports: OrderReport[];
  items: Array<{
    id: string;
    title: string;
    division: string;
    teamPower: number;
    coins: number;
    unitPrice: number;
    quantity: number;
    productSlug: string;
    soldBy: string;
  }>;
  payments: Array<{
    id: string;
    paymentNumber: string;
    type: string;
    amount: number;
    status: string;
    paidAt: string | null;
  }>;
};

export type RevealedCredentials = {
  title: string;
  orderNumber: string;
  email: string;
  password: string;
};

export async function createOrder(
  productId: string,
  paymentMode: "ONE_TIME" | "INSTALLMENTS" = "ONE_TIME",
): Promise<{ orderId: string; orderNumber: string; amount: number; token: string }> {
  return request<{ orderId: string; orderNumber: string; amount: number; token: string }>("/api/v1/orders", {
    method: "POST",
    body: JSON.stringify({ productId, quantity: 1, paymentMode }),
  });
}

export async function fetchMyOrders(): Promise<OrderSummary[]> {
  return request<OrderSummary[]>("/api/v1/orders/mine");
}

export async function fetchMyOrder(id: string): Promise<OrderDetail> {
  return request<OrderDetail>(`/api/v1/orders/${id}`);
}

export async function revealOrderCredentials(id: string): Promise<RevealedCredentials> {
  return request<RevealedCredentials>(`/api/v1/orders/${id}/reveal`);
}

export { formatXof };

export async function requestVerificationCode(id: string): Promise<VerificationCode> {
  return request<VerificationCode>(`/api/v1/orders/${id}/verification-code`, { method: "POST", body: JSON.stringify({}) });
}

export async function confirmOrderReceipt(id: string): Promise<{ id: string; receivedAt: string }> {
  return request(`/api/v1/orders/${id}/confirm-receipt`, { method: "POST", body: JSON.stringify({}) });
}

export type ReportReason = "SELLER_REPORT" | "DELIVERY" | "VERIFICATION_CODE" | "OTHER";

export async function reportOrderProblem(
  orderId: string,
  input: { category: ReportReason; subject: string; description: string },
): Promise<{ id: string; code: string }> {
  return request("/api/v1/support/tickets", { method: "POST", body: JSON.stringify({ ...input, orderId }) });
}

