"use client";

import { Suspense } from "react";
import { ChatInbox } from "@/components/chat/product-chat";

export default function MyDiscussionsPage() {
  return (
    <section>
      <h1 className="mb-4 text-[20px] font-semibold text-white">Mes discussions</h1>
      <Suspense>
        <ChatInbox
          source="mine"
          basePath="/account/messages"
          emptyText="Vous n’avez encore écrit à aucun vendeur. Sur la fiche d’un compte, touchez « Discuter avec le vendeur » pour poser vos questions."
        />
      </Suspense>
    </section>
  );
}
