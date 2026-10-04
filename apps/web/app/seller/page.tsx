"use client";

import { useCallback, useEffect, useState } from "react";
import { CodeQueue } from "@/components/codes/code-queue";
import { sellerNav } from "@/components/seller/seller-nav";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, request, formatXof } from "@/lib/api";
import { Alert, Spinner, StatusBadge } from "@/components/ui";
import { MediaManager } from "@/components/media/media-manager";
import { AreaChart, DashHeading, DashShell, KpiCard, Panel } from "@/components/dash/dash-ui";
import { IconClock, IconCoins, IconPercent, IconWallet } from "@/components/dash/dash-icons";
import { useT } from "@/lib/i18n";
import { logoutAccount } from "@/lib/account";
import { WithdrawalsPanel, type SellerWithdrawal } from "@/components/seller/withdrawals-panel";

// ---------------------------------------------------------------------------
// Espace vendeur — soldes, gains, ventes récentes et mise en avant (§13, §18).
// Aucun montant calculé ici : le total d'une mise en avant est dailyRate (API)
// × jours saisis, le serveur recalcule et facture.
// ---------------------------------------------------------------------------

type Dashboard = {
  seller: {
    id: string;
    status: string;
    sellerSince: string | null;
    registrationFee: number;
    registrationPaidAt: string | null;
  } | null;
  balance: {
    balanceAvailable: number;
    balancePending: number;
    totalEarnings: number;
    totalCommissionPaid: number;
  } | null;
  products: {
    id: string;
    title: string;
    slug: string;
    status: string;
    basePrice: number;
    paymentMode: string;
    featuredUntil: string | null;
    isFeatured: boolean;
    /** Payée, en attente de validation par l'équipe. */
    featuredPending?: boolean;
  }[];
  dailyRate: number;
  minWithdrawal: number;
  withdrawals: SellerWithdrawal[];
  salesByMonth: { month: string; net: number; count: number }[];
  recentSales: {
    id: string;
    title: string;
    orderNumber: string;
    orderAmount: number;
    commissionAmount: number;
    netToSeller: number;
    status: string;
    createdAt: string;
  }[];
};

type Me = { firstName: string | null; lastName: string | null; email: string | null };

type FeaturedResult = {
  purchaseId: string;
  activated: boolean;
  pendingReview?: boolean;
  amount: number;
  days: number;
  dailyRate: number;
  token: string | null;
  featuredUntil: string | null;
  checkoutUrl: string | null;
};

// Forfaits de mise en avant (jours) ; activés dès le paiement, retirés à échéance.
const DAY_PRESETS = [3, 7, 15, 30];


