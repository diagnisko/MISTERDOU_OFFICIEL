"use client";

import { CodeQueue } from "@/components/codes/code-queue";
import { AdminPageHead } from "../_lib/ui";

// Codes de vérification demandés par les clients pour se connecter aux
// comptes achetés. Valables 10 minutes une fois envoyés.
export default function AdminCodesPage() {
  return (
    <div className="space-y-6">
      <AdminPageHead kicker="Commandes" title="Codes de vérification" meta="Comptes des vendeurs : le vendeur fournit le code, vous pouvez le faire à sa place. Le client le voit dès l’envoi (valable 10 minutes)." />
      <section className="dash-card p-5">
        <CodeQueue team />
      </section>
    </div>
  );
}
