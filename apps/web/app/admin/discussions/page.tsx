"use client";

import { Suspense } from "react";
import { ChatInbox } from "@/components/chat/product-chat";
import { AdminPageHead } from "../_lib/ui";

// Toutes les discussions clients ↔ vendeurs. L'équipe voit l'auteur réel de
// chaque message et peut répondre, ou laisser le vendeur répondre.
export default function AdminDiscussionsPage() {
  return (
    <div className="space-y-6">
      <AdminPageHead kicker="Relation" title="Discussions sur les comptes" meta="Comptes MISTERDOU : l’équipe répond. Comptes des vendeurs : l’administrateur suit en lecture seule, le vendeur répond à son client." />
      <Suspense>
        <ChatInbox source="inbox" basePath="/admin/discussions" emptyText="Aucune discussion pour l’instant." />
      </Suspense>
    </div>
  );
}
