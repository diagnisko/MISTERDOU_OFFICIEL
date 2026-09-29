import { request } from "./api";

export type ScheduleLine = {
  index: number;
  label: string;
  amountDue: number;
  dueDate: string;
  amountPaid: number;
  status: string;
  paidAt: string | null;
};

export type Schedule = {
  totalAmount: number;
  downPaymentAmount: number;
  downPaid: boolean;
  monthlyAmount: number;
  monthCount: number;
  lastMonthAmount: number | null;
  totalPaid: number;
  remainingAmount: number;
  status: string;
  nextDueDate: string | null;
  nextAmount: number | null;
  fullyPaid: boolean;
  installments: ScheduleLine[];
};

export async function fetchSchedule(orderId: string): Promise<Schedule | null> {
  const data = await request<{ orderId: string; schedule: Schedule | null }>(
    `/api/v1/orders/${orderId}/installments`,
  );
  return data.schedule;
}

/** Règle la prochaine mensualité, ou plusieurs d'avance (`months`). */
export async function payNextInstallment(orderId: string, months = 1): Promise<{
  orderId: string;
  orderNumber: string;
  amount: number;
  alreadyPending: boolean;
  checkoutToken: string;
  checkoutUrl: string;
}> {
  return request(`/api/v1/orders/${orderId}/installments/pay`, {
    method: "POST",
    body: JSON.stringify({ months }),
  });
}
