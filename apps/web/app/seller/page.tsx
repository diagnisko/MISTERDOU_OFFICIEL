"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, request, formatXof } from "@/lib/api";
import { Alert, Spinner, StatusBadge } from "@/components/ui";
import { MediaManager } from "@/components/media/media-manager";
import { AreaChart, DashHeading, DashShell, KpiCard, Panel, type DashNavItem } from "@/components/dash/dash-ui";
import {
  IconChat,
  IconClock,
  IconCoins,
  IconHome,
  IconLifebuoy,
  IconList,
  IconPercent,
  IconStore,
  IconUsers,
  IconWallet,
} from "@/components/dash/dash-icons";

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
  }[];
  dailyRate: number;
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
  amount: number;
  days: number;
  dailyRate: number;
  token: string | null;
  featuredUntil: string | null;
  checkoutUrl: string | null;
};

const DAY_PRESETS = [1, 5, 10, 30];

const SELLER_NAV: DashNavItem[] = [
  { href: "/seller", label: "Vue d’ensemble", icon: IconHome },
  { href: "/catalogue", label: "Catalogue public", icon: IconStore },
  { href: "/account", label: "Mon compte", icon: IconUsers },
  { href: "/messages", label: "Messages", icon: IconChat, group: "Relation" },
  { href: "/notifications", label: "Notifications", icon: IconList, group: "Relation" },
  { href: "/support", label: "Support", icon: IconLifebuoy, group: "Relation" },
];

