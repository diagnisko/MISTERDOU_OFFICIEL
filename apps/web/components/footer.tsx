import Link from "next/link";
import { Logo } from "./header";

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 md:flex-row">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-extrabold">
            MISTER<span className="gradient-text">DOU</span>
          </span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-5 text-sm text-muted" aria-label="Pied de page">
          <Link className="transition-colors hover:text-foreground" href="/register">
            Inscription
          </Link>
          <Link className="transition-colors hover:text-foreground" href="/login">
            Connexion
          </Link>
          <Link className="transition-colors hover:text-foreground" href="#securite">
            Sécurité
          </Link>
          <Link className="transition-colors hover:text-foreground" href="#comment">
            Comment ça marche
          </Link>
        </nav>

        <p className="text-xs text-muted">
          © {new Date().getFullYear()} MISTERDOU — Paiements via Wave et Orange Money.
        </p>
      </div>
    </footer>
  );
}