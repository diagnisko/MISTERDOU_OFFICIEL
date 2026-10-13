"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { errorMessage } from "@/lib/api";
import { SellerFrame } from "@/components/seller/seller-frame";
import { ExchangeDetail, ExchangeList } from "@/components/exchanges/exchange-views";
import { exchangesApi, type ExchangeSummary } from "@/lib/exchanges";
import { useAccount } from "@/lib/account";
import { useT } from "@/lib/i18n";

function SellerExchanges() {
  const t = useT();
  const id = useSearchParams().get("id");
  const [items, setItems] = useState<ExchangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) return;
    setLoading(true);
    exchangesApi
      .seller()
      .then(setItems)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (id) return <ExchangeDetail id={id} backHref="/seller/echanges" />;

  return (
    <section className="dash-card p-5 sm:p-6">
      <h1 className="text-[20px] font-semibold text-white">{t("xch.sellerTitle")}</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-[#b8a6a1]">{t("xch.sellerLead")}</p>
      <div className="mt-5">
        <ExchangeList items={items} loading={loading} error={error} base="/seller/echanges" side="seller" empty={t("xch.sellerEmpty")} />
      </div>
    </section>
  );
}

export default function SellerExchangesPage() {
  const account = useAccount();
  const router = useRouter();
  useEffect(() => {
    if (account.status === "guest") router.replace("/login?next=/seller/echanges");
  }, [account.status, router]);
  return (
    <SellerFrame>
      <Suspense>{account.status === "member" && <SellerExchanges />}</Suspense>
    </SellerFrame>
  );
}
