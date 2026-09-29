"use client";

import { CodeQueue } from "@/components/codes/code-queue";
import { AdminPageHead } from "../_lib/ui";

// Codes de vérification demandés par les clients pour se connecter aux
// comptes achetés. Valables 10 minutes une fois envoyés.
export default function AdminCodesPage() {
  return (
    <div className="space-y-6">
      <AdminPageHead kicker="Commandes" title="Codes de vérification" meta="Le client voit le code dès l’envoi. Il reste valable 10 minutes." />
      <section className="dash-card p-5">
        <CodeQueue />
      </section>
    </div>
  );
}
