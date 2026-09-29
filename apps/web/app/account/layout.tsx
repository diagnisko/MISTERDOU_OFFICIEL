"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LuxProvider } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { Spinner } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { useT, type MessageKey } from "@/lib/i18n";

const TABS: Array<{ href: string; label: MessageKey }> = [
  { href: "/account", label: "menu.profile" },
  { href: "/account/orders", label: "menu.orders" },
  { href: "/account/messages", label: "menu.messages" },
  { href: "/account/settings", label: "menu.settings" },
];

// Espace compte : même habillage que le site (pas de tableau de bord),
// onglets Profil / Commandes / Paramètres.
export default function AccountLayout({ children }: { children: ReactNode }) {
  const account = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  useEffect(() => {
    if (account.status === "guest") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [account.status, pathname, router]);

  const active = (href: string) => (href === "/account" ? pathname === href : pathname.startsWith(href));

  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        <LuxNav root />
        <main className="relative z-10 mx-auto max-w-5xl px-5 pb-20 pt-28 md:px-8 md:pt-32">
          <nav aria-label={t("account.tabs")} className="flex gap-1 overflow-x-auto rounded-full border border-[rgba(255,236,229,0.08)] bg-white/[0.02] p-1 sm:inline-flex">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active(tab.href) ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition ${
                  active(tab.href) ? "bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white" : "text-[#b8a6a1] hover:text-white"
                }`}
              >
                {t(tab.label)}
              </Link>
            ))}
          </nav>

          <div className="mt-8">
            {account.status === "member" ? (
              children
            ) : (
              <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
                <Spinner /> {t("account.loading")}
              </p>
            )}
          </div>
        </main>
        <div className="relative z-10">
          <LuxFooter />
        </div>
      </div>
    </LuxProvider>
  );
}
