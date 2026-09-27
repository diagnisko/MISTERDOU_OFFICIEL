import type { Metadata } from "next";
import Link from "next/link";
import { LuxProvider, LuxPerfLed } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { SectionLabel } from "@/components/lux/lux-fx";
import { IconArrowRight, IconShield } from "@/components/lux/lux-icons";
import { formatInt, fetchLuxSeed } from "@/lib/lux";

export const metadata: Metadata = {
  title: "Comment ça marche",
  description:
    "De la création du compte à la réception des identifiants : vérification d'identité, paiement, cas des mensualités, remboursement. Sans jargon, avec les délais réels.",
};

// Repli si l'API ne répond pas : la page doit rester lisible et dire pourquoi.
const ETAPES = [
  {
    n: "01",
    titre: "Vous créez un compte",
    texte:
      "Numéro de téléphone, e-mail, mot de passe. C'est gratuit et sans engagement. Vous pouvez parcourir toutes les offres avant de décider.",
  },
  {
    n: "02",
    titre: "Vous vérifiez votre identité",
    texte:
      "Une pièce d'identité et un selfie, une fois pour toutes. La vérification est obligatoire avant tout achat : elle protège votre argent autant que le compte que vous achetez. Comptez quelques minutes une fois le dossier complet.",
  },
  {
    n: "03",
    titre: "Vous choisissez une offre",
    texte:
      "Chaque fiche indique la puissance, la division, le prix réel et la note.",
  },
  {
    n: "04",
    titre: "Vous payez",
    texte:
      "Le paiement se fait dans votre espace, sur le canal de votre choix. Le montant est recalculé côté serveur au moment de la commande : ce que vous voyez est ce qui est débité.",
  },
  {
    n: "05",
    titre: "Vous recevez votre compte",
    texte:
      "Dès que le paiement est confirmé, les identifiants apparaissent dans votre espace membre. Ils n'apparaissent qu'à vous, et chaque consultation est tracée.",
  },
];

const QUESTIONS = [
  {
    q: "Pourquoi faut-il vérifier mon identité ?",
    r: "Parce que le paiement est irréversible de notre côté : sans vérification préalable, un compte créé le jour même pourrait encaisser puis disparaître. La vérification lie l'acheteur à une identité réelle, et nous permet de faire remonter toute fraude.",
  },
  {
    q: "Je n'ai pas reçu mes identifiants après le paiement, est-ce normal ?",
    r: "Sur un paiement comptant, les identifiants sont disponibles immédiatement après confirmation. Si l'espace reste vide, c'est que la confirmation bancaire n'est pas encore passée : le délai observé est celui de votre banque, pas le nôtre.",
  },
  {
    q: "Comment fonctionne le paiement en mensualités ?",
    r: "Sur la page « Prêt ou prestation », vous versez un apport puis un montant fixe chaque mois pendant la durée affichée. Le compte n'est livré qu'une fois toutes les mensualités réglées : vous ne payez jamais pour un compte qui ne vous serait pas remis.",
  },
  {
    q: "Que se passe-t-il si j'arrête de payer une mensualité ?",
    r: "L'échéancier est marqué en retard et l'accès n'a pas encore été ouvert : il n'y a donc rien à reprendre. Nous vous contactons pour régulariser. Un compte déjà livré puis remboursé, en revanche, voit son accès révoqué.",
  },
  {
    q: "Puis-je me faire rembourser ?",
    r: "Si une offre ne correspond pas à sa fiche, signalez-le dans les meilleurs délais : l'achat est remboursé et l'accès est révoqué. Le remboursement est effectué par notre équipe, il n'est pas automatique.",
  },
  {
  },
];

