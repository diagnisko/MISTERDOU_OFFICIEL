import { request, formatXof } from "./api";

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
  canReveal: boolean;
};

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
  canReveal: boolean;
  items: Array<{
    id: string;
    title: string;
    division: string;
    teamPower: number;
    coins: number;
    unitPrice: number;
    quantity: number;
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
