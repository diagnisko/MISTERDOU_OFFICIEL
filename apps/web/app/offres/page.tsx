import type { Metadata } from "next";
import Link from "next/link";
import { CatalogueView } from "@/components/lux/lux-catalogue-view";
import { getServerT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("offers.metaTitle"), description: t("offers.metaDescription") };
}

export default async function OffresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; division?: string; sort?: string; page?: string }>;
}) {
  const t = await getServerT();
  return (
    <CatalogueView
      searchParams={searchParams}
      basePath="/offres"
      paymentMode="ONE_TIME"
      kicker={t("offers.kicker")}
      title={
        <>
          {t("offers.title")}
          <em className="lux-gold-text">{t("offers.titleAccent")}</em>
          {t("offers.titleEnd")}
        </>
      }
      intro={<p>{t("offers.intro")}</p>}
      emptyText={t("offers.empty")}
      aside={
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/pret-ou-prestation"
            className="lux-btn lux-btn-ghost !min-h-[44px] text-[11px] uppercase tracking-[0.16em]"
            style={{ borderRadius: 14 }}
          >
            {t("offers.seeMonthly")}
          </Link>
          <Link
            href="/comment-ca-marche"
            className="lux-btn lux-btn-ghost !min-h-[44px] text-[11px] uppercase tracking-[0.16em]"
            style={{ borderRadius: 14 }}
          >
            {t("offers.how")}
          </Link>
        </div>
      }
    />
  );
}
