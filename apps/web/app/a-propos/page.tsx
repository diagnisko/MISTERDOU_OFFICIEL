import type { Metadata } from "next";
import Link from "next/link";
import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { SectionLabel } from "@/components/lux/lux-fx";
import { IconArrowRight, IconLock, IconShield } from "@/components/lux/lux-icons";
import { formatInt, fetchLuxSeed } from "@/lib/lux";

export const metadata: Metadata = {
  title: "À propos",
  description:
    "Ce qu'est MISTERDOU, ce que nous faisons de vos données, et les règles que nous ne négocierons pas. Une page qui dit aussi ce que nous ne faisons pas.",
};

const ENGAGEMENTS = [
  {
    titre: "Le prix affiché est le prix payé",
    texte:
      "Le prix est calculé côté serveur au moment de la commande : le montant affiché sur la fiche est celui qui est payé.",
  },
  {
    titre: "L&apos;accès ne s'ouvre qu'après paiement complet",
    texte:
      "Sur un achat comptant, dès la confirmation. Sur un échéancier, à la dernière mensualité — pas avant.",
  },
  {
    titre: "Chaque consultation d&apos;identifiants est tracée",
    texte:
      "Nous journons qui ouvre un compte, quand, et depuis quelle adresse. C'est la seule façon de distinguer un oubli d'une réutilisation frauduleuse — et c'est ce qui nous permet d'agir vite.",
  },
  {
    titre: "Vos identifiants ne sont pas une matière première",
    texte:
      "Ils sont chiffrés au repos, jamais exposés dans une page publique, et accessibles uniquement à leur propriétaire.",
  },
];

export default async function AProposPage() {
  let chiffres: { inStock: number; sold: number; rating: number } | null = null;
  try {
    const seed = await fetchLuxSeed();
    chiffres = {
      inStock: seed.stats.productsInStock,
      sold: seed.stats.productsSold,
      rating: seed.stats.avgRating,
    };
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
            <SectionLabel>À propos</SectionLabel>
            <h1 className="lux-h2 mt-5 text-stone-100">
              Une place de marché <em className="lux-gold-text">tenue au fil</em> des règles.
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-stone-400">
              MISTERDOU propose un catalogue de comptes eFootball avec paiement sécurisé et livraison après confirmation.
            </p>

            {chiffres && (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Comptes en ligne", value: formatInt(chiffres.inStock) },
                  { label: "Déjà vendus", value: formatInt(chiffres.sold) },
                  { label: "Note moyenne", value: `${chiffres.rating.toFixed(1).replace(".", ",")}/5` },
                ].map((s) => (
                  <div key={s.label} className="lux-glass rounded-[20px] px-5 py-5">
                    <span className="text-[9px] uppercase tracking-[0.26em] text-stone-400">{s.label}</span>
                    <span className="lux-serif mt-2 block text-[26px] font-bold text-stone-100 tabular-nums">
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-16">
              <SectionLabel>Ce que nous nous engageons à faire</SectionLabel>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {ENGAGEMENTS.map((e) => (
                  <div key={e.titre} className="lux-glass rounded-[24px] p-7">
                    <h2 className="text-[16px] font-semibold text-stone-100">{e.titre}</h2>
                    <p className="mt-3 text-[14px] leading-relaxed text-stone-400">{e.texte}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-16">
              <SectionLabel>Et ce que nous ne faisons pas</SectionLabel>
              <div className="lux-glass mt-6 rounded-[24px] p-8">
                <ul className="space-y-4 text-[14px] leading-relaxed text-stone-400">
                  <li>
                    Chaque compte proposé au catalogue est contrôlé avant sa publication.
                  </li>
                  <li>
                    Nous ne promettons pas un accès que nous ne pouvons pas garantir : si un compte est
                    révoqué par l&apos;éditeur après la vente, l&apos;achat est remboursé et l&apos;accès
                    retiré.
                  </li>
                  <li>
                    Nous ne gardons pas vos identifiants en clair. Ils sont chiffrés et accessibles uniquement après paiement.
                  </li>
                  <li>
                    Nous ne rémunérons pas les signalements. Un acheteur ne peut pas être pénalisé
                    pour avoir signalé un problème avéré.
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-16 max-w-xl">
              <div className="lux-glass rounded-[24px] p-7">
                <p className="flex items-center gap-2 text-[13px] text-stone-300">
                  <IconLock className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
                  Un compte acheteur, c&apos;est gratuit
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-stone-400">
                  Créez votre compte client pour suivre vos commandes et retrouver vos achats.
                </p>
                <Link href="/register" className="lux-btn lux-btn-ghost lux-btn-sm mt-6 !min-h-[42px]" style={{ borderRadius: 14 }}>
                  Créer mon compte
                  <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
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
