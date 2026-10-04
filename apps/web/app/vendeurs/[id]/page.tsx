import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LuxPerfLed, LuxProvider } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { SectionLabel } from "@/components/lux/lux-fx";
import { ProductCard } from "@/components/lux/lux-product-card";
import { IconStar } from "@/components/lux/lux-icons";
import { SellerAvatar } from "@/components/lux/lux-seller-badge";
import { fetchCatalogueServer } from "@/lib/lux-catalogue";
import { serverApiFetch } from "@/lib/server-api";
import { formatInt } from "@/lib/lux";
import { getServerT } from "@/lib/i18n-server";

// ---------------------------------------------------------------------------
// Profil public d'un vendeur : prénom + initiale, photo, note, ventes,
// ancienneté, avis et offres en vente. Nom complet et contacts restent privés.
// ---------------------------------------------------------------------------

type SellerProfile = {
  id: string;
  code: string;
  name?: string;
  avatarUrl?: string | null;
  rating: number | null;
  reviewCount: number;
  sales: number;
  since: string | null;
  reviews: Array<{ rating: number; comment: string | null; createdAt: string; author: string }>;
};

async function fetchProfile(id: string): Promise<SellerProfile | null> {
  try {
    const res = await serverApiFetch(`/api/v1/sellers/${encodeURIComponent(id)}/profile`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = (await res.json()) as { ok: boolean; data?: SellerProfile };
    return payload.ok && payload.data ? payload.data : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await getServerT();
  const profile = await fetchProfile(id);
  return { title: profile ? (profile.name ?? t("sellerp.partner", { code: profile.code })) : t("sellerp.notFound") };
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5 text-[var(--lux-gold)]" aria-hidden>
      {Array.from({ length: 5 }).map((_, s) => (
        <IconStar key={s} filled={s < Math.round(rating)} className="h-3.5 w-3.5" />
      ))}
    </span>
  );
}

export default async function SellerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getServerT();
  const profile = await fetchProfile(id);
  if (!profile) notFound();

  let offers: Awaited<ReturnType<typeof fetchCatalogueServer>> | null = null;
  try {
    offers = await fetchCatalogueServer(serverApiFetch, { seller: profile.id, perPage: 24 });
  } catch {
    offers = null;
  }
  const since = profile.since ? new Date(profile.since).toLocaleDateString(t.intl, { month: "long", year: "numeric" }) : null;
  const stats = [
    { label: t("sellerp.statRating"), value: profile.rating !== null ? `${profile.rating.toFixed(1).replace(".", ",")}/5` : "—" },
    { label: t("sellerp.statReviews"), value: formatInt(profile.reviewCount) },
    { label: t("sellerp.statSales"), value: formatInt(profile.sales) },
    ...(since ? [{ label: t("sellerp.statSince"), value: since }] : []),
  ];

  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        <LuxNav />
        <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
          <div className="mx-auto max-w-6xl">
            <SectionLabel>{t("sellerp.kicker")}</SectionLabel>
            <div className="mt-6 flex items-center gap-4 sm:gap-5">
              <SellerAvatar name={profile.name ?? profile.code} avatarUrl={profile.avatarUrl} size={72} />
              <div className="min-w-0">
                <h1 className="lux-h2 truncate text-stone-100">{profile.name ?? t("sellerp.partner", { code: profile.code })}</h1>
                <p className="mt-1 text-[12px] uppercase tracking-[0.2em] text-stone-500">{t("sellerp.verified")}</p>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-stone-400">{t("sellerp.lead")}</p>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="lux-glass rounded-[20px] px-4 py-4 sm:px-5 sm:py-5">
                  <span className="text-[9px] uppercase tracking-[0.26em] text-stone-400">{s.label}</span>
                  <span className="lux-serif mt-1.5 block text-[20px] font-bold capitalize sm:mt-2 sm:text-[24px] text-stone-100 tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>

            <section className="mt-14">
              <SectionLabel>{t("sellerp.offers")}</SectionLabel>
              {offers && offers.items.length > 0 ? (
                <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {offers.items.map((p, i) => (
                    <ProductCard key={p.id} product={p} index={i} animateIn={false} />
                  ))}
                </div>
              ) : (
                <p className="mt-6 text-[14px] text-stone-400">{t("sellerp.noOffers")}</p>
              )}
            </section>

            <section className="mt-14">
              <SectionLabel>{t("sellerp.reviews")}</SectionLabel>
              {profile.reviews.length > 0 ? (
                <ul className="mt-6 grid gap-4 md:grid-cols-2">
                  {profile.reviews.map((r, i) => (
                    <li key={i} className="lux-glass rounded-[20px] p-5">
                      <div className="flex items-center justify-between gap-3">
                        <Stars rating={r.rating} />
                        <span className="text-[11.5px] text-stone-500">
                          {new Date(r.createdAt).toLocaleDateString(t.intl, { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      {r.comment && <p className="mt-3 text-[14px] leading-relaxed text-stone-300">« {r.comment} »</p>}
                      <p className="mt-3 text-[12px] text-stone-500">{r.author}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-6 text-[14px] text-stone-400">{t("sellerp.noReviews")}</p>
              )}
            </section>

            <div className="mt-12">
              <Link href="/offres" className="lux-btn lux-btn-ghost" style={{ borderRadius: 16 }}>
                {t("sellerp.allOffers")}
              </Link>
            </div>
          </div>
        </main>
        <div className="mt-8">
          <LuxFooter />
        </div>
        <LuxPerfLed />
      </div>
    </LuxProvider>
  );
}