export default function SellerPage() {
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [modalProduct, setModalProduct] = useState<Dashboard["products"][number] | null>(null);
  const [days, setDays] = useState(1);
  const [paying, setPaying] = useState<"BALANCE" | "PAYTECH" | null>(null);
  const [mediaProduct, setMediaProduct] = useState<Dashboard["products"][number] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await request<Dashboard>("/api/v1/seller/dashboard");
      setDash(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")) {
        router.replace("/login");
      } else {
        setError(err instanceof ApiClientError ? err.message : "Impossible de charger votre espace vendeur.");
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
    setDays(1);
    setModalProduct(product);
    setNotice(null);
    setError(null);
  }

  async function pay(method: "BALANCE" | "PAYTECH") {
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
          `Mise en avant activée pendant ${result.days} jour${result.days > 1 ? "s" : ""} — ${formatXof(result.amount)} débités du solde${result.featuredUntil ? `, jusqu’au ${new Date(result.featuredUntil).toLocaleDateString("fr-FR")}` : ""}.`,
        );
        setModalProduct(null);
        await load();
        return;
      }
      if (result.checkoutUrl) {
        router.push(result.checkoutUrl);
        return;
      }
      setError("Réponse de paiement incomplète, réessayez.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Paiement impossible pour le moment.");
    } finally {
      setPaying(null);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } finally {
      router.replace("/");
    }
  }

  const rate = dash?.dailyRate ?? 0;
  const amount = rate * days;
  const available = dash?.balance?.balanceAvailable ?? 0;
  const insufficient = available < amount;
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 90;
  const name = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Vendeur";
  const salesChart = (dash?.salesByMonth ?? []).map((m) => {
    const [y, mo] = m.month.split("-").map(Number);
    return {
      label: new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" }).replace(".", ""),
      primary: m.net,
    };
  });

  if (loading) {
    return (
      <div data-lux className="dash-root grid place-items-center text-sm text-[#b8a6a1]">
        <span className="flex items-center gap-3">
          <Spinner /> Ouverture de l’espace vendeur…
        </span>
      </div>
    );
  }

  return (
    <DashShell
      nav={SELLER_NAV}
      areaLabel="Espace vendeur"
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
        greeting={me?.firstName ? `Bonjour ${me.firstName}` : "Espace vendeur"}
        title="Vos ventes"
        actions={
          <Link href="/catalogue" className="dash-btn dash-btn-ghost">
            Voir le catalogue
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
            Aucun profil vendeur n’est associé à ce compte. La demande d’activation vendeur se fait auprès de
            l’équipe MISTERDOU.
          </Alert>
        </div>
      )}

      <section aria-label="Soldes" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          hero
          icon={IconWallet}
          label="Solde disponible"
          value={formatXof(dash?.balance?.balanceAvailable ?? 0)}
          hint="Retirable ou utilisable pour la mise en avant"
        />
        <KpiCard
          icon={IconClock}
          label="En attente de libération"
          value={formatXof(dash?.balance?.balancePending ?? 0)}
          hint="Ventes récentes en période de sécurité"
        />
        <KpiCard
          icon={IconCoins}
          label="Gains cumulés"
          value={formatXof(dash?.balance?.totalEarnings ?? 0)}
          hint="Net vendeur depuis l’ouverture"
        />
        <KpiCard
          icon={IconPercent}
          label="Commissions versées"
          value={formatXof(dash?.balance?.totalCommissionPaid ?? 0)}
          hint="Part de la plateforme sur vos ventes"
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Panel title="Gains nets sur 6 mois">
          <AreaChart data={salesChart} primaryLabel="Gains nets" format={formatXof} />
        </Panel>
        <Panel title="Ventes récentes">
          {(dash?.recentSales.length ?? 0) === 0 ? (
            <p className="text-[13px] text-[#8f7d77]">Vos ventes apparaîtront ici dès le premier paiement confirmé.</p>
          ) : (
            <ul className="space-y-1">
              {dash!.recentSales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-white">{sale.title}</p>
                    <p className="text-[11px] text-[#8f7d77]">
                      {new Date(sale.createdAt).toLocaleDateString("fr-FR")} · commission {formatXof(sale.commissionAmount)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-white">+{formatXof(sale.netToSeller)}</p>
                    <span className={`dash-pill mt-1 ${sale.status === "RELEASED" ? "dash-pill-paid" : "dash-pill-due"}`}>
                      {sale.status === "RELEASED" ? "Disponible" : "En attente"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="dash-card mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-stone-100">Mes offres</h2>
            <p className="mt-0.5 text-[12px] text-[#8f7d77]">
              Mise en avant à {formatXof(rate)} par jour, payable depuis votre solde ou en ligne.
            </p>
          </div>
          <span className="text-[12px] text-[#8f7d77]">
            {dash?.products.length ?? 0} offre{(dash?.products.length ?? 0) > 1 ? "s" : ""}
          </span>
        </div>
        <div className="-mx-5 mt-3 overflow-x-auto">
          <table className="dash-table w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                <th className="pl-5">Compte</th>
                <th>Prix</th>
                <th>État</th>
                <th>Mise en avant</th>
                <th className="pr-5">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(dash?.products.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="pl-5 text-[#8f7d77]">
                    Aucune offre publiée pour le moment.
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
                      {product.paymentMode === "INSTALLMENTS" ? "Échéancier" : "Paiement unique"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatXof(product.basePrice)}</td>
                  <td>
                    <StatusBadge status={product.status} />
                  </td>
                  <td>
                    {product.isFeatured ? (
                      <span className="dash-pill dash-pill-paid">
                        Jusqu’au {product.featuredUntil ? new Date(product.featuredUntil).toLocaleDateString("fr-FR") : "—"}
                      </span>
                    ) : (
                      <span className="dash-pill dash-pill-none">Non</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap pr-5 text-right">
                    <button
                      type="button"
                      onClick={() => setMediaProduct(product)}
                      className="dash-btn dash-btn-ghost mr-2 !min-h-[34px] !text-[12px]"
                    >
                      Médias
                    </button>
                    <button
                      type="button"
                      onClick={() => openFeatured(product)}
                      className="dash-btn dash-btn-ghost !min-h-[34px] !text-[12px]"
                    >
                      {product.isFeatured ? "Prolonger" : "Mettre en avant"}
                    </button>
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
          aria-label={`Médias de l’offre ${mediaProduct.title}`}
          className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/75 p-4"
          onClick={() => setMediaProduct(null)}
        >
          <div className="dash-card my-auto w-full max-w-2xl p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] text-[#b8a6a1]">Captures et vidéos publiques</p>
                <h3 className="mt-1 text-[18px] font-semibold text-white">{mediaProduct.title}</h3>
              </div>
              <button type="button" onClick={() => setMediaProduct(null)} aria-label="Fermer" className="dash-btn dash-btn-ghost dash-btn-round !min-h-[34px] !w-[34px]">
                ✕
              </button>
            </div>
            <p className="mt-2 text-[12px] text-[#8f7d77]">
              Visibles par tous sur la fiche du compte. N’y montrez jamais l’e-mail ou le mot de passe du compte.
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
          aria-label="Mettre en avant une offre"
          className="fixed inset-0 z-[90] grid place-items-center bg-black/75 px-4"
          onClick={() => setModalProduct(null)}
        >
          <div className="dash-card w-full max-w-md p-6" onClick={(event) => event.stopPropagation()}>
            <p className="text-[13px] text-[#b8a6a1]">Mise en avant</p>
            <h3 className="mt-1 text-[18px] font-semibold text-white">{modalProduct.title}</h3>
            <p className="mt-1 text-[12px] text-[#8f7d77]">{formatXof(rate)} par jour · durée 1 à 90 jours</p>

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
                  {preset} jour{preset > 1 ? "s" : ""}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[12px] text-[#b8a6a1]" htmlFor="featured-days">
              Durée (jours)
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
                {formatXof(rate)} × {days} jour{days > 1 ? "s" : ""}
              </span>
              <span className="text-[18px] font-semibold tabular-nums text-white">{formatXof(amount)}</span>
            </div>

            <p className="mt-3 text-[12px] text-[#8f7d77]">
              Solde disponible : <span className="tabular-nums text-stone-200">{formatXof(available)}</span>
              {insufficient && <span className="ml-1 text-[#fcd9a5]">— insuffisant, payez en ligne</span>}
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
                {paying === "BALANCE" ? "Paiement…" : "Payer avec mon solde"}
              </button>
              <button
                type="button"
                className="dash-btn dash-btn-ghost flex-1"
                disabled={!daysValid || paying !== null}
                onClick={() => void pay("PAYTECH")}
              >
                {paying === "PAYTECH" ? "Redirection…" : "Payer en ligne"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setModalProduct(null)}
              className="mt-3 w-full text-center text-[12px] text-[#8f7d77] transition hover:text-white"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </DashShell>
  );
}
