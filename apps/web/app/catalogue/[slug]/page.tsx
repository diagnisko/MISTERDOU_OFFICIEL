"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
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
import { divisionTier, formatFcfa, formatInt } from "@/lib/lux";
import { ApiClientError, request } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { createOrder } from "@/lib/orders";
import { SellerChatBox } from "@/components/chat/seller-chat-box";
import { SellerBadge, SellerChip, toCardSeller } from "@/components/lux/lux-seller-badge";
import { useT, type MessageKey } from "@/lib/i18n";

// Un vendeur qui ouvre sa propre offre : pas d'achat ni de discussion avec lui-même.
function useOwnOffer(productId: string | undefined): boolean {
  const account = useAccount();
  const seller = account.status === "member" && account.profile.isSeller;
  const [own, setOwn] = useState(false);
  useEffect(() => {
    if (!seller || !productId) return setOwn(false);
    let alive = true;
    request<{ own: boolean }>(`/api/v1/seller/owns/${productId}`)
      .then((res) => alive && setOwn(res.own))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [seller, productId]);
  return own;
}

// L'équipe consulte la boutique sans acheter.
function useIsTeam(): boolean {
  const account = useAccount();
  return account.status === "member" && (account.user.role === "ADMIN" || account.user.role === "STAFF");
}

function TeamNotice() {
  const t = useT();
  return (
    <p className="mt-2 rounded-[18px] border border-white/10 bg-white/[0.03] p-4 text-[13px] text-stone-400">{t("product.teamNoBuy")}</p>
  );
}

function OwnOfferNotice() {
  const t = useT();
  return (
    <div className="mt-2 rounded-[18px] border border-[rgba(255,106,50,0.3)] bg-[rgba(255,106,50,0.06)] p-4">
      <p className="text-[13.5px] font-semibold text-stone-100">{t("product.ownTitle")}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-stone-400">{t("product.ownBody")}</p>
      <Link href="/seller" className="mt-3 inline-block text-[12.5px] text-[var(--lux-gold-light)] underline-offset-2 hover:underline">
        {t("menu.seller")}
      </Link>
    </div>
  );
}

function BuyButton({
  productId,
  paymentMode,
}: {
  productId: string;
  paymentMode: "ONE_TIME" | "INSTALLMENTS";
}) {
  const t = useT();
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
        setMessage(t("product.loginToBuy"));
        return;
      }
      setState("error");
      setMessage(err instanceof Error ? err.message : t("product.buyFailed"));
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
          ? t("product.preparing")
          : split
            ? t("product.startMonthly")
            : t("product.buy")}
        <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-1" aria-hidden />
      </button>
      {message && (
        <p className="mt-3 text-[12px] text-stone-400">
          {state === "needLogin" && (
            <>
              <Link href="/login" className="text-[var(--lux-gold-light)] underline underline-offset-2">
                {t("product.login")}
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

// Galerie publique : média principal (image ou vidéo) + vignettes.
function Gallery({
  media,
  title,
  badges,
}: {
  media: NonNullable<CatalogueDetail["media"]>;
  title: string;
  badges: React.ReactNode;
}) {
  const t = useT();
  const [active, setActive] = useState(0);
  // Proportions de l'image affichée (largeur / hauteur), lues à son chargement.
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const current = media[Math.min(active, media.length - 1)]!;
  const imageCount = media.filter((m) => m.kind === "image").length;
  // Le cadre épouse l'image (bornée entre 4:5 et 21:10) : rien n'est rogné ; s'il
  // reste de la place, la même image floutée la comble au lieu de bandes noires.
  const ratio = current.kind === "image" && ratios[current.id] ? Math.min(2.1, Math.max(0.8, ratios[current.id]!)) : 16 / 10;
  const remember = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth && !ratios[current.id]) {
      setRatios((r) => ({ ...r, [current.id]: img.naturalWidth / img.naturalHeight }));
    }
  };
  return (
    <div>
      <div
        className="relative overflow-hidden rounded-[28px] border border-[var(--lux-line)] bg-black transition-[aspect-ratio] duration-500"
        style={{ aspectRatio: String(ratio), maxHeight: "72vh" }}
      >
        {current.kind === "video" ? (
          <video key={current.id} src={current.url} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain">
            {t("product.noVideo")}
          </video>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- fond décoratif, même image */}
            <img src={current.url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element -- bucket public R2, domaine configurable */}
            <img
              key={current.id}
              ref={remember}
              src={current.url}
              alt={t("product.capture", { title, n: media.filter((m) => m.kind === "image").indexOf(current) + 1, total: imageCount })}
              onLoad={(e) => remember(e.currentTarget)}
              className="relative h-full w-full object-contain"
            />
          </>
        )}
        {current.kind === "image" && badges}
      </div>
      {media.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={t("product.media")}>
          {media.map((m, i) => (
            <li key={m.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={m.kind === "video" ? t("product.playVideo", { n: i + 1 }) : t("product.showCapture", { n: i + 1 })}
                aria-pressed={i === active}
                className={cx(
                  "relative block h-16 w-24 overflow-hidden rounded-xl border transition",
                  i === active ? "border-[#ff6a32]" : "border-[var(--lux-line)] opacity-70 hover:opacity-100",
                )}
              >
                {m.kind === "video" ? (
                  <span className="grid h-full w-full place-items-center bg-[#120908] text-white">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </button>
            </li>
          ))}
        </ul>
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
  const t = useT();
  const params = useParams<{ slug: string }>();
  const slug = params.slug as string;
  const installmentsMode = useSearchParams().get("mode") === "mensualites";
  const [item, setItem] = useState<CatalogueDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const own = useOwnOffer(item?.id);
  const team = useIsTeam();

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
            <SectionLabel>{t("product.notFound")}</SectionLabel>
            <p className="mt-4 text-[14px] text-stone-400">
              {t("product.notFoundBody")}
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/catalogue" className="lux-btn lux-btn-gold whitespace-nowrap px-6" style={{ borderRadius: 16 }}>
                {t("product.backToCatalogue")}
              </Link>
              <button type="button" onClick={() => setAttempt((a) => a + 1)} className="lux-btn lux-btn-ghost" style={{ borderRadius: 16 }}>
                {t("product.retry")}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!item) return null;

  // Règle : depuis « Offres », achat comptant ; les tranches ne se prennent
  // que depuis la page des mensualités (?mode=mensualites).
  const canSplit = item.paymentMode === "INSTALLMENTS";
  const split = canSplit && installmentsMode;
  const tier = divisionTier(item.division);
  const glow = TIER_GLOW[tier] ?? TIER_GLOW.bronze;
  const isPromo = item.promoPrice !== null && item.promoPrice < item.price;

  return (
    <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
      <div className="mx-auto max-w-5xl">
        {/* Fil d'Ariane */}
        <nav aria-label={t("product.breadcrumb")} className="mb-8 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-400">
          <Link href="/" className="transition-colors hover:text-stone-200">
            {t("product.home")}
          </Link>
          <span aria-hidden>/</span>
          <Link href="/catalogue" className="transition-colors hover:text-stone-200">
            {t("product.catalogue")}
          </Link>
          <span aria-hidden>/</span>
          <span className="text-stone-300">{item.title}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          {item.media && item.media.length > 0 ? (
            <Gallery media={item.media} title={item.title} badges={<>
                <SellerChip seller={toCardSeller(item.seller)} className="left-5 top-5" />
                {item.isFeatured && (
                  <span className="pointer-events-none absolute right-5 top-5 flex items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#1a0503] shadow-lg">
                    <IconSparkle className="h-3 w-3" aria-hidden />
                    Mis en avant
                  </span>
                )}
              </>} />
          ) : (
            <>
            <div
              className="relative flex min-h-[320px] items-end justify-between overflow-hidden rounded-[28px] p-7"
              style={{
                background: `radial-gradient(120% 100% at 70% 0%, ${glow}, transparent 56%), radial-gradient(150% 120% at 18% 100%, rgba(232,71,36,0.1), transparent 58%), linear-gradient(180deg, var(--lux-surface-2), var(--lux-surface))`,
              }}
            >
              <SellerChip seller={toCardSeller(item.seller)} className="left-5 top-5" />
              {item.isFeatured && (
                <span className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#1a0503] shadow-lg">
                  <IconSparkle className="h-3 w-3" aria-hidden />
                  Mis en avant
                </span>
              )}

              <div className="flex flex-col gap-1">
                <span className="lux-serif text-[76px] font-bold leading-none text-stone-50">{formatInt(item.teamPower)}</span>
                <span className="text-[11px] uppercase tracking-[0.32em] text-stone-400">{t("product.power")}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 text-[13px] text-stone-300">
                <IconCoins className="h-6 w-6 text-[var(--lux-gold-light)]" aria-hidden />
                <span className="lux-serif text-[20px] font-bold text-stone-100 tabular-nums">{formatInt(item.coins)}</span>
                <span className="text-[9px] uppercase tracking-[0.3em] text-stone-400">{t("product.coins")}</span>
              </div>
            </div>

            </>
          )}

          {/* Infos */}
          <div className="flex flex-col gap-5">
            <div>
              <SectionLabel>{t("product.account", { tier: t(`tier.${tier}` as MessageKey) })}</SectionLabel>
              <h1 className="lux-serif mt-3 text-[34px] font-bold leading-tight text-stone-50 md:text-[40px]">{item.title}</h1>
              {typeof item.avgRating === "number" && item.reviewCount > 0 && (
                <span className="mt-3 flex items-center gap-2 text-[12px] text-stone-400">
                  <span className="flex gap-0.5 text-[var(--lux-gold)]" aria-hidden>
                    {Array.from({ length: 5 }).map((_, s) => (
                      <IconStar key={s} filled={s < Math.round(item.avgRating!)} className="h-3.5 w-3.5" />
                    ))}
                  </span>
                  <span className="tabular-nums">
                    {t("product.reviews", { rating: (item.avgRating ?? 0).toFixed(1).replace(".", ","), count: item.reviewCount })}
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
              {split && item.installmentMonths ? t("product.payMonthly", { months: item.installmentMonths }) : t("product.payCash")}
            </span>
            {split && item.installmentDownPayment !== null && (
              <p className="text-[13px] leading-relaxed text-stone-400">
                {t("product.downPayment", {
                  down: formatFcfa(item.installmentDownPayment),
                  monthly: formatFcfa(Math.round((item.price - item.installmentDownPayment) / Math.max(1, item.installmentMonths ?? 1))),
                  months: item.installmentMonths ?? 0,
                })}
              </p>
            )}

            <p className="text-[14px] leading-relaxed text-stone-400">{item.description || t("product.noDescription")}</p>

            {item.seller && <SellerBadge seller={item.seller} rating={item.avgRating} reviewCount={item.reviewCount} />}

            {team ? <TeamNotice /> : own ? <OwnOfferNotice /> : <BuyButton productId={item.id} paymentMode={split ? "INSTALLMENTS" : "ONE_TIME"} />}
            {!own && canSplit && !split && (
              <Link href={`/catalogue/${item.slug}?mode=mensualites`} className="text-[12.5px] text-[var(--lux-gold-light)] underline-offset-2 hover:underline">
                {t("product.alsoMonthly")}
              </Link>
            )}
            {split && (
              <Link href={`/catalogue/${item.slug}`} className="text-[12.5px] text-stone-400 underline-offset-2 hover:underline">
                {t("product.preferCash")}
              </Link>
            )}
            {!own && !team && <SellerChatBox productId={item.id} slug={item.slug} />}
            {split && (
              <p className="flex items-center gap-2 text-[11px] text-stone-400">
                <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
                {t("product.deliveredAfter")}
              </p>
            )}
            <p className="flex items-center gap-2 text-[11px] text-stone-400">
              <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
              {t("product.finalize")}
            </p>
            {!own && !team && (
              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[#f5d9a8]">
                <IconShield className="mt-px h-4 w-4 shrink-0 text-[#fbbf24]" aria-hidden />
                {t("product.offsite")}
              </p>
            )}
          </div>
        </div>

        {/* Parcours : Détails publics */}
        {item.extraInfo && (
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <div className="lux-glass rounded-[24px] p-7">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.22em] text-stone-300">{t("product.highlights")}</h2>
              <p className="mt-4 text-[14px] leading-relaxed text-stone-400">{item.extraInfo}</p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Stat label={t("product.division")} value={item.division} />
                <Stat label={t("product.promo")} value={isPromo ? t("product.promoActive") : t("product.promoNone")} />
              </div>
              <p className="text-[12px] leading-relaxed text-stone-400">
                {t("product.priceNote")}
              </p>
            </div>
          </div>
        )}

        <div className="mt-12">
          <Link href="/catalogue" className="lux-btn lux-btn-ghost" style={{ borderRadius: 16 }}>
            <IconArrowLeft className="h-4 w-4" aria-hidden />
            {t("product.allCatalogue")}
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
        <Suspense>
          <DetailHub />
        </Suspense>
        <div className="mt-8">
          <LuxFooter />
        </div>
        <LuxPerfLed />
      </div>
    </LuxProvider>
  );
}