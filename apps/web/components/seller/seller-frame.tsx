"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DashShell } from "@/components/dash/dash-ui";
import { sellerNav } from "@/components/seller/seller-nav";
import { displayName, logoutAccount, useAccount } from "@/lib/account";
import { useT } from "@/lib/i18n";

// Habillage des pages secondaires de l'espace vendeur (création d'offre…).
export function SellerFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const account = useAccount();
  const [leaving, setLeaving] = useState(false);
  const user = account.status === "member" ? account.user : null;

  async function logout() {
    setLeaving(true);
    await logoutAccount();
    router.replace("/");
  }

  return (
    <DashShell
      nav={sellerNav(t)}
      areaLabel={t("seller.area")}
      user={{ name: user ? displayName(user) : t("seller.fallbackName"), email: user?.email }}
      onLogout={() => void logout()}
      loggingOut={leaving}
    >
      {children}
    </DashShell>
  );
}