export default async function CommentCaMarchePage() {
  // Chiffres réels (serveur) plutôt qu'une illustration : si l'API tombe, on
  // masque la ligne plutôt que d'afficher un « 0 ».
  let chiffres: { inStock: number; rating: number } | null = null;
  try {
    const seed = await fetchLuxSeed();
    chiffres = {
      inStock: seed.stats.productsInStock,
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
            <SectionLabel>Comment ça marche</SectionLabel>
            <h1 className="lux-h2 mt-5 text-stone-100">
              Cinq étapes, <em className="lux-gold-text">aucune surprise</em>.
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-stone-400">
              Acheter un compte ici n'est pas un pari à espérer. Voici exactement ce qui se passe,
              dans quel ordre, et ce que vous recevez à chaque étape.
            </p>

            {chiffres && (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Comptes en ligne", value: formatInt(chiffres.inStock) },
                  { label: "Note moyenne", value: `${chiffres.rating.toFixed(1).replace(".", ",")}/5` },
                ].map((s) => (
                  <div key={s.label} className="lux-glass rounded-[20px] px-5 py-5">
                    <span className="text-[9px] uppercase tracking-[0.26em] text-stone-400">{s.label}</span>
                    <span className="lux-serif mt-2 block text-[28px] font-bold text-stone-100 tabular-nums">
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <ol className="mt-14 space-y-4">
              {ETAPES.map((e) => (
                <li key={e.n} className="lux-glass rounded-[24px] p-7">
                  <div className="flex items-start gap-5">
                    <span className="lux-serif text-[32px] font-bold leading-none text-[var(--lux-gold)]/70 tabular-nums">
                      {e.n}
                    </span>
                    <div>
                      <h2 className="text-[17px] font-semibold text-stone-100">{e.titre}</h2>
                      <p className="mt-2.5 text-[14px] leading-relaxed text-stone-400">{e.texte}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-16">
              <SectionLabel>Les deux façons de payer</SectionLabel>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div className="lux-glass rounded-[24px] p-7">
                  <h3 className="text-[16px] font-semibold text-stone-100">En un seul paiement</h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-stone-400">
                    Le prix affiché, payé une fois. Les identifiants arrivent dès la confirmation du
                    paiement. C&apos;est le mode par défaut de la page des offres.
                  </p>
                  <Link
                    href="/offres"
                    className="lux-btn lux-btn-ghost lux-btn-sm mt-6 !min-h-[42px]"
                    style={{ borderRadius: 14 }}
                  >
                    Voir les offres
                    <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
                <div className="lux-glass rounded-[24px] p-7">
                  <h3 className="text-[16px] font-semibold text-stone-100">En mensualités</h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-stone-400">
                    Un apport, puis un montant fixe chaque mois. L&apos;accès au compte s&apos;ouvre à la
                    dernière échéance, jamais avant.
                  </p>
                  <Link
                    href="/pret-ou-prestation"
                    className="lux-btn lux-btn-ghost lux-btn-sm mt-6 !min-h-[42px]"
                    style={{ borderRadius: 14 }}
                  >
                    Voir les offres à mensualités
                    <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-16">
              <SectionLabel>Vos questions</SectionLabel>
              <div className="mt-6 space-y-3">
                {QUESTIONS.map((f) => (
                  <details key={f.q} className="lux-glass group rounded-[20px] px-6 py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-stone-100 marker:hidden">
                      {f.q}
                      <span
                        aria-hidden
                        className="text-[18px] leading-none text-[var(--lux-gold)] transition-transform duration-300 group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-4 text-[14px] leading-relaxed text-stone-400">{f.r}</p>
                  </details>
                ))}
              </div>
            </div>

            <div className="mt-16 lux-glass rounded-[24px] p-8 text-center">
              <p className="flex items-center justify-center gap-2 text-[13px] text-stone-400">
                <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
                Vos identifiants ne sont visibles que par vous, et chaque consultation est tracée.
              </p>
              <Link href="/register" className="lux-btn lux-btn-gold mt-6" style={{ borderRadius: 16 }}>
                Créer mon compte
                <IconArrowRight className="h-4 w-4" aria-hidden />
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
