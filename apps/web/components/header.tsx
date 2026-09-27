"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function Header() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include", cache: "no-store" })
      .then((r) => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, []);

  return (
    <header className="glass sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight">
          <Logo />
          <span className="text-lg">
            MISTER<span className="gradient-text">DOU</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Navigation principale">
          <a href="#catalogue" className="transition-colors hover:text-foreground">
            Catalogue
          </a>
          <a href="#securite" className="transition-colors hover:text-foreground">
            Sécurité
          </a>
          <a href="#frais" className="transition-colors hover:text-foreground">
            Frais
          </a>
          <a href="#comment" className="transition-colors hover:text-foreground">
            Comment ça marche
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {authed === null ? (
            <span className="h-8 w-8 animate-pulse rounded-full bg-surface-2" aria-hidden />
          ) : authed ? (
            <Link
              href="/account"
              className="shadow-glow rounded-full bg-brand px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[1.03]"
            >
              Mon espace
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                Connexion
              </Link>
              <Link
                href="/register"
                className="shadow-glow rounded-full bg-brand px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[1.03]"
              >
                Créer un compte
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Logo() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-black text-background"
    >
      M
    </span>
  );
}