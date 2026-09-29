"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, formatXof, request } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { IconBadgeCheck, IconCheck, IconSpark } from "@/components/dash/dash-icons";
import { useT } from "@/lib/i18n";

type JoinState = {
  fee: number;
  kycVerified: boolean;
  sellerStatus: string | null;
  checkoutUrl: string | null;
};

// Devenir vendeur : frais d'adhésion payés en ligne, activation automatique.
export default function BecomeSellerPage() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<JoinState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<JoinState>("/api/v1/seller/join")
      .then(setState)
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : t("join.failed")));
  }, [t]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await request<{ checkoutUrl: string }>("/api/v1/seller/join", { method: "POST", body: JSON.stringify({}) });
      router.push(res.checkoutUrl);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("join.failed"));
      setBusy(false);
    }
  }

  if (!state) {
    return error ? (
      <p className="text-sm text-[#fca5a5]">{error}</p>
    ) : (
      <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
        <Spinner /> {t("account.loading")}
      </p>
    );
  }

  const fee = formatXof(state.fee);
  const active = state.sellerStatus === "ACTIVE";
  const blocked = state.sellerStatus !== null && !active && state.sellerStatus !== "APPLICATION_PENDING";

  return (
    <section className="dash-card max-w-2xl p-6 sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ff8a5c]">{t("join.kicker")}</p>
      <h1 className="mt-2 text-[26px] font-semibold leading-tight text-white">{t("join.title")}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[#cdbab3]">{t("join.lead", { fee })}</p>

      <ul className="mt-6 space-y-3">
        {(["join.b1", "join.b2", "join.b3", "join.b4"] as const).map((key) => (
          <li key={key} className="flex gap-3 text-[13px] leading-relaxed text-[#e9dad3]">
            <span className="dash-icon !h-7 !w-7 shrink-0">
              <IconCheck size={14} />
            </span>
            {t(key)}
          </li>
        ))}
      </ul>

      {error && <p className="mt-5 text-[13px] text-[#fca5a5]">{error}</p>}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        {active ? (
          <>
            <p className="text-[14px] text-[#86efac]">{t("join.active")}</p>
            <Link href="/seller" className="dash-btn dash-btn-primary">
              <IconSpark size={15} /> {t("join.openSpace")}
            </Link>
          </>
        ) : blocked ? (
          <p className="text-[14px] text-[#fca5a5]">{t("join.blocked")}</p>
        ) : !state.kycVerified ? (
          <>
            <p className="text-[13px] leading-relaxed text-[#ffb08a]">{t("join.kycNeeded")}</p>
            <Link href="/identity-verification" className="dash-btn dash-btn-primary shrink-0">
              <IconBadgeCheck size={15} /> {t("join.kycCta")}
            </Link>
          </>
        ) : state.checkoutUrl ? (
          <Link href={state.checkoutUrl} className="dash-btn dash-btn-primary">
            {t("join.resume")}
          </Link>
        ) : (
          <button type="button" onClick={() => void join()} disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
            {busy ? <Spinner /> : null} {t("join.pay", { fee })}
          </button>
        )}
      </div>
    </section>
  );
}
