"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Flèche « Retour » des en-têtes. Elle revient à la page précédente du site ;
// si la page a été ouverte directement (lien, nouvel onglet), elle mène à la
// page parente logique (fiche → offres, commande → mes commandes…).
// ---------------------------------------------------------------------------

const TRAIL_KEY = "md_trail";

function readTrail(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeTrail(trail: string[]) {
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail.slice(-30)));
  } catch {
    /* stockage indisponible : la flèche mènera à la page parente */
  }
}

/** Page parente logique quand il n'y a pas d'historique dans le site. */
export function parentOf(pathname: string): string {
  if (pathname.startsWith("/catalogue/") || pathname.startsWith("/vendeurs/")) return "/offres";
  if (pathname.startsWith("/checkout/")) return "/account/orders";
  if (pathname.startsWith("/mot-de-passe-oublie")) return "/login";
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length <= 1) return "/offres";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function BackButton({ hideOn = [], className = "" }: { hideOn?: string[]; className?: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();

  // Chemin parcouru dans le site (onglet courant), pour savoir si « Retour » reste dans le site.
  useEffect(() => {
    const trail = readTrail();
    if (trail[trail.length - 1] !== pathname) writeTrail([...trail, pathname]);
  }, [pathname]);

  if (hideOn.includes(pathname)) return null;

  function goBack() {
    const trail = readTrail();
    if (trail.length >= 2 && trail[trail.length - 1] === pathname) {
      writeTrail(trail.slice(0, -1));
      router.back();
      return;
    }
    router.push(parentOf(pathname));
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t("nav.back")}
      title={t("nav.back")}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border sm:h-10 sm:w-10 border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lux-gold)]/60 ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rtl:rotate-180">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
