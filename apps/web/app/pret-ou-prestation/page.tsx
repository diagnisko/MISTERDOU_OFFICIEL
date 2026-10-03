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
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.title} className="lux-glass rounded-[20px] p-6">
              <p className="lux-kicker">{step.title}</p>
              <p className="mt-3 text-[13px] leading-relaxed text-stone-400">{step.body}</p>
            </div>
          ))}
        </div>
      }
    />
  );
}
