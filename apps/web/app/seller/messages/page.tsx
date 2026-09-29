"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashShell } from "@/components/dash/dash-ui";
import { ChatInbox } from "@/components/chat/product-chat";
import { SELLER_NAV } from "@/components/seller/seller-nav";
import { Spinner } from "@/components/ui";
import { displayName, logoutAccount, useAccount } from "@/lib/account";

export default function SellerMessagesPage() {
  const account = useAccount();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (account.status === "guest") router.replace("/login?next=/seller/messages");
  }, [account.status, router]);

  if (account.status !== "member") {
    return (
      <div data-lux className="dash-root grid place-items-center text-sm text-[#b8a6a1]">
        <span className="flex items-center gap-3">
          <Spinner /> Ouverture de l’espace vendeur…
        </span>
      </div>
    );
  }

  return (
    <DashShell
      nav={SELLER_NAV}
      areaLabel="Espace vendeur"
      user={{ name: displayName(account.user), email: account.user.email }}
      loggingOut={loggingOut}
      onLogout={() => {
        setLoggingOut(true);
        void logoutAccount().finally(() => router.replace("/"));
      }}
    >
      <h1 className="mb-1 text-[22px] font-semibold text-white">Discussions clients</h1>
      <p className="mb-5 text-[13px] text-[#8f7d77]">Les questions des acheteurs sur vos comptes. L’équipe MISTERDOU peut aussi répondre à votre place.</p>
      <Suspense>
        <ChatInbox source="inbox" basePath="/seller/messages" emptyText="Aucune question pour l’instant. Elles apparaîtront ici dès qu’un client vous écrit." />
      </Suspense>
    </DashShell>
  );
}
