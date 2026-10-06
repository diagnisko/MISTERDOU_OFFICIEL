"use client";

import { useEffect, useState } from "react";
import { formatXof, request } from "@/lib/api";
import { Alert, Button, Spinner } from "@/components/ui";
import { errorMessage } from "../_lib/api";
import { AdminModal } from "../_lib/ui";

// ---------------------------------------------------------------------------
// Examen d'une offre de vendeur avant sa mise en ligne :
// GET  /admin/offerings/:id/review  (contenu, médias, vendeur)
// POST /admin/offerings/:id/review  { decision: "approve" } | { decision: "reject", reason }
// ---------------------------------------------------------------------------

type Review = {
  id: string;
  slug: string;
  status: string;
  title: string;
  description: string;
  division: string;
  teamPower: number;
  coins: number;
  extraInfo: string | null;
  basePrice: number;
  paymentMode: "ONE_TIME" | "INSTALLMENTS";
  installmentMonths: number | null;
  installmentDownPayment: number | null;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
  hasCredentials: boolean;
  media: Array<{ id: string; url: string; video: boolean }>;
  seller: { id: string; name: string; email: string } | null;
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-[#8f7d77]">{label}</p>
      <p className="mt-0.5 text-[13.5px] font-medium text-stone-100">{value}</p>
    </div>
  );
}

export function OfferReviewModal({ productId, onClose, onDone }: { productId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [offer, setOffer] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<Review>(`/api/v1/admin/offerings/${productId}/review`)
      .then(setOffer)
      .catch((err) => setError(errorMessage(err)));
  }, [productId]);

  async function decide(body: { decision: "approve" } | { decision: "reject"; reason: string }) {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/admin/offerings/${productId}/review`, { method: "POST", body: JSON.stringify(body) });
      onDone(
        body.decision === "approve"
          ? "Offre validée : elle est en ligne et le vendeur est prévenu."
          : "Offre refusée : le vendeur a reçu le motif et peut la corriger.",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const pending = offer?.status === "PENDING_REVIEW";

  return (
    <AdminModal title="Examiner l’offre" onClose={onClose} width="max-w-3xl">
      {!offer && !error && (
        <p className="flex items-center gap-2 text-sm text-stone-400">
          <Spinner /> Chargement de l’offre…
        </p>
      )}
      {offer && (
        <div className="space-y-5">
          <div>
            <p className="text-[12px] text-[#8f7d77]">
              {offer.seller ? `Vendeur : ${offer.seller.name} · ${offer.seller.email}` : "Offre MISTERDOU"} · envoyée le{" "}
              {new Date(offer.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            </p>
            <h3 className="mt-1 text-[19px] font-semibold text-stone-50">{offer.title}</h3>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Prix" value={formatXof(offer.basePrice)} />
            <Fact label="Puissance" value={`${offer.teamPower.toLocaleString("fr-FR")} OVR`} />
            <Fact label="Pièces" value={offer.coins.toLocaleString("fr-FR")} />
            <Fact label="Division" value={offer.division} />
          </div>
          <p className="text-[13px] text-stone-300">
            Paiement :{" "}
            {offer.paymentMode === "INSTALLMENTS"
              ? `mensualités — apport ${formatXof(offer.installmentDownPayment ?? 0)} puis ${offer.installmentMonths} mois`
              : "comptant"}
            {" · "}
            Identifiants {offer.hasCredentials ? "enregistrés ✓" : "manquants ✗"}
          </p>

          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7d77]">Description</p>
            <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-stone-200">{offer.description}</p>
            {offer.extraInfo && <p className="mt-2 whitespace-pre-line text-[13px] text-stone-400">{offer.extraInfo}</p>}
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7d77]">Photos et vidéos ({offer.media.length})</p>
            {offer.media.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-[#fbbf24]">Aucune photo pour l’instant : le vendeur peut encore en ajouter.</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {offer.media.map((m) =>
                  m.video ? (
                    <video key={m.id} src={m.url} controls preload="metadata" className="aspect-video w-full rounded-xl bg-black object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                      <img src={m.url} alt="" className="aspect-video w-full rounded-xl object-cover" />
                    </a>
                  ),
                )}
              </div>
            )}
          </div>

          {!pending && (
            <Alert tone="warning">
              Cette offre n’attend plus de validation{offer.rejectedReason ? ` (refusée : « ${offer.rejectedReason} »)` : ""}.
            </Alert>
          )}

          {pending && rejecting && (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">Motif du refus (envoyé au vendeur)</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={300}
                autoFocus
                placeholder="Ex. : photos floues, prix incohérent avec la puissance, description incomplète…"
                className="dash-input min-h-[88px] w-full py-2.5"
              />
            </label>
          )}
          {error && <Alert tone="danger">{error}</Alert>}

          {pending && (
            <div className="flex flex-wrap justify-end gap-2">
              {rejecting ? (
                <>
                  <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                    Retour
                  </Button>
                  <Button
                    variant="outline"
                    loading={busy}
                    disabled={reason.trim().length < 5}
                    onClick={() => void decide({ decision: "reject", reason: reason.trim() })}
                  >
                    Refuser l’offre
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                    Refuser…
                  </Button>
                  <Button loading={busy} onClick={() => void decide({ decision: "approve" })}>
                    Valider et mettre en ligne
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!offer && error && <Alert tone="danger">{error}</Alert>}
    </AdminModal>
  );
}
