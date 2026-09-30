"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./lux-fx";
import { IconMenu, IconX } from "./lux-icons";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { MessagesButton } from "@/components/chat/messages-button";
import { AccountMenu } from "@/components/account/account-menu";
import { useAccount } from "@/lib/account";
import { useT, type MessageKey } from "@/lib/i18n";

// La navigation pointe vers les VRAIES pages. Elle mélangeait auparavant des
// ancres de la landing (« Catalogue » → /#comptes), qui ne menaient nulle part
// depuis une page secondaire et cassaient le retour arrière.
// « À propos » est pour les visiteurs : un membre le retrouve dans le menu du profil.
const NAV_LINKS: Array<{ href: string; label: MessageKey; guestOnly?: boolean }> = [
  { href: "/offres", label: "nav.offers" },
  { href: "/pret-ou-prestation", label: "nav.installments" },
  { href: "/comment-ca-marche", label: "nav.how" },
  { href: "/a-propos", label: "nav.about", guestOnly: true },
];

// Lien de l'en-tête correspondant à la page ouverte (fiche d'une offre → « Offres »).
function activeHref(pathname: string): string | null {
  if (pathname.startsWith("/catalogue")) return "/offres";
  return NAV_LINKS.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))?.href ?? null;
}

export function LuxNav({ root = false }: { root?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();
  const account = useAccount();
  const t = useT();
  const reduce = useReducedMotion();
  const pathname = usePathname();
  // Au clic, le marqueur glisse tout de suite vers le lien choisi, sans
  // attendre le chargement de la page suivante.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [pathname]);
  const current = pending ?? activeHref(pathname);

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 12));

  const links = NAV_LINKS.filter((l) => !l.guestOnly || account.status !== "member");
  const linkHref = (href: string) => (root && href.startsWith("#") ? `/${href}` : href);

  return (
    <header
      className={cx(
        "lux-nav-bar fixed inset-x-0 top-0 z-[60] transition-all duration-500",
        scrolled ? "border-b border-[rgba(255,255,255,0.08)] bg-[#050303]/78 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <nav aria-label={t("nav.main")} className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:h-[72px] md:px-8">
        <a href={account.status === "member" ? "/offres" : root ? "/" : "#top"} className="lux-serif text-[22px] font-bold tracking-[0.02em] text-stone-50">
          MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
        </a>

        <ul className="hidden items-center gap-1 lg:flex">
          {links.map((l) => {
            const active = current === l.href;
            return (
              <li key={l.href}>
                <Link
                  href={linkHref(l.href)}
                  onClick={() => setPending(l.href)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative isolate block whitespace-nowrap rounded-full px-3.5 py-2 text-[12px] font-medium uppercase tracking-[0.14em] transition-colors xl:tracking-[0.18em]",
                    active ? "text-white" : "text-stone-400 hover:text-stone-100",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="lux-nav-marker"
                      aria-hidden
                      className="absolute inset-0 -z-10 rounded-full bg-[linear-gradient(120deg,#c83a24,#8e2014)] shadow-[0_8px_24px_-12px_rgba(232,71,36,0.8)]"
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
                    />
                  )}
                  {t(l.label)}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2 lg:gap-3">
          <MessagesButton />
          <NotificationBell />
          <div className="hidden lg:block">
            <AccountMenu />
          </div>
          <div className="lg:hidden">
            <AccountMenu compact />
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] text-stone-200 lg:hidden"
          >
            {open ? <IconX size={20} /> : <IconMenu size={20} />}
          </button>
        </div>
      </nav>

      {/* Menu mobile — glass */}
      <div
        className={cx(
          "overflow-hidden border-b border-[rgba(255,255,255,0.08)] bg-[#050303]/92 backdrop-blur-2xl transition-[max-height,opacity] duration-500 lg:hidden",
          open ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <ul className="flex flex-col gap-1 px-6 py-6">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={linkHref(l.href)}
                onClick={() => setOpen(false)}
                aria-current={current === l.href ? "page" : undefined}
                className={cx(
                  "block rounded-xl px-3 py-3.5 text-[13px] font-medium uppercase tracking-[0.18em]",
                  current === l.href
                    ? "bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white"
                    : "text-stone-300 hover:bg-[rgba(255,255,255,0.04)] hover:text-white",
                )}
              >
                {t(l.label)}
              </Link>
            </li>
          ))}
          {account.status === "guest" && (
          <li className="mt-3 flex flex-col gap-3 border-t border-[rgba(255,255,255,0.08)] pt-5">
            <Link href="/login" onClick={() => setOpen(false)} className="lux-btn lux-btn-ghost w-full" style={{ borderRadius: 16 }}>
              {t("nav.login")}
            </Link>
            <Link href="/register" onClick={() => setOpen(false)} className="lux-btn lux-btn-gold w-full" style={{ borderRadius: 16 }}>
              {t("nav.register")}
            </Link>
          </li>
          )}
        </ul>
      </div>
    </header>
  );
}