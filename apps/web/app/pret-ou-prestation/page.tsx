import type { Metadata } from "next";
import { CatalogueView } from "@/components/lux/lux-catalogue-view";
import { getServerT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("monthly.metaTitle"), description: t("monthly.metaDescription") };
}

export default async function PretOuPrestationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; division?: string; sort?: string; page?: string }>;
}) {
  const t = await getServerT();
  const steps = [
    { title: t("monthly.step1"), body: t("monthly.step1Body") },
    { title: t("monthly.step2"), body: t("monthly.step2Body") },
    { title: t("monthly.step3"), body: t("monthly.step3Body") },
  ];
  return (
    <CatalogueView
      searchParams={searchParams}
      basePath="/pret-ou-prestation"
      paymentMode="INSTALLMENTS"
      kicker={t("monthly.kicker")}
      title={
        <>
          {t("monthly.title")}
          <em className="lux-gold-text">{t("monthly.titleAccent")}</em>
          {t("monthly.titleEnd")}
        </>
      }
      intro={<p>{t("monthly.intro")}</p>}
      emptyText={t("monthly.empty")}
      aside={
        <section aria-labelledby="monthly-how" className="lux-glass mt-14 rounded-[24px] p-5 sm:p-7">
          <h2 id="monthly-how" className="text-[15px] font-semibold text-stone-100">
            {t("monthly.howTitle")}
          </h2>
          <ol className="mt-5 grid gap-5 md:grid-cols-3 md:gap-6">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[rgba(255,106,50,0.45)] text-[12px] font-semibold text-[var(--lux-gold-light)]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[14px] font-medium text-stone-100">{step.title.replace(/^\d+\s*[—-]\s*/, "")}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-stone-400">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      }
    />
  );
}
