"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { SectionLabel } from "@/components/lux/lux-fx";
import { cx } from "@/components/lux/lux-fx";
import { fetchCatalogueDetail, type CatalogueDetail } from "@/lib/lux-catalogue";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCoins,
  IconDiamond,
  IconShield,
  IconSparkle,
  IconStar,
} from "@/components/lux/lux-icons";
import { divisionTier, formatFcfa, formatInt, tierLabel, tierTileClass } from "@/lib/lux";
import { ApiClientError } from "@/lib/api";
import { createOrder } from "@/lib/orders";

function BuyButton({
  productId,
  paymentMode,
}: {
  productId: string;
  paymentMode: "ONE_TIME" | "INSTALLMENTS";
}) {
  const [state, setState] = useState<"idle" | "busy" | "needLogin" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const split = paymentMode === "INSTALLMENTS";

  async function buy() {
    setState("busy");
    setMessage(null);
    try {
      const order = await createOrder(productId, paymentMode);
      window.location.assign(`/checkout/${order.token}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "UNAUTHORIZED") {
        setState("needLogin");
        setMessage("Connectez-vous pour finaliser votre achat.");
        return;
      }
      setState("error");
      setMessage(err instanceof Error ? err.message : "Achat impossible pour le moment");
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={buy}
        disabled={state === "busy"}
        className="lux-btn lux-btn-gold group/btn w-full !min-h-[52px] text-[13px] uppercase tracking-[0.14em] disabled:opacity-60"
        style={{ borderRadius: 18 }}
      >
        {state === "busy"
          ? "Préparation de la commande…"
          : split
            ? "Démarrer le paiement en plusieurs fois"
            : "Acheter sur l'espace sécurisé"}
        <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" aria-hidden />
      </button>
      {message && (
        <p className="mt-3 text-[12px] text-stone-400">
          {state === "needLogin" && (
            <>
              <Link href="/login" className="text-[var(--lux-gold-light)] underline underline-offset-2">
                Se connecter
              </Link>{" "}
              — {message}
            </>
          )}
          {state === "error" && message}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lux-glass flex flex-col gap-1.5 rounded-[18px] px-5 py-4">
      <span className="text-[9px] uppercase tracking-[0.26em] text-stone-400">{label}</span>
      <span className="lux-serif text-[26px] font-bold text-stone-100 tabular-nums">{value}</span>
    </div>
  );
}

const TIER_GLOW: Record<string, string> = {
  gold: "rgba(232,71,36,0.34)",
  platinum: "rgba(229,228,226,0.26)",
  silver: "rgba(192,192,192,0.24)",
  bronze: "rgba(205,127,50,0.28)",
};

function DetailHub() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug as string;
  const [item, setItem] = useState<CatalogueDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setStatus("loading");
    fetchCatalogueDetail(slug)
      .then((d) => {
        if (requestId.current !== id) return;
        setItem(d);
        setStatus("ready");
      })
      .catch(() => {
        if (requestId.current !== id) return;
        setStatus("error");
      });
  }, [slug, attempt]);

  if (status === "loading") {
    return (
      <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
        <div className="mx-auto max-w-5xl">
          <div className="lux-skeleton h-56 w-full rounded-[28px]" aria-hidden />
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="lux-skeleton h-24 rounded-[18px]" aria-hidden />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
        <div className="mx-auto max-w-5xl">
          <div className="lux-glass rounded-[24px] p-12 text-center">
            <SectionLabel>Introuvable</SectionLabel>
            <p className="mt-4 text-[14px] text-stone-400">
              Ce compte n&apos;existe pas, n&apos;est plus en ligne, ou le réseau a failli.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Link href="/catalogue" className="lux-btn lux-btn-gold px-6" style={{ borderRadius: 16 }}>
                Revenir au catalogue
              </Link>
              <button type="button" onClick={() => setAttempt((a) => a + 1)} className="lux-btn lux-btn-ghost" style={{ borderRadius: 16 }}>
                Réessayer
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!item) return null;

  const tier = divisionTier(item.division);
  const glow = TIER_GLOW[tier] ?? TIER_GLOW.bronze;
  const isPromo = item.promoPrice !== null && item.promoPrice < item.price;

  return (
    <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
      <div className="mx-auto max-w-5xl">
        {/* Fil d'Ariane */}
        <nav aria-label="Fil d'Ariane" className="mb-8 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-400">
          <Link href="/" className="transition-colors hover:text-stone-200">
            Accueil
          </Link>
          <span aria-hidden>/</span>
          <Link href="/catalogue" className="transition-colors hover:text-stone-200">
            Catalogue
          </Link>
          <span aria-hidden>/</span>
          <span className="text-stone-300">{item.title}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          {/* Visuel */}
          <div
            className="relative flex min-h-[320px] items-end justify-between overflow-hidden rounded-[28px] p-7"
            style={{
              background: `radial-gradient(120% 100% at 70% 0%, ${glow}, transparent 56%), radial-gradient(150% 120% at 18% 100%, rgba(232,71,36,0.1), transparent 58%), linear-gradient(180deg, var(--lux-surface-2), var(--lux-surface))`,
            }}
          >
            <span className="lux-glass-chip absolute left-5 top-5 flex items-center gap-2 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-stone-300">
              <span className={cx("lux-div-tile", tierTileClass(tier))} aria-hidden />
              {tierLabel(tier)}
            </span>
            {item.isFeatured && (
              <span className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#1a0503] shadow-lg">
                <IconSparkle className="h-3 w-3" aria-hidden />
                Mis en avant
              </span>
            )}

            <div className="flex flex-col gap-1">
              <span className="lux-serif text-[76px] font-bold leading-none text-stone-50">{formatInt(item.teamPower)}</span>
              <span className="text-[11px] uppercase tracking-[0.32em] text-stone-400">OVR — puissance</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-[13px] text-stone-300">
              <IconCoins className="h-6 w-6 text-[var(--lux-gold-light)]" aria-hidden />
              <span className="lux-serif text-[20px] font-bold text-stone-100 tabular-nums">{formatInt(item.coins)}</span>
              <span className="text-[9px] uppercase tracking-[0.3em] text-stone-400">Coins</span>
            </div>
          </div>

          {/* Infos */}
          <div className="flex flex-col gap-5">
            <div>
              <SectionLabel>Compte {tierLabel(tier)}</SectionLabel>
              <h1 className="lux-serif mt-3 text-[34px] font-bold leading-tight text-stone-50 md:text-[40px]">{item.title}</h1>
              {typeof item.avgRating === "number" && item.reviewCount > 0 && (
                <span className="mt-3 flex items-center gap-2 text-[12px] text-stone-400">
                  <span className="flex gap-0.5 text-[var(--lux-gold)]" aria-hidden>
                    {Array.from({ length: 5 }).map((_, s) => (
                      <IconStar key={s} filled={s < Math.round(item.avgRating!)} className="h-3.5 w-3.5" />
                    ))}
                  </span>
                  <span className="tabular-nums">
                    {(item.avgRating ?? 0).toFixed(1).replace(".", ",")}/5 · {item.reviewCount} avis
                  </span>
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-4">
              {isPromo ? (
                <>
                  <span className="text-[16px] text-stone-400 line-through decoration-stone-600">{formatFcfa(item.price)}</span>
                  <span className="lux-serif text-[36px] font-bold text-[var(--lux-gold-light)] tabular-nums">
                    {formatFcfa(item.promoPrice!)}
                  </span>
                </>
              ) : (
                <span className="lux-serif text-[36px] font-bold text-stone-100 tabular-nums">{formatFcfa(item.price)}</span>
              )}
            </div>

            <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-stone-400">
              <IconDiamond className="h-3.5 w-3.5 text-[var(--lux-gold)]" aria-hidden />
              {item.paymentMode === "INSTALLMENTS" && item.installmentMonths
                ? `Comptant ou paiement en ${item.installmentMonths} parts`
                : "Paiement comptant"}
            </span>
            {item.paymentMode === "INSTALLMENTS" && item.installmentDownPayment !== null && (
              <p className="text-[13px] leading-relaxed text-stone-400">
                Entrée <span className="text-stone-200 tabular-nums">{formatFcfa(item.installmentDownPayment)}</span>, puis{" "}
                <span className="text-stone-200 tabular-nums">
                  {formatFcfa(Math.round((item.price - item.installmentDownPayment) / Math.max(1, item.installmentMonths ?? 1)))}
                </span>{" "}
                /mois sur {item.installmentMonths} mois, sous réserve d&apos;éligibilité.
              </p>
            )}

            <p className="text-[14px] leading-relaxed text-stone-400">{item.description || "Fiche détaillée disponible sur l'espace acheteur."}</p>

            <BuyButton productId={item.id} paymentMode={item.paymentMode === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME"} />
            {item.paymentMode === "INSTALLMENTS" && (
              <p className="flex items-center gap-2 text-[11px] text-stone-400">
                <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
                L&apos;accès au compte est livré après solde complet de l&apos;échéancier — suivi depuis « Mon espace ».
              </p>
            )}
            <p className="flex items-center gap-2 text-[11px] text-stone-400">
              <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
              La transaction se finalise dans votre espace, après connexion et vérification.
            </p>
          </div>
        </div>

        {/* Parcours : Détails publics */}
        {item.extraInfo && (
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <div className="lux-glass rounded-[24px] p-7">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.22em] text-stone-300">Points forts</h2>
              <p className="mt-4 text-[14px] leading-relaxed text-stone-400">{item.extraInfo}</p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Division" value={item.division} />
                <Stat label="Promo" value={isPromo ? "Active" : "Aucune"} />
              </div>
              <p className="text-[12px] leading-relaxed text-stone-400">
                Prix effectif servi par le serveur — les codes de promotion et le paiement en plusieurs
                fois sont validés à la commande, jamais affichés localement.
              </p>
            </div>
          </div>
        )}

        <div className="mt-12">
          <Link href="/catalogue" className="lux-btn lux-btn-ghost" style={{ borderRadius: 16 }}>
            <IconArrowLeft className="h-4 w-4" aria-hidden />
            Tout le catalogue
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function CatalogueDetailPage() {
  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        <LuxNav root />
        <DetailHub />
        <div className="mt-8">
          <LuxFooter />
        </div>
        <LuxPerfLed />
      </div>
    </LuxProvider>
  );
}