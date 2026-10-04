"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { DashHeading } from "@/components/dash/dash-ui";
import { OfferForm, type EditableOffer } from "@/components/offers/offer-form";
import { SellerFrame } from "@/components/seller/seller-frame";
import { useT } from "@/lib/i18n";

// Modifier ou retirer une offre du vendeur.
export default function EditSellerOfferPage() {
  const t = useT();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [offer, setOffer] = useState<EditableOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    request<EditableOffer>(`/api/v1/seller/offers/${id}`)
      .then(setOffer)
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : t("offer.loadFailed")));
  }, [id, t]);

  async function remove() {
    if (!window.confirm(t("offer.removeConfirm"))) return;
    setRemoving(true);
    setError(null);
    try {
      await request(`/api/v1/seller/offers/${id}`, { method: "DELETE", body: JSON.stringify({}) });
      router.push("/seller");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("offer.saveFailed"));
      setRemoving(false);
    }
  }

  return (
    <SellerFrame>
      <DashHeading
        greeting={t("seller.area")}
        title={t("offer.editTitle")}
      />
      <div className="mt-6 max-w-3xl space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        {!offer && !error && (
          <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
            <Spinner /> {t("offer.loading")}
          </p>
        )}
        {offer && (
          <>
            <OfferForm apiBase="/api/v1/seller/offers" offer={offer} onDone={() => router.push("/seller")} doneLabel={t("offer.finish")} />
            <div className="dash-card p-5">
              <h2 className="text-[15px] font-semibold text-white">{t("offer.removeTitle")}</h2>
              <p className="mb-4 mt-1 text-[12px] text-[#8f7d77]">{t("offer.removeLead")}</p>
              <button type="button" onClick={() => void remove()} disabled={removing} className="dash-btn dash-btn-ghost !text-[#fca5a5] disabled:opacity-60">
                {removing && <Spinner />} {t("offer.remove")}
              </button>
            </div>
          </>
        )}
      </div>
    </SellerFrame>
  );
}
