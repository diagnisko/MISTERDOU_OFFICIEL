import Link from "next/link";
import { IconLock, IconShield } from "./lux-icons";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Les pages",
    links: [
      { label: "Accueil", href: "/" },
      { label: "Offres", href: "/offres" },
      { label: "Prêt ou prestation", href: "/pret-ou-prestation" },
      { label: "Comment ça marche", href: "/comment-ca-marche" },
      { label: "À propos", href: "/a-propos" },
    ],
  },
  {
    title: "Mon compte",
    links: [
      { label: "Espace membre", href: "/account" },
      { label: "Créer un compte", href: "/register" },
      { label: "Connexion", href: "/login" },
      { label: "Vérification d'identité", href: "/verification" },
    ],
  },
  {
    title: "Informations",
    links: [
      { label: "Conditions générales", href: "/cgu" },
      { label: "Confidentialité", href: "/privacy" },
      { label: "Mentions légales", href: "/legal" },
    ],
  },
];

export function LuxFooter() {
  return (
    <footer className="relative border-t border-[rgba(255,255,255,0.08)] bg-[#050303] px-5 pb-10 pt-16 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="lux-serif text-[30px] font-bold tracking-[0.02em] text-stone-50">
              MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
            </p>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-stone-400">
              Comptes eFootball certifiés. Paiement Wave / Orange Money, identité vérifiée, identifiants chiffrés —
              le marché de confiance, sans zone grise.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="lux-glass-chip px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-stone-400">
                <IconShield className="h-3 w-3 text-[var(--lux-gold)]" aria-hidden />
                Wave / Orange Money
              </span>
              <span className="lux-glass-chip px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-stone-400">
                <IconLock className="h-3 w-3 text-[var(--lux-gold)]" aria-hidden />
                Confidentialité
              </span>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-stone-400">{col.title}</h3>
              <ul className="mt-5 flex flex-col gap-3">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] text-stone-400 transition-colors hover:text-[var(--lux-gold-light)]">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 border-t border-[rgba(255,255,255,0.06)] pt-6">
          <p className="text-[11.5px] leading-relaxed text-stone-400">
            © {new Date().getFullYear()} MISTERDOU · RGPD : vos données sont traitées de façon minimale, hébergées
            localement, et jamais revendues. eFootball est une marque de KONAMI — MISTERDOU est une plateforme
            tierce indépendante.
          </p>
        </div>
      </div>
    </footer>
  );
}