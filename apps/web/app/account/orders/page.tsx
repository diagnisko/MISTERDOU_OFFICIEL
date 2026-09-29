"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { OrdersPanel } from "@/components/account/orders-panel";
import { fetchMyOrders, type OrderSummary } from "@/lib/orders";
import { useT } from "@/lib/i18n";

export default function OrdersPage() {
  const t = useT();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyOrders()
      .then(setOrders)
      .catch((err) => setError(err instanceof Error ? err.message : t("orders.loadFailed")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-white">{t("orders.title")}</h1>
        <Link href="/offres" className="text-[13px] text-[#ff8a5c] hover:underline">
          {t("orders.seeOffers")}
        </Link>
      </div>
      <div className="mt-5">
        <OrdersPanel orders={orders} loading={loading} loadError={error} />
      </div>
    </section>
  );
}
