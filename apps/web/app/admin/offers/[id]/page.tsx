"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { OfferForm, type EditableOffer } from "@/components/offers/offer-form";
import { AdminPageHead } from "../../_lib/ui";

// Modifier ou retirer une offre MISTERDOU. Les offres des vendeurs restent
// les leurs : la console ne peut que les désactiver.
export default function EditAdminOfferPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [offer, setOffer] = useState<EditableOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    request<EditableOffer>(`/api/v1/admin/offerings/${id}`)
      .then(setOffer)
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "Offre introuvable."));
  }, [id]);

  async function remove() {
    if (!window.confirm("Retirer cette offre du site ?")) return;
    setRemoving(true);
    setError(null);
    try {
      await request(`/api/v1/admin/offerings/${id}`, { method: "DELETE", body: JSON.stringify({}) });
      router.push("/admin/offers");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Retrait impossible.");
      setRemoving(false);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Gestion de la plateforme"
        title="Modifier l’offre"
        action={
          <Link href="/admin/offers" className="dash-btn dash-btn-ghost">
            Retour aux offres
          </Link>
        }
      />
      <div className="mt-6 max-w-3xl space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        {!offer && !error && (
          <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
            <Spinner /> Chargement de l’offre…
          </p>
        )}
        {offer && (
          <>
            <OfferForm apiBase="/api/v1/admin/offerings" offer={offer} onDone={() => router.push("/admin/offers")} doneLabel="Terminer" />
            <div className="dash-card p-5">
              <h2 className="text-[15px] font-semibold text-white">Retirer l’offre</h2>
              <p className="mb-4 mt-1 text-[12px] text-[#8f7d77]">Elle disparaît du site. Impossible pendant un achat en cours.</p>
              <button type="button" onClick={() => void remove()} disabled={removing} className="dash-btn dash-btn-ghost !text-[#fca5a5] disabled:opacity-60">
                {removing && <Spinner />} Retirer l’offre
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
