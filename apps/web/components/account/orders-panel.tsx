"use client";

import Link from "next/link";
import { formatXof } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import type { OrderSummary } from "@/lib/orders";
import { OrderStatusPill } from "./order-detail";
import { useT, type MessageKey } from "@/lib/i18n";

/** Ce que le client doit faire ensuite, en une ligne. */
function nextStep(order: OrderSummary): { text: MessageKey; urgent: boolean } | null {
  switch (order.status) {
    case "PENDING_PAYMENT":
      return { text: "orders.stepPay", urgent: true };
    case "PARTIALLY_PAID":
      return { text: "orders.stepMonthly", urgent: false };
    case "DELIVERED":
      return { text: "orders.stepConfirm", urgent: true };
    case "COMPLETED":
      return { text: "orders.stepAccess", urgent: false };
    default:
      return null;
  }
}

export function OrdersPanel({ orders, loading, loadError }: { orders: OrderSummary[]; loading: boolean; loadError: string | null }) {
  const t = useT();
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-stone-400">
        <Spinner className="h-4 w-4 text-[var(--lux-gold)]" /> {t("orders.loading")}
      </p>
    );
  }
  if (loadError && orders.length === 0) return <Alert tone="danger">{loadError}</Alert>;
  if (orders.length === 0) {
    return (
      <div>
        <p className="text-[14px] leading-relaxed text-stone-400">{t("orders.empty")}</p>
        <Link href="/offres" className="lux-btn lux-btn-ghost mt-5 text-[12px] uppercase tracking-[0.14em]" style={{ borderRadius: 18 }}>
          {t("orders.discover")}
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {loadError && <Alert tone="warning">{loadError}</Alert>}
      {orders.map((order) => {
        const step = nextStep(order);
        return (
          <li key={order.id}>
            <Link
              href={`/account/orders/${order.id}`}
              className="group flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 transition hover:border-[rgba(255,106,50,0.4)] hover:bg-white/[0.05]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] uppercase tracking-[0.2em] text-stone-500">
                  {order.orderNumber} · {new Date(order.createdAt).toLocaleDateString(t.intl)}
                </p>
                <p className="mt-1 truncate font-semibold text-stone-100">{order.firstItem?.title ?? t("order.fallbackTitle")}</p>
                {step && <p className={`mt-1 text-[12.5px] ${step.urgent ? "text-[#ff8a5c]" : "text-stone-400"}`}>{t(step.text)}</p>}
              </div>
              <div className="shrink-0 text-right">
                <OrderStatusPill status={order.status} />
                <p className="mt-1.5 text-[14px] font-semibold tabular-nums text-stone-100">{formatXof(order.totalAmount)}</p>
              </div>
              <span aria-hidden className="text-stone-500 transition group-hover:translate-x-0.5 group-hover:text-white">
                →
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
