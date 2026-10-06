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
  commissionPercent: number;
  kycVerified: boolean;
  sellerStatus: string | null;
  checkoutUrl: string | null;
};

type ContractState = {
  plans: Array<{ months: number; price: number }>;
  current: { months: number; startsAt: string; endsAt: string } | null;
  coveredUntil: string | null;
  pending: { months: number; amount: number; checkoutUrl: string; inReview: boolean } | null;
};

// ---------------------------------------------------------------------------
// Devenir vendeur : deux formules.
// • Vendeur classique : adhésion unique, commission sur chaque vente.
// • Contrat revendeur : pour qui revend des comptes qui ne lui appartiennent
//   pas (petite marge) — forfait 6, 12 ou 18 mois, aucune commission.
// Paiement par lien Wave, vérifié par l'équipe ; adhésion incluse au contrat.
// ---------------------------------------------------------------------------
export default function BecomeSellerPage() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<JoinState | null>(null);
  const [contract, setContract] = useState<ContractState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([request<JoinState>("/api/v1/seller/join"), request<ContractState>("/api/v1/seller/contract")])
      .then(([join, deal]) => {
        setState(join);
        setContract(deal);
      })
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : t("join.failed")));
  }, [t]);

  async function open(path: string, body: object, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await request<{ checkoutUrl: string }>(path, { method: "POST", body: JSON.stringify(body) });
      router.push(res.checkoutUrl);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("join.failed"));
      setBusy(null);
    }
  }

  if (!state || !contract) {
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
  const date = (iso: string) => new Date(iso).toLocaleDateString(t.intl, { day: "numeric", month: "long", year: "numeric" });
  const duration = (months: number) => (months === 12 ? t("contract.year") : months === 18 ? t("contract.months18") : t("contract.months", { n: months }));

  return (
    <div className="max-w-4xl space-y-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ff8a5c]">{t("join.kicker")}</p>
        <h1 className="mt-2 text-[26px] font-semibold leading-tight text-white">{t("join.title")}</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#cdbab3]">{t("join.choose")}</p>
      </header>

      {error && <p className="text-[13px] text-[#fca5a5]">{error}</p>}

      {blocked ? (
        <p className="dash-card p-6 text-[14px] text-[#fca5a5]">{t("join.blocked")}</p>
      ) : !state.kycVerified ? (
        <div className="dash-card flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13.5px] leading-relaxed text-[#ffb08a]">{t("join.kycNeeded")}</p>
          <Link href="/identity-verification" className="dash-btn dash-btn-primary shrink-0">
            <IconBadgeCheck size={15} /> {t("join.kycCta")}
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Formule 1 : vendeur classique */}
        <section className="dash-card flex flex-col p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8f7d77]">{t("join.classicKicker")}</p>
          <h2 className="mt-1.5 text-[19px] font-semibold text-white">{t("join.classicTitle")}</h2>
          <p className="mt-1 text-[13px] text-[#b8a6a1]">{t("join.lead", { fee })}</p>
          <ul className="mt-5 flex-1 space-y-3">
            {(["join.b1", "join.b2", "join.b3", "join.b4"] as const).map((key) => (
              <li key={key} className="flex gap-3 text-[13px] leading-relaxed text-[#e9dad3]">
                <span className="dash-icon !h-7 !w-7 shrink-0">
                  <IconCheck size={14} />
                </span>
                {t(key, { rate: state.commissionPercent })}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            {active ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[14px] text-[#86efac]">{t("join.active")}</p>
                <Link href="/seller" className="dash-btn dash-btn-primary">
                  <IconSpark size={15} /> {t("join.openSpace")}
                </Link>
              </div>
            ) : blocked || !state.kycVerified ? null : state.checkoutUrl ? (
              <Link href={state.checkoutUrl} className="dash-btn dash-btn-primary">
                {t("join.resume")}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void open("/api/v1/seller/join", {}, "join")}
                disabled={busy !== null}
                className="dash-btn dash-btn-primary disabled:opacity-60"
              >
                {busy === "join" ? <Spinner /> : null} {t("join.pay", { fee })}
              </button>
            )}
          </div>
        </section>

        {/* Formule 2 : contrat revendeur */}
        <section className="dash-card relative flex flex-col overflow-hidden border-[rgba(255,106,50,0.35)] p-6">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(232,71,36,0.28),transparent_65%)]" />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ff8a5c]">{t("contract.kicker")}</p>
          <h2 className="relative mt-1.5 text-[19px] font-semibold text-white">{t("contract.title")}</h2>
          <p className="relative mt-1 text-[13px] leading-relaxed text-[#cdbab3]">{t("contract.lead", { rate: state.commissionPercent })}</p>

          {contract.current && (
            <p className="relative mt-4 rounded-xl border border-[rgba(134,239,172,0.3)] bg-[rgba(134,239,172,0.06)] px-3.5 py-2.5 text-[13px] text-[#bbf7d0]">
              {t("contract.activeUntil", { date: date(contract.coveredUntil ?? contract.current.endsAt) })}
            </p>
          )}
          {contract.pending && (
            <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.06)] px-3.5 py-2.5">
              <p className="text-[13px] text-[#fde68a]">
                {contract.pending.inReview
                  ? t("contract.inReview", { duration: duration(contract.pending.months) })
                  : t("contract.pendingPay", { duration: duration(contract.pending.months), amount: formatXof(contract.pending.amount) })}
              </p>
              {!contract.pending.inReview && (
                <Link href={contract.pending.checkoutUrl} className="dash-btn dash-btn-primary !min-h-[34px] !text-[12px]">
                  {t("join.resume")}
                </Link>
              )}
            </div>
          )}

          <ul className="relative mt-5 flex-1 space-y-2.5">
            {contract.plans.map((plan) => {
              const best = plan.months === 18;
              return (
                <li key={plan.months}>
                  <button
                    type="button"
                    disabled={busy !== null || blocked || !state.kycVerified || Boolean(contract.pending?.inReview)}
                    onClick={() => void open("/api/v1/seller/contract", { months: plan.months }, `c${plan.months}`)}
                    className={`group flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-start transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      best
                        ? "border-[rgba(255,106,50,0.55)] bg-[rgba(255,106,50,0.1)] hover:bg-[rgba(255,106,50,0.16)]"
                        : "border-white/10 bg-white/[0.03] hover:border-[rgba(255,106,50,0.45)] hover:bg-white/[0.05]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] font-semibold text-white">{duration(plan.months)}</span>
                        {best && (
                          <span className="whitespace-nowrap rounded-full bg-[#ff6a32] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#1a0503]">
                            {t("contract.best")}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-[#8f7d77]">
                        {t("contract.perMonth", { amount: formatXof(Math.round(plan.price / plan.months)) })}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="whitespace-nowrap text-[17px] font-semibold tabular-nums text-white">{formatXof(plan.price)}</span>
                      <span className="hidden whitespace-nowrap text-[12px] font-semibold text-[#ffb08a] group-hover:underline sm:inline">
                        {busy === `c${plan.months}` ? <Spinner /> : contract.current ? t("contract.renew") : t("contract.choose")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <ul className="relative mt-5 space-y-2 text-[12.5px] leading-relaxed text-[#e9dad3]">
            {(["contract.b1", "contract.b2", "contract.b3"] as const).map((key) => (
              <li key={key} className="flex gap-2.5">
                <IconCheck size={14} className="mt-0.5 shrink-0 text-[#ff8a5c]" />
                {t(key, { rate: state.commissionPercent })}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
