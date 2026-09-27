import type { Metadata } from "next";
import { CatalogueView } from "@/components/lux/lux-catalogue-view";

export const metadata: Metadata = {
  title: "Prêt ou prestation — Paiement en mensualités",
  description:
    "Les offres que vous pouvez régler en plusieurs fois : un apport, puis des mensualités fixes. Le compte n'est livré qu'une fois l'échéancier soldé.",
};

export default function PretOuPrestationPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; sort?: string; page?: string }>;
}) {
  return (
    <CatalogueView
      searchParams={searchParams}
      basePath="/pret-ou-prestation"
      paymentMode="INSTALLMENTS"
      kicker="Prêt ou prestation"
      title={
        <>
          Payez <em className="lux-gold-text">à votre rythme</em>.
        </>
      }
      intro={
        <p>
          Sur cette page, chaque compte se règle en mensualités fixes. Vous versez un apport, puis
          un montant identique chaque mois pendant la durée choisie. Vous ne payez jamais plus que le
          prix affiché.
        </p>
      }
      emptyText="Aucune offre en paiement échelonné pour le moment."
      aside={
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="lux-glass rounded-[20px] p-6">
            <p className="lux-kicker">1 — L&apos;apport</p>
            <p className="mt-3 text-[13px] leading-relaxed text-stone-400">
              Vous réglez l&apos;entrée indiquée sur la fiche. Elle ouvre votre dossier de paiement, elle
              ne donne pas encore accès au compte.
            </p>
          </div>
          <div className="lux-glass rounded-[20px] p-6">
            <p className="lux-kicker">2 — Les mensualités</p>
            <p className="mt-3 text-[13px] leading-relaxed text-stone-400">
              Un montant fixe, à date fixe, jusqu&apos;à la dernière échéance. Vous suivez l&apos;avancement
              depuis votre espace, commande par commande.
            </p>
          </div>
          <div className="lux-glass rounded-[20px] p-6">
            <p className="lux-kicker">3 — La livraison</p>
            <p className="mt-3 text-[13px] leading-relaxed text-stone-400">
              Les identifiants ne sont révélés qu&apos;une fois l&apos;échéancier entièrement soldé. Vous ne
              payez jamais pour un compte que vous ne recevez pas.
            </p>
          </div>
        </div>
      }
    />
  );
}
