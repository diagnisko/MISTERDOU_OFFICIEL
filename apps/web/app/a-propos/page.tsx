import type { Metadata } from "next";
import Link from "next/link";
import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { MemberSwitch } from "@/components/lux/lux-member-switch";
import { SectionLabel } from "@/components/lux/lux-fx";
import { IconArrowRight, IconLock } from "@/components/lux/lux-icons";
import { formatInt, fetchLuxSeed } from "@/lib/lux";
import { getServerT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n-core";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("about.metaTitle"), description: t("about.metaDescription") };
}

const ENGAGEMENTS = [1, 2, 3, 4] as const;
const REFUSALS = [1, 2, 3, 4] as const;

export default async function AProposPage() {
  const t = await getServerT();

  let chiffres: { inStock: number; sold: number; rating: number } | null = null;
  try {
    const seed = await fetchLuxSeed();
    chiffres = { inStock: seed.stats.productsInStock, sold: seed.stats.productsSold, rating: seed.stats.avgRating };
  } catch {
    chiffres = null;
  }

  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        <LuxNav />
        <main className="relative z-10 px-5 pt-32 md:px-8 md:pt-40">
          <div className="mx-auto max-w-4xl">
            <SectionLabel>{t("about.kicker")}</SectionLabel>
            <h1 className="lux-h2 mt-5 text-stone-100">
              {t("about.title")}
              <em className="lux-gold-text">{t("about.titleAccent")}</em>
              {t("about.titleEnd")}
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-stone-400">{t("about.lead")}</p>

            {chiffres && (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {[
                  { label: t("about.statOnline"), value: formatInt(chiffres.inStock) },
                  { label: t("about.statSold"), value: formatInt(chiffres.sold) },
                  { label: t("about.statRating"), value: `${chiffres.rating.toFixed(1).replace(".", ",")}/5` },
                ].map((s) => (
                  <div key={s.label} className="lux-glass rounded-[20px] px-5 py-5">
                    <span className="text-[9px] uppercase tracking-[0.26em] text-stone-400">{s.label}</span>
                    <span className="lux-serif mt-2 block text-[26px] font-bold text-stone-100 tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-16">
              <SectionLabel>{t("about.doKicker")}</SectionLabel>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {ENGAGEMENTS.map((n) => (
                  <div key={n} className="lux-glass rounded-[24px] p-7">
                    <h2 className="text-[16px] font-semibold text-stone-100">{t(`about.e${n}Title` as MessageKey)}</h2>
                    <p className="mt-3 text-[14px] leading-relaxed text-stone-400">{t(`about.e${n}Body` as MessageKey)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <SectionLabel>{t("about.dontKicker")}</SectionLabel>
              <div className="lux-glass mt-6 rounded-[24px] p-8">
                <ul className="space-y-4 text-[14px] leading-relaxed text-stone-400">
                  {REFUSALS.map((n) => (
                    <li key={n}>{t(`about.d${n}` as MessageKey)}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Invitation à créer un compte : visiteurs seulement. */}
            <MemberSwitch
              member={null}
              guest={
                <div className="mt-16 max-w-xl">
                  <div className="lux-glass rounded-[24px] p-7">
                    <p className="flex items-center gap-2 text-[13px] text-stone-300">
                      <IconLock className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
                      {t("about.freeTitle")}
                    </p>
                    <p className="mt-3 text-[13px] leading-relaxed text-stone-400">{t("about.freeBody")}</p>
                    <Link href="/register" className="lux-btn lux-btn-ghost lux-btn-sm mt-6 !min-h-[42px]" style={{ borderRadius: 14 }}>
                      {t("about.cta")}
                      <IconArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                    </Link>
                  </div>
                </div>
              }
            />
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
