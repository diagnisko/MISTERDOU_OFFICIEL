"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ExchangeRequestForm } from "@/components/exchanges/exchange-request-form";
import { useT } from "@/lib/i18n";

function NewExchange() {
  const t = useT();
  const productId = useSearchParams().get("offre");
  if (!productId) {
    return (
      <Link href="/offres" className="text-[13px] text-[#ff8a5c] hover:underline">
        {t("xch.browse")}
      </Link>
    );
  }
  return <ExchangeRequestForm productId={productId} />;
}

export default function NewExchangePage() {
  return (
    <Suspense>
      <NewExchange />
    </Suspense>
  );
}
