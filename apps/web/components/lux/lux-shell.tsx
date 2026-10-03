"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LuxProvider } from "./lux-data";
import { LuxNav } from "./lux-nav";

// ---------------------------------------------------------------------------
// Coquille des espaces applicatifs (admin, vendeur, KYC, checkout).
// `data-lux`     → univers visuel slate & or (verre, aurore, jetons luxe).
// `data-lux-app` → couches spécifiques applicatives (typo de titres serif,
//                  tableaux, harmonisation du kit .glass / .card-hover).
// Un seul point d'entrée : toute page wrappée hérite du nouveau design.
// ---------------------------------------------------------------------------
export function LuxShell({ children }: { children: ReactNode }) {
  return (
    <LuxProvider>
      <div data-lux data-lux-app className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        {children}
      </div>
    </LuxProvider>
  );
}

// En-tête de page standard : kicker or + titre serif + action à droite.
export function LuxPageHead({
  kicker,
  title,
  meta,
  action,
}: {
  kicker: string;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="lux-kicker">{kicker}</p>
        <h1 className="mt-2">{title}</h1>
        {meta && <div className="mt-2 text-[13px] text-stone-400">{meta}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

// Retour filaire vers un espace parent (même grammaire que le reste du luxe).
export function LuxBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-[var(--lux-gold-light)]"
    >
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}

// Barre supérieure des espaces membres (KYC, vendeur, paiement) :
// même grammaire que l'espace membre, afin qu'aucun écran ne « change de design ».
export function LuxTopBar({
  label,
}: {
  label: string;
  /** Conservé pour compatibilité : la navigation du site contient déjà ces liens. */
  links?: { href: string; label: string }[];
}) {
  // Même en-tête que tout le site (logo, liens, messages, cloche, compte) : une
  // seule barre, pour ne jamais casser l'ambiance d'une page à l'autre.
  return (
    <>
      <LuxNav />
      <span className="sr-only">{label}</span>
      {/* La barre est fixe : cet espace évite qu'elle recouvre le haut de la page. */}
      <div className="h-16 md:h-[72px]" aria-hidden />
    </>
  );
}
