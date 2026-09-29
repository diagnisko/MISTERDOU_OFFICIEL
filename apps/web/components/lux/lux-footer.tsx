"use client";

import Link from "next/link";
import { IconLock, IconShield } from "./lux-icons";
import { useT, type MessageKey } from "@/lib/i18n";

const COLUMNS: { title: MessageKey; links: { label: MessageKey; href: string }[] }[] = [
  {
    title: "footer.pages",
    links: [
      { label: "footer.home", href: "/" },
      { label: "nav.offers", href: "/offres" },
      { label: "footer.installments", href: "/pret-ou-prestation" },
      { label: "nav.how", href: "/comment-ca-marche" },
      { label: "nav.about", href: "/a-propos" },
    ],
  },
  {
    title: "footer.account",
    links: [
      { label: "footer.member", href: "/account" },
      { label: "nav.register", href: "/register" },
      { label: "nav.login", href: "/login" },
      { label: "footer.verification", href: "/identity-verification" },
    ],
  },
  {
    title: "footer.info",
    links: [
      { label: "footer.terms", href: "/cgu" },
      { label: "footer.privacy", href: "/privacy" },
      { label: "footer.legal", href: "/legal" },
    ],
  },
];

export function LuxFooter() {
  const t = useT();
  return (
    <footer className="relative border-t border-[rgba(255,255,255,0.08)] bg-[#050303] px-5 pb-10 pt-16 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="lux-serif text-[30px] font-bold tracking-[0.02em] text-stone-50">
              MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
            </p>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-stone-400">
              {t("footer.tagline")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="lux-glass-chip px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-stone-400">
                <IconShield className="h-3 w-3 text-[var(--lux-gold)]" aria-hidden />
                {t("footer.payments")}
              </span>
              <span className="lux-glass-chip px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-stone-400">
                <IconLock className="h-3 w-3 text-[var(--lux-gold)]" aria-hidden />
                {t("footer.privacy")}
              </span>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={t(col.title)}>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-stone-400">{t(col.title)}</h3>
              <ul className="mt-5 flex flex-col gap-3">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] text-stone-400 transition-colors hover:text-[var(--lux-gold-light)]">
                      {t(l.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 border-t border-[rgba(255,255,255,0.06)] pt-6">
          <p className="text-[11.5px] leading-relaxed text-stone-400">
            © {new Date().getFullYear()} MISTERDOU · {t("footer.rgpd")}
          </p>
        </div>
      </div>
    </footer>
  );
}