"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashShell } from "@/components/dash/dash-ui";
import { ChatInbox } from "@/components/chat/product-chat";
import { sellerNav } from "@/components/seller/seller-nav";
import { Spinner } from "@/components/ui";
import { displayName, logoutAccount, useAccount } from "@/lib/account";
import { useT } from "@/lib/i18n";

export default function SellerMessagesPage() {
  const t = useT();
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
          <Spinner /> {t("seller.opening")}
        </span>
      </div>
    );
  }

  return (
    <DashShell
      nav={sellerNav(t)}
      areaLabel={t("seller.area")}
      user={{ name: displayName(account.user), email: account.user.email }}
      loggingOut={loggingOut}
      onLogout={() => {
        setLoggingOut(true);
        void logoutAccount().finally(() => router.replace("/"));
      }}
    >
      <h1 className="mb-1 text-[22px] font-semibold text-white">{t("sellermsg.title")}</h1>
      <p className="mb-5 text-[13px] text-[#8f7d77]">{t("sellermsg.lead")}</p>
      <Suspense>
        <ChatInbox source="inbox" basePath="/seller/messages" emptyText={t("sellermsg.empty")} />
      </Suspense>
    </DashShell>
  );
}
