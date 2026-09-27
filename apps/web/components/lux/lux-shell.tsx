"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LuxProvider } from "./lux-data";
import { NotificationBell } from "@/components/notifications/notification-bell";

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
  links = [],
}: {
  label: string;
  links?: { href: string; label: string }[];
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.08)] bg-[#0f172a]/82 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-5 md:px-8">
        <Link href="/" className="lux-serif text-[22px] font-bold tracking-[0.02em] text-stone-50">
          MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
        </Link>
        <nav aria-label="Navigation de l'espace membre" className="flex items-center gap-1 sm:gap-2">
          <NotificationBell />
          {links.map((l) => (
            <Link
              key={l.href + l.label}
              href={l.href}
              className="rounded-2xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-stone-100 sm:px-3.5"
            >
              {l.label}
            </Link>
          ))}
          <span className="ml-1 hidden rounded-full border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[var(--lux-gold-light)] sm:inline-block">
            {label}
          </span>
        </nav>
      </div>
    </header>
  );
}
