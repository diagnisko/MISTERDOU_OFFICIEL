"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { OfferForm, type EditableOffer } from "@/components/offers/offer-form";
import { AdminPageHead } from "../../_lib/ui";
import { PasswordConfirmDialog } from "@/components/password-confirm";

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

  async function remove(password: string) {
    await request(`/api/v1/admin/offerings/${id}`, { method: "DELETE", body: JSON.stringify({ password }) });
    setRemoving(false);
    router.push("/admin/offers");
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
              <button type="button" onClick={() => setRemoving(true)} className="dash-btn dash-btn-ghost !text-[#fca5a5]">
                Retirer l’offre
              </button>
            </div>
          </>
        )}
      </div>
      {removing && offer && (
        <PasswordConfirmDialog
          title="Retirer cette offre"
          message="Elle disparaît du site. Impossible pendant un achat en cours."
          confirmLabel="Retirer l’offre"
          onClose={() => setRemoving(false)}
          onConfirm={remove}
        />
      )}
    </>
  );
}
