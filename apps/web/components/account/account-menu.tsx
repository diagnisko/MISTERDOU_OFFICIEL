"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { displayName, initials, logoutAccount, useAccount, type AccountUser } from "@/lib/account";
import { useT, type MessageKey } from "@/lib/i18n";
import { IconBadgeCheck, IconCart, IconChat, IconGear, IconHome, IconLifebuoy, IconList, IconLogout, IconSpark, IconStore, IconUsers } from "@/components/dash/dash-icons";

export function Avatar({ user, url, size = 40 }: { user: AccountUser; url: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- bucket public R2
    <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="grid place-items-center rounded-full bg-[linear-gradient(135deg,#ff8a5c,#7a1712)] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(user)}
    </span>
  );
}

// « seller » : true = vendeurs seulement, false = clients seulement.
const ITEMS: Array<{ href: string; label: MessageKey; icon: typeof IconUsers; seller?: boolean }> = [
  { href: "/account", label: "menu.profile", icon: IconUsers },
  { href: "/account/orders", label: "menu.orders", icon: IconCart },
  { href: "/account/messages", label: "menu.messages", icon: IconChat },
  { href: "/seller", label: "menu.seller", icon: IconSpark, seller: true },
  { href: "/account/devenir-vendeur", label: "menu.becomeSeller", icon: IconStore, seller: false },
  { href: "/account/settings", label: "menu.settings", icon: IconGear },
  { href: "/support", label: "menu.support", icon: IconLifebuoy },
  { href: "/a-propos", label: "nav.about", icon: IconList },
];

// Équipe (admin, manager) : la boutique en consultation, retour à la console par le menu.
const TEAM_ITEMS: Array<{ href: string; label: MessageKey; icon: typeof IconUsers }> = [
  { href: "/account", label: "menu.profile", icon: IconUsers },
  { href: "/admin", label: "menu.dashboard", icon: IconHome },
  { href: "/account/settings", label: "menu.settings", icon: IconGear },
];

// Menu du compte : rond de profil dans l'en-tête ; boutons d'accès pour un visiteur.
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (account.status === "loading") {
    return <span className="block h-10 w-10 animate-pulse rounded-full bg-white/[0.06]" aria-hidden />;
  }

  if (account.status === "guest") {
    return compact ? null : (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="rounded-2xl border border-[rgba(255,255,255,0.12)] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-300 transition-colors hover:border-[rgba(255,106,50,0.45)] hover:text-[var(--lux-gold-light)]"
        >
          {t("nav.login")}
        </Link>
        <Link
          href="/register"
          className="rounded-2xl bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-[#1a0503] shadow-[0_10px_30px_-14px_rgba(232,71,36,0.7)] transition-transform duration-300 hover:-translate-y-0.5"
        >
          {t("nav.register")}
        </Link>
      </div>
    );
  }

  const { user, profile } = account;
  const verified = user.kycStatus === "VERIFIED";
  const isActiveSeller = profile.isSeller && profile.sellerStatus === "ACTIVE";
  const team = user.role === "ADMIN" || user.role === "STAFF";
  const items = team ? TEAM_ITEMS : ITEMS.filter((i) => i.seller === undefined || i.seller === isActiveSeller);

  async function logout() {
    setLeaving(true);
    await logoutAccount();
    setOpen(false);
    setLeaving(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menu.label", { name: displayName(user) })}
        className="flex items-center rounded-full ring-2 ring-transparent transition hover:ring-[rgba(255,106,50,0.5)] focus-visible:ring-[#ff6a32]"
      >
        <Avatar user={user} url={profile.avatarUrl} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={t("menu.title")}
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="dash-card absolute end-0 top-[calc(100%+10px)] z-[90] w-72 origin-top-right p-2 text-start"
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar user={user} url={profile.avatarUrl} size={44} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-white">{displayName(user)}</p>
                <p className="truncate text-[12px] text-[#8f7d77]">{user.email}</p>
                <span className={`dash-pill mt-1.5 ${verified ? "dash-pill-paid" : "dash-pill-due"}`}>
                  {verified ? t("menu.verified") : t("menu.unverified")}
                </span>
              </div>
            </div>
            <div className="my-1 h-px bg-[rgba(255,236,229,0.07)]" />
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="dash-nav-link outline-none focus-visible:bg-white/[0.06]"
              >
                <item.icon size={17} />
                {t(item.label)}
              </Link>
            ))}
            {!verified && !team && (
              <Link
                href="/identity-verification"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="dash-nav-link text-[#ffb08a] outline-none focus-visible:bg-white/[0.06]"
              >
                <IconBadgeCheck size={17} />
                {t("menu.verify")}
              </Link>
            )}
            <div className="my-1 h-px bg-[rgba(255,236,229,0.07)]" />
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout()}
              disabled={leaving}
              className="dash-nav-link w-full text-[#fca5a5] outline-none focus-visible:bg-white/[0.06] disabled:opacity-60"
            >
              <IconLogout size={17} />
              {leaving ? t("menu.loggingOut") : t("menu.logout")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
