"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LuxProvider } from "@/components/lux/lux-data";
import { LuxNav } from "@/components/lux/lux-nav";
import { LuxFooter } from "@/components/lux/lux-footer";
import { Spinner } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { useT } from "@/lib/i18n";

// Espace compte : même habillage que le site (pas de tableau de bord). On
// passe d'une page à l'autre par le menu du profil, dans l'en-tête.
export default function AccountLayout({ children }: { children: ReactNode }) {
  const account = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  useEffect(() => {
    if (account.status === "guest") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [account.status, pathname, router]);

  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />
        <LuxNav root />
        <main className="relative z-10 mx-auto max-w-5xl px-5 pb-20 pt-28 md:px-8 md:pt-32">
          {account.status === "member" ? (
            children
          ) : (
            <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
              <Spinner /> {t("account.loading")}
            </p>
          )}
        </main>
        <div className="relative z-10">
          <LuxFooter />
        </div>
      </div>
    </LuxProvider>
  );
}
