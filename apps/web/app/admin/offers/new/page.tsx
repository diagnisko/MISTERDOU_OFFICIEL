"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { OfferForm } from "@/components/offers/offer-form";
import { AdminPageHead } from "../../_lib/ui";

// Nouvelle offre MISTERDOU (sans vendeur), publiée dès l'enregistrement.
export default function NewAdminOfferPage() {
  const router = useRouter();
  return (
    <>
      <AdminPageHead
        kicker="Gestion de la plateforme"
        title="Nouvelle offre MISTERDOU"
        meta="Publiée dès l’enregistrement. Les identifiants sont chiffrés et remis uniquement à l’acheteur."
        action={
          <Link href="/admin/offers" className="dash-btn dash-btn-ghost">
            Retour aux offres
          </Link>
        }
      />
      <div className="mt-6 max-w-3xl">
        <OfferForm apiBase="/api/v1/admin/offerings" onDone={() => router.push("/admin/offers")} doneLabel="Terminer" />
      </div>
    </>
  );
}
