"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { errorMessage } from "@/lib/api";
import { Alert } from "@/components/ui";
import { ExchangeDetail, ExchangeList } from "@/components/exchanges/exchange-views";
import { exchangesApi, type ExchangeSummary } from "@/lib/exchanges";
import { useT } from "@/lib/i18n";

function MyExchanges() {
  const t = useT();
  const params = useSearchParams();
  const id = params.get("id");
  const [items, setItems] = useState<ExchangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) return;
    setLoading(true);
    exchangesApi
      .mine()
      .then(setItems)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (id) {
    return (
      <div className="space-y-4">
        {params.get("sent") && <Alert tone="success">{t("xch.sent")}</Alert>}
        <ExchangeDetail id={id} backHref="/account/echanges" />
      </div>
    );
  }

  return (
    <section className="dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-white">{t("xch.mineTitle")}</h1>
        <Link href="/offres" className="text-[13px] text-[#ff8a5c] hover:underline">
          {t("xch.browse")}
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-[#b8a6a1]">{t("xch.mineLead")}</p>
      <div className="mt-5">
        <ExchangeList items={items} loading={loading} error={error} base="/account/echanges" side="client" empty={t("xch.empty")} />
      </div>
    </section>
  );
}

export default function MyExchangesPage() {
  return (
    <Suspense>
      <MyExchanges />
    </Suspense>
  );
}
