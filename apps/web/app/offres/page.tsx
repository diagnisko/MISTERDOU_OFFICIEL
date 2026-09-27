import type { Metadata } from "next";
import Link from "next/link";
import { CatalogueView } from "@/components/lux/lux-catalogue-view";

export const metadata: Metadata = {
  title: "Toutes les offres",
  description:
    "L'intégralité des comptes eFootball disponibles, avec paiement sécurisé et livraison après confirmation.",
};

export default function OffresPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; sort?: string; page?: string }>;
}) {
  return (
    <CatalogueView
      searchParams={searchParams}
      basePath="/offres"
      paymentMode="ONE_TIME"
      kicker="Les offres"
      title={
        <>
          Tout ce qui est <em className="lux-gold-text">disponible</em>, maintenant.
        </>
      }
      intro={
        <p>
          Chaque compte passe un contrôle avant d&apos;apparaître ici. Les prix affichés sont les prix
          réellement débités, promotions comprises.
        </p>
      }
      emptyText="Aucune offre pour le moment sur ce filtre."
      aside={
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/pret-ou-prestation"
            className="lux-btn lux-btn-ghost !min-h-[44px] text-[11px] uppercase tracking-[0.16em]"
            style={{ borderRadius: 14 }}
          >
            Voir les offres à mensualités
          </Link>
          <Link
            href="/comment-ca-marche"
            className="lux-btn lux-btn-ghost !min-h-[44px] text-[11px] uppercase tracking-[0.16em]"
            style={{ borderRadius: 14 }}
          >
            Comment ça marche
          </Link>
        </div>
      }
    />
  );
}
