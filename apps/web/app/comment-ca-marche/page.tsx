import type { Metadata } from "next";
import Link from "next/link";
import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { MemberSwitch } from "@/components/lux/lux-member-switch";
import { SectionLabel } from "@/components/lux/lux-fx";
import { IconArrowRight, IconShield } from "@/components/lux/lux-icons";
import { formatInt, fetchLuxSeed } from "@/lib/lux";
import { getServerT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n-core";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("how.metaTitle"), description: t("how.metaDescription") };
}

const STEPS = [1, 2, 3, 4, 5, 6] as const;
const QUESTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export default async function CommentCaMarchePage() {
  const t = await getServerT();

  // Chiffres réels (serveur) plutôt qu'une illustration : si l'API tombe, on
  // masque la ligne plutôt que d'afficher un « 0 ».
  let chiffres: { inStock: number; rating: number } | null = null;
  try {
    const seed = await fetchLuxSeed();
    chiffres = { inStock: seed.stats.productsInStock, rating: seed.stats.avgRating };
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
            <SectionLabel>{t("howp.kicker")}</SectionLabel>
            <h1 className="lux-h2 mt-5 text-stone-100">
              {t("howp.title")}
              <em className="lux-gold-text">{t("howp.titleAccent")}</em>
              {t("howp.titleEnd")}
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-stone-400">{t("howp.lead")}</p>

            {chiffres && (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {[
                  { label: t("howp.statOnline"), value: formatInt(chiffres.inStock) },
                  { label: t("howp.statRating"), value: `${chiffres.rating.toFixed(1).replace(".", ",")}/5` },
                ].map((s) => (
                  <div key={s.label} className="lux-glass rounded-[20px] px-5 py-5">
                    <span className="text-[9px] uppercase tracking-[0.26em] text-stone-400">{s.label}</span>
                    <span className="lux-serif mt-2 block text-[28px] font-bold text-stone-100 tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            )}

            <ol className="mt-14 space-y-4">
              {STEPS.map((n) => (
                <li key={n} className="lux-glass rounded-[24px] p-7">
                  <div className="flex items-start gap-5">
                    <span className="lux-serif text-[32px] font-bold leading-none text-[var(--lux-gold)]/70 tabular-nums">
                      {String(n).padStart(2, "0")}
                    </span>
                    <div>
                      <h2 className="text-[17px] font-semibold text-stone-100">{t(`howp.s${n}Title` as MessageKey)}</h2>
                      <p className="mt-2.5 text-[14px] leading-relaxed text-stone-400">{t(`howp.s${n}Body` as MessageKey)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-16">
              <SectionLabel>{t("howp.payKicker")}</SectionLabel>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {[
                  { title: t("howp.cashTitle"), body: t("howp.cashBody"), cta: t("howp.cashCta"), href: "/offres" },
                  { title: t("howp.monthlyTitle"), body: t("howp.monthlyBody"), cta: t("howp.monthlyCta"), href: "/pret-ou-prestation" },
                ].map((mode) => (
                  <div key={mode.href} className="lux-glass rounded-[24px] p-7">
                    <h3 className="text-[16px] font-semibold text-stone-100">{mode.title}</h3>
                    <p className="mt-3 text-[14px] leading-relaxed text-stone-400">{mode.body}</p>
                    <Link href={mode.href} className="lux-btn lux-btn-ghost lux-btn-sm mt-6 !min-h-[42px]" style={{ borderRadius: 14 }}>
                      {mode.cta}
                      <IconArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                    </Link>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <SectionLabel>{t("howp.faqKicker")}</SectionLabel>
              <div className="mt-6 space-y-3">
                {QUESTIONS.map((n) => (
                  <details key={n} className="lux-glass group rounded-[20px] px-6 py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-stone-100 marker:hidden">
                      {t(`howp.q${n}` as MessageKey)}
                      <span
                        aria-hidden
                        className="text-[18px] leading-none text-[var(--lux-gold)] transition-transform duration-300 group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-4 text-[14px] leading-relaxed text-stone-400">{t(`howp.a${n}` as MessageKey)}</p>
                  </details>
                ))}
              </div>
            </div>

            <div className="mt-16 lux-glass rounded-[24px] p-8 text-center">
              <p className="flex items-center justify-center gap-2 text-[13px] text-stone-400">
                <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
                {t("howp.shield")}
              </p>
              <MemberSwitch
                guest={
                  <Link href="/register" className="lux-btn lux-btn-gold mt-6" style={{ borderRadius: 16 }}>
                    {t("howp.cta")}
                    <IconArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Link>
                }
                member={
                  <Link href="/offres" className="lux-btn lux-btn-gold mt-6" style={{ borderRadius: 16 }}>
                    {t("howp.ctaMember")}
                    <IconArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Link>
                }
              />
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
