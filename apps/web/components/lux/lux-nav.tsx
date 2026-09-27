"use client";

import { useState } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { cx } from "./lux-fx";
import { IconMenu, IconX } from "./lux-icons";
import { NotificationBell } from "@/components/notifications/notification-bell";

// La navigation pointe vers les VRAIES pages. Elle mélangeait auparavant des
// ancres de la landing (« Catalogue » → /#comptes), qui ne menaient nulle part
// depuis une page secondaire et cassaient le retour arrière.
const NAV_LINKS = [
  { href: "/offres", label: "Offres" },
  { href: "/pret-ou-prestation", label: "Mensualités" },
  { href: "/comment-ca-marche", label: "Comment ça marche" },
  { href: "/a-propos", label: "À propos" },
];

export function LuxNav({ root = false }: { root?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 12));

  const linkHref = (href: string) => (root && href.startsWith("#") ? `/${href}` : href);

  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-[60] transition-all duration-500",
        scrolled ? "border-b border-[rgba(255,255,255,0.08)] bg-[#0f172a]/78 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <nav aria-label="Navigation principale" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:h-[72px] md:px-8">
        <a href={root ? "/" : "#top"} className="lux-serif text-[22px] font-bold tracking-[0.02em] text-stone-50">
          MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
        </a>

        <ul className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={linkHref(l.href)}
                className="text-[12px] font-medium uppercase tracking-[0.18em] text-stone-400 transition-colors hover:text-stone-100"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 lg:gap-3">
          <NotificationBell />
          <div className="hidden items-center gap-3 lg:flex">
            <Link
              href="/login"
              className="rounded-2xl border border-[rgba(255,255,255,0.12)] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-300 transition-colors hover:border-[rgba(245,215,142,0.45)] hover:text-[var(--lux-gold-light)]"
            >
              Connexion
            </Link>
            <Link
              href="/register"
              className="rounded-2xl bg-[linear-gradient(120deg,#f5d78e,#f59e0b_45%,#d97706)] px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-[#1c1303] shadow-[0_10px_30px_-14px_rgba(245,158,11,0.7)] transition-transform duration-300 hover:-translate-y-0.5"
            >
              Créer un compte
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] text-stone-200 lg:hidden"
          >
            {open ? <IconX size={20} /> : <IconMenu size={20} />}
          </button>
        </div>
      </nav>

      {/* Menu mobile — glass */}
      <div
        className={cx(
          "overflow-hidden border-b border-[rgba(255,255,255,0.08)] bg-[#0f172a]/92 backdrop-blur-2xl transition-[max-height,opacity] duration-500 lg:hidden",
          open ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <ul className="flex flex-col gap-1 px-6 py-6">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={linkHref(l.href)}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-3.5 text-[13px] font-medium uppercase tracking-[0.18em] text-stone-300 hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li className="mt-3 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.08)] pt-5">
            <Link href="/login" onClick={() => setOpen(false)} className="lux-btn lux-btn-ghost w-full" style={{ borderRadius: 16 }}>
              Connexion
            </Link>
            <Link href="/register" onClick={() => setOpen(false)} className="lux-btn lux-btn-gold w-full" style={{ borderRadius: 16 }}>
              Créer un compte
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}