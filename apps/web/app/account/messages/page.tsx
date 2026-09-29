"use client";

import { Suspense } from "react";
import { ChatInbox } from "@/components/chat/product-chat";
import { useT } from "@/lib/i18n";

export default function MyDiscussionsPage() {
  const t = useT();
  return (
    <section>
      <h1 className="mb-4 text-[20px] font-semibold text-white">{t("chat.myTitle")}</h1>
      <Suspense>
        <ChatInbox
          source="mine"
          basePath="/account/messages"
          emptyText={t("chat.myEmpty")}
        />
      </Suspense>
    </section>
  );
}