export default function SellerPage() {
  const t = useT();
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [modalProduct, setModalProduct] = useState<Dashboard["products"][number] | null>(null);
  const [days, setDays] = useState(DAY_PRESETS[0]!);
  const [paying, setPaying] = useState<"BALANCE" | "WAVE" | null>(null);
  const [mediaProduct, setMediaProduct] = useState<Dashboard["products"][number] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await request<Dashboard>("/api/v1/seller/dashboard");
      // Pas encore vendeur : page d'adhésion.
      if (!data.seller) {
        router.replace("/account/devenir-vendeur");
        return;
      }
      setDash(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")) {
        router.replace("/login");
      } else {
        setError(err instanceof ApiClientError ? err.message : t("seller.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
    request<{ user: Me }>("/api/v1/auth/me")
      .then((res) => setMe(res.user))
      .catch(() => undefined);
  }, [load]);

  function openFeatured(product: Dashboard["products"][number]) {
    setDays(DAY_PRESETS[0]!);
    setModalProduct(product);
    setNotice(null);
    setError(null);
  }

  async function pay(method: "BALANCE" | "WAVE") {
    if (!modalProduct) return;
    setPaying(method);
    setError(null);
    setNotice(null);
    try {
      const result = await request<FeaturedResult>(`/api/v1/products/${modalProduct.id}/featured`, {
        method: "POST",
        body: JSON.stringify({ days, paymentMethod: method }),
      });
      if (result.activated) {
        setNotice(
          t("seller.featuredOn", {
            duration: t(result.days > 1 ? "seller.dayMany" : "seller.dayOne", { n: result.days }),
            amount: formatXof(result.amount),
            until: result.featuredUntil ? t("seller.featuredUntil", { date: new Date(result.featuredUntil).toLocaleDateString(t.intl) }) : "",
          }),
        );
        setModalProduct(null);
        await load();
        return;
      }
      if (result.pendingReview) {
        // Payée par le solde : l'équipe valide, la mise en avant démarre ensuite.
        setNotice(t("seller.featurePending", { amount: formatXof(result.amount) }));
        setModalProduct(null);
        await load();
        return;
      }
      if (result.checkoutUrl) {
        router.push(result.checkoutUrl);
        return;
      }
      setError(t("seller.incomplete"));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("seller.payFailed"));
    } finally {
      setPaying(null);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await logoutAccount();
    } finally {
      router.replace("/");
    }
  }

  const rate = dash?.dailyRate ?? 0;
  const amount = rate * days;
  const available = dash?.balance?.balanceAvailable ?? 0;
  const insufficient = available < amount;
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 90;
  const name = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || t("seller.fallbackName");
  const salesChart = (dash?.salesByMonth ?? []).map((m) => {
    const [y, mo] = m.month.split("-").map(Number);
    return {
      label: new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString(t.intl, { month: "short", timeZone: "UTC" }).replace(".", ""),
      primary: m.net,
    };
  });

  if (loading) {
    return (
      <div data-lux className="dash-root grid place-items-center text-sm text-[#b8a6a1]">
        <span className="flex items-center gap-3">
          <Spinner /> {t("seller.opening")}
        </span>
      </div>
    );
  }

  return (
    <DashShell
      nav={sellerNav(t)}
      areaLabel={t("seller.area")}
      user={{ name, email: me?.email }}
      onLogout={() => void logout()}
      loggingOut={loggingOut}
      badge={
        dash?.seller ? (
          <span className="hidden md:inline-block">
            <StatusBadge status={dash.seller.status} />
          </span>
        ) : null
      }
    >
      <DashHeading
        greeting={me?.firstName ? t("seller.hello", { name: me.firstName }) : t("seller.area")}
        title={t("seller.title")}
        actions={
          <Link href="/offres" className="dash-btn dash-btn-ghost">
            {t("seller.seeCatalogue")}
          </Link>
        }
      />

      {error && !modalProduct && (
        <div className="mt-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mt-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {!dash?.seller && (
        <div className="mt-6">
          <Alert tone="warning">
            {t("seller.noProfile")}
          </Alert>
        </div>
      )}

      <section aria-label={t("seller.balances")} className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          hero
          icon={IconWallet}
          label={t("seller.available")}
          value={formatXof(dash?.balance?.balanceAvailable ?? 0)}
          hint={t("seller.availableHint")}
        />
        <KpiCard
          icon={IconClock}
          label={t("seller.pending")}
          value={formatXof(dash?.balance?.balancePending ?? 0)}
          hint={t("seller.pendingHint")}
        />
        <KpiCard
          icon={IconCoins}
          label={t("seller.earnings")}
          value={formatXof(dash?.balance?.totalEarnings ?? 0)}
          hint={t("seller.earningsHint")}
        />
        <KpiCard
          icon={IconPercent}
          label={t("seller.commissions")}
          value={formatXof(dash?.balance?.totalCommissionPaid ?? 0)}
          hint={t("seller.commissionsHint")}
        />
      </section>

      {dash?.seller && (
        <WithdrawalsPanel
          available={dash.balance?.balanceAvailable ?? 0}
          minAmount={dash.minWithdrawal}
          withdrawals={dash.withdrawals}
          onDone={load}
        />
      )}

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Panel title={t("seller.chart")}>
          <AreaChart data={salesChart} primaryLabel={t("seller.chartLabel")} format={formatXof} />
        </Panel>
        <Panel title={t("seller.recent")}>
          {(dash?.recentSales.length ?? 0) === 0 ? (
            <p className="text-[13px] text-[#8f7d77]">{t("seller.recentEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {dash!.recentSales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-white">{sale.title}</p>
                    <p className="text-[11px] text-[#8f7d77]">
                      {new Date(sale.createdAt).toLocaleDateString(t.intl)} · {t("seller.commission", { amount: formatXof(sale.commissionAmount) })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-white">+{formatXof(sale.netToSeller)}</p>
                    <span className={`dash-pill mt-1 ${sale.status === "RELEASED" ? "dash-pill-paid" : "dash-pill-due"}`}>
                      {sale.status === "RELEASED" ? t("seller.released") : t("seller.onHold")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section id="codes" className="dash-card mt-4 scroll-mt-24 p-5">
        <h2 className="text-[15px] font-semibold text-stone-100">{t("seller.codesTitle")}</h2>
        <p className="mb-4 mt-0.5 text-[12px] text-[#8f7d77]">
          {t("seller.codesLead")}
        </p>
        <CodeQueue compact />
      </section>

      <section className="dash-card mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-stone-100">{t("seller.offers")}</h2>
            <p className="mt-0.5 text-[12px] text-[#8f7d77]">
              {t("seller.offersLead", { rate: formatXof(rate) })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#8f7d77]">
              {t((dash?.products.length ?? 0) > 1 ? "seller.offersCountMany" : "seller.offersCountOne", { n: dash?.products.length ?? 0 })}
            </span>
            <Link href="/seller/offres/nouvelle" className="dash-btn dash-btn-primary !min-h-[36px] !text-[12px]">
              {t("offer.newTitle")}
            </Link>
          </div>
        </div>
        <div className="dash-scroll -mx-5 mt-3 overflow-x-auto">
          <table className="dash-table w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                <th className="ps-5">{t("seller.colAccount")}</th>
                <th>{t("seller.colPrice")}</th>
                <th>{t("seller.colState")}</th>
                <th>{t("seller.colFeatured")}</th>
                <th className="pr-5">
                  <span className="sr-only">{t("seller.colAction")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(dash?.products.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="pl-5 text-[#8f7d77]">
                    {t("seller.noOffers")}
                  </td>
                </tr>
              )}
              {(dash?.products ?? []).map((product) => (
                <tr key={product.id}>
                  <td className="pl-5">
                    <Link href={`/catalogue/${product.slug}`} className="text-white hover:underline">
                      {product.title}
                    </Link>
                    <p className="text-[11px] text-[#8f7d77]">
                      {product.paymentMode === "INSTALLMENTS" ? t("seller.modeMonthly") : t("seller.modeOnce")}
                    </p>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatXof(product.basePrice)}</td>
                  <td>
                    <StatusBadge status={product.status} />
                  </td>
                  <td>
                    {product.featuredPending ? (
                      <span className="dash-pill dash-pill-due">{t("seller.inReview")}</span>
                    ) : product.isFeatured ? (
                      <span className="dash-pill dash-pill-paid">
                        {t("seller.until", { date: product.featuredUntil ? new Date(product.featuredUntil).toLocaleDateString(t.intl) : "—" })}
                      </span>
                    ) : (
                      <span className="dash-pill dash-pill-none">{t("seller.no")}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap pr-5 text-right">
                    {product.status !== "SOLD" && (
                      <Link href={`/seller/offres/${product.id}`} className="dash-btn dash-btn-ghost mr-2 !min-h-[34px] !text-[12px]">
                        {t("offer.edit")}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setMediaProduct(product)}
                      className="dash-btn dash-btn-ghost mr-2 !min-h-[34px] !text-[12px]"
                    >
                      {t("seller.media")}
                    </button>
                    {/* Seule une offre en vente peut être mise en avant (règle de l'API). */}
                    {product.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => openFeatured(product)}
                        disabled={product.featuredPending}
                        className="dash-btn dash-btn-ghost !min-h-[34px] !text-[12px] disabled:opacity-40"
                      >
                        {product.isFeatured ? t("seller.extend") : t("seller.feature")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {mediaProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("seller.mediaOf", { title: mediaProduct.title })}
          className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/75 p-4"
          onClick={() => setMediaProduct(null)}
        >
          <div className="dash-card my-auto w-full max-w-2xl p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] text-[#b8a6a1]">{t("seller.mediaKicker")}</p>
                <h3 className="mt-1 text-[18px] font-semibold text-white">{mediaProduct.title}</h3>
              </div>
              <button type="button" onClick={() => setMediaProduct(null)} aria-label={t("seller.close")} className="dash-btn dash-btn-ghost dash-btn-round !min-h-[34px] !w-[34px]">
                ✕
              </button>
            </div>
            <p className="mt-2 text-[12px] text-[#8f7d77]">
              {t("seller.mediaWarning")}
            </p>
            <div className="mt-5">
              <MediaManager productId={mediaProduct.id} />
            </div>
          </div>
        </div>
      )}

      {modalProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("seller.featureDialog")}
          className="fixed inset-0 z-[90] grid place-items-center bg-black/75 px-4"
          onClick={() => setModalProduct(null)}
        >
          <div className="dash-card w-full max-w-md p-6" onClick={(event) => event.stopPropagation()}>
            <p className="text-[13px] text-[#b8a6a1]">{t("seller.featureKicker")}</p>
            <h3 className="mt-1 text-[18px] font-semibold text-white">{modalProduct.title}</h3>
            <p className="mt-1 text-[12px] text-[#8f7d77]">{t("seller.perDay", { rate: formatXof(rate) })}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#8f7d77]">{t("seller.autoNote")}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {DAY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDays(preset)}
                  className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${
                    days === preset
                      ? "border-[rgba(255,106,50,0.6)] bg-[rgba(232,71,36,0.15)] text-white"
                      : "border-[rgba(255,236,229,0.1)] text-[#b8a6a1] hover:text-white"
                  }`}
                >
                  {t(preset > 1 ? "seller.dayMany" : "seller.dayOne", { n: preset })} · {formatXof(rate * preset)}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[12px] text-[#b8a6a1]" htmlFor="featured-days">
              {t("seller.duration")}
            </label>
            <input
              id="featured-days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(event) => setDays(Math.max(1, Math.min(90, Number(event.target.value) || 1)))}
              className="dash-input mt-1.5 !pl-4"
            />

            <div className="mt-5 flex items-center justify-between rounded-2xl border border-[rgba(255,236,229,0.08)] px-4 py-3">
              <span className="text-[12px] text-[#b8a6a1]">
                {formatXof(rate)} × {t(days > 1 ? "seller.dayMany" : "seller.dayOne", { n: days })}
              </span>
              <span className="text-[18px] font-semibold tabular-nums text-white">{formatXof(amount)}</span>
            </div>

            <p className="mt-3 text-[12px] text-[#8f7d77]">
              {t("seller.balanceLine")}<span className="tabular-nums text-stone-200">{formatXof(available)}</span>
              {insufficient && <span className="ms-1 text-[#fcd9a5]">{t("seller.insufficient")}</span>}
            </p>

            {error && (
              <div className="mt-4">
                <Alert tone="danger">{error}</Alert>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="dash-btn dash-btn-primary flex-1"
                disabled={!daysValid || paying !== null || insufficient}
                onClick={() => void pay("BALANCE")}
              >
                {paying === "BALANCE" ? t("seller.paying") : t("seller.payBalance")}
              </button>
              <button
                type="button"
                className="dash-btn dash-btn-ghost flex-1"
                disabled={!daysValid || paying !== null}
                onClick={() => void pay("WAVE")}
              >
                {paying === "WAVE" ? t("seller.redirecting") : t("seller.payOnline")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setModalProduct(null)}
              className="mt-3 w-full text-center text-[12px] text-[#8f7d77] transition hover:text-white"
            >
              {t("seller.cancel")}
            </button>
          </div>
        </div>
      )}
    </DashShell>
  );
}
