"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, request, formatXof } from "@/lib/api";
import { Alert, Button, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { LuxProvider } from "@/components/lux/lux-data";
import { LuxFooter } from "@/components/lux/lux-footer";

// ---------------------------------------------------------------------------
// Espace vendeur — §13 : acheter une mise en avant (200 FCFA/jour, tarif
// servi par l'API). Solde d'abord (R10) : paiement direct si le solde couvre
// le montant, sinon redirection checkout. Aucun montant calculé ici : le
// total affiché est dailyRate (API) × nombre de jours saisi, le serveur
// recalcule et facture.
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
};

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

export default function SellerPage() {
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [modalProduct, setModalProduct] = useState<Dashboard["products"][number] | null>(null);
  const [days, setDays] = useState(1);
  const [paying, setPaying] = useState<"BALANCE" | "PAYTECH" | null>(null);

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
          `Mise en avant activée pendant ${result.days} jour${result.days > 1 ? "s" : ""} — ${formatXof(result.amount)} débités du solde${result.featuredUntil ? `, jusqu'au ${new Date(result.featuredUntil).toLocaleDateString("fr-FR")}` : ""}.`,
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

  const rate = dash?.dailyRate ?? 0;
  const amount = rate * days;
  const available = dash?.balance?.balanceAvailable ?? 0;
  const insufficient = available < amount;
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 90;

  if (loading) {
    return (
      <LuxProvider>
        <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
          <div className="lux-bg" aria-hidden />
          <p className="relative z-10 grid min-h-[70vh] place-items-center text-[12px] uppercase tracking-[0.24em] text-stone-400">
            <span className="flex items-center gap-3">
              <Spinner className="h-4 w-4 text-[var(--lux-gold)]" /> Ouverture de l’espace vendeur…
            </span>
          </p>
        </div>
      </LuxProvider>
    );
  }

  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />

        <header className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.08)] bg-[#050303]/82 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 md:px-8">
            <Link href="/" className="lux-serif text-[22px] font-bold tracking-[0.02em] text-stone-50">
              MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
            </Link>
            <nav aria-label="Navigation espace vendeur" className="flex items-center gap-1 sm:gap-2">
              <NavLink href="/catalogue">Catalogue</NavLink>
              <NavLink href="/account">Mon espace</NavLink>
            </nav>
          </div>
        </header>

        <main className="relative z-10 px-5 pt-12 md:px-8 md:pt-16">
          <div className="mx-auto max-w-5xl">
            <p className="lux-kicker">Espace vendeur</p>
            <h1 className="mt-3 text-3xl sm:text-4xl">Vos offres &amp; visibilité</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-400">
              Mettez vos comptes en avant pour accroître leur visibilité — tarif journalier{" "}
              <span className="text-[var(--lux-gold-light)]">{formatXof(rate)}</span>, payable depuis votre solde
              ou en ligne.
            </p>

            {error && <div className="mt-5"><Alert tone="danger">{error}</Alert></div>}
            {notice && <div className="mt-5"><Alert tone="success">{notice}</Alert></div>}

            {!dash?.seller && (
              <div className="mt-6">
                <Alert tone="warning">
                  Aucun profil vendeur n’est associé à ce compte. La demande d’activation vendeur se fait auprès
                  de l’équipe MISTERDOU.
                </Alert>
              </div>
            )}

            <section aria-label="Soldes vendeur" className="mt-8 grid gap-3 sm:grid-cols-3">
              <Metric label="Solde disponible" value={formatXof(dash?.balance?.balanceAvailable ?? 0)} tone="gold" />
              <Metric label="En attente de libération" value={formatXof(dash?.balance?.balancePending ?? 0)} />
              <Metric label="Gains cumulés" value={formatXof(dash?.balance?.totalEarnings ?? 0)} tone="green" />
            </section>

            <section className="mt-10">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="lux-kicker">Mes offres</p>
                  <h2 className="mt-2 text-2xl text-stone-100">Comptes publiés</h2>
                </div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">
                  {dash?.products.length ?? 0} offre{(dash?.products.length ?? 0) > 1 ? "s" : ""}
                </p>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {(dash?.products ?? []).map((product) => (
                  <article key={product.id} className="lux-glass rounded-[20px] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg text-stone-100">{product.title}</h3>
                        <p className="mt-1 text-xs text-stone-500">
                          {formatXof(product.basePrice)} ·{" "}
                          {product.paymentMode === "INSTALLMENTS" ? "Échéancier" : "Paiement unique"}
                        </p>
                      </div>
                      <StatusBadge status={product.status} />
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                      <p className="text-xs">
                        {product.isFeatured ? (
                          <span className="text-[var(--lux-gold-light)]">
                            En avant jusqu’au{" "}
                            {product.featuredUntil
                              ? new Date(product.featuredUntil).toLocaleDateString("fr-FR")
                              : "expiration"}
                          </span>
                        ) : (
                          <span className="text-stone-500">Non mis en avant</span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => openFeatured(product)}
                        className="lux-btn lux-btn-ghost !min-h-[36px] !px-3 !text-[10px]"
                      >
                        {product.isFeatured ? "Prolonger" : "Mettre en avant"}
                      </button>
                    </div>
                  </article>
                ))}
                {(dash?.products.length ?? 0) === 0 && dash?.seller && (
                  <p className="rounded-[18px] border border-white/[0.08] bg-[#101825]/70 p-5 text-sm text-stone-400 sm:col-span-2">
                    Aucune offre publiée pour le moment.
                  </p>
                )}
              </div>
            </section>

            <section className="mt-10 rounded-[18px] border border-white/[0.08] bg-[#111927]/65 p-4 text-xs leading-relaxed text-stone-400">
              Après paiement confirmé, l’offre est mise en avant immédiatement ; la durée démarre à la fin de la
              mise en avant en cours et se désactive automatiquement à expiration.
            </section>
          </div>
        </main>

        <LuxFooter />

        {modalProduct && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Mettre en avant une offre"
            className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-4 backdrop-blur-sm"
            onClick={() => setModalProduct(null)}
          >
            <div
              className="lux-glass w-full max-w-md rounded-[22px] p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="lux-kicker">Mise en avant</p>
              <h3 className="mt-2 text-xl text-stone-100">{modalProduct.title}</h3>
              <p className="mt-1 text-xs text-stone-500">
                {formatXof(rate)} par jour · durée 1 à 90 jours
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {DAY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDays(preset)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                      days === preset
                        ? "border-amber-200/30 bg-amber-300/[0.12] text-[var(--lux-gold-light)]"
                        : "border-white/10 text-stone-400 hover:border-white/20 hover:text-stone-200"
                    }`}
                  >
                    {preset} jour{preset > 1 ? "s" : ""}
                  </button>
                ))}
              </div>

              <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                Durée (jours)
              </label>
              <TextInput
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(event) => setDays(Math.max(1, Math.min(90, Number(event.target.value) || 1)))}
                className="mt-2"
              />

              <div className="mt-5 flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/10 px-4 py-3">
                <span className="text-xs text-stone-400">
                  {formatXof(rate)} × {days} jour{days > 1 ? "s" : ""}
                </span>
                <span className="text-lg font-semibold tabular-nums text-[var(--lux-gold-light)]">
                  {formatXof(amount)}
                </span>
              </div>

              <p className="mt-3 text-xs text-stone-500">
                Solde disponible : <span className="tabular-nums text-stone-300">{formatXof(available)}</span>
                {insufficient && <span className="ml-1 text-amber-300">— solde insuffisant</span>}
              </p>

              {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1"
                  loading={paying === "BALANCE"}
                  disabled={!daysValid || paying !== null || insufficient}
                  onClick={() => void pay("BALANCE")}
                >
                  Payer par solde
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  loading={paying === "PAYTECH"}
                  disabled={!daysValid || paying !== null}
                  onClick={() => void pay("PAYTECH")}
                >
                  Payer en ligne
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setModalProduct(null)}
                className="mt-3 w-full text-center text-[11px] uppercase tracking-[0.14em] text-stone-500 transition hover:text-stone-300"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </LuxProvider>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-[rgba(255,255,255,0.12)] px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-300 transition-colors hover:border-[rgba(255,106,50,0.45)] hover:text-[var(--lux-gold-light)] sm:px-4"
    >
      {children}
    </Link>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "gold" | "green" }) {
  const color = tone === "gold" ? "text-[var(--lux-gold-light)]" : tone === "green" ? "text-emerald-300" : "text-stone-100";
  return (
    <div className="lux-glass rounded-[18px] p-4 sm:p-5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</p>
      <p className={`mt-3 text-xl font-semibold tabular-nums sm:text-2xl ${color}`}>{value}</p>
    </div>
  );
}
