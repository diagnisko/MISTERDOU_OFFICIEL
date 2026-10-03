"use client";

import { useCallback, useEffect, useState } from "react";
import { formatXof, request } from "@/lib/api";
import { Alert, Button, Spinner } from "@/components/ui";
import { ConfirmDialog, ErrorAlert, FieldModal, FilterTabs, NoticeAlert } from "../_lib/ui";

// ---------------------------------------------------------------------------
// Paiements Wave à vérifier — le client a payé avec le lien Wave Business et
// envoyé sa preuve. Valider livre le compte (identifiants, part du vendeur) ;
// refuser renvoie le motif au client, qui peut envoyer une nouvelle preuve.
// GET  /admin/payment-proofs?status=PENDING|APPROVED|REJECTED
// POST /admin/payment-proofs/:id/approve
// POST /admin/payment-proofs/:id/reject { reason }
// ---------------------------------------------------------------------------

type ProofStatus = "PENDING" | "APPROVED" | "REJECTED";

type Proof = {
  id: string;
  status: ProofStatus;
  amount: number;
  senderPhone: string;
  waveReference: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  client: { email: string | null; firstName: string | null; lastName: string | null; phoneNumber: string | null };
  label: string;
  payment: { id: string; paymentNumber: string; type: string; status: string };
  orderNumber: string | null;
  warnings: { productSold: boolean; referenceReusedBy: string[]; amountChanged: boolean };
};

type ProofList = { pendingCount: number; items: Proof[] };

const TABS = [
  { value: "PENDING", label: "À vérifier" },
  { value: "APPROVED", label: "Validés" },
  { value: "REJECTED", label: "Refusés" },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function clientName(proof: Proof) {
  const name = [proof.client.firstName, proof.client.lastName].filter(Boolean).join(" ");
  return name || proof.client.email || "Client";
}

export function PaymentProofsPanel({ onReviewed }: { onReviewed: () => void }) {
  const [status, setStatus] = useState<ProofStatus>("PENDING");
  const [data, setData] = useState<ProofList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<Proof | null>(null);
  const [rejecting, setRejecting] = useState<Proof | null>(null);
  const [zoom, setZoom] = useState<Proof | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await request<ProofList>(`/api/v1/admin/payment-proofs?status=${status}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [status]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // Nouvelles preuves : la file se met à jour toute seule.
  useEffect(() => {
    if (status !== "PENDING") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20_000);
    return () => clearInterval(id);
  }, [status, load]);

  async function approve(proof: Proof) {
    await request(`/api/v1/admin/payment-proofs/${proof.id}/approve`, { method: "POST", body: "{}" });
    setApproving(null);
    setNotice(`Paiement de ${formatXof(proof.amount)} validé : le client a reçu ses accès.`);
    await load();
    onReviewed();
  }

  async function reject(proof: Proof, reason: string) {
    await request(`/api/v1/admin/payment-proofs/${proof.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    setRejecting(null);
    setNotice("Preuve refusée : le client a reçu le motif et peut en envoyer une nouvelle.");
    await load();
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Paiements Wave</p>
          <h2 className="mt-2 text-[18px] font-semibold text-stone-50">
            Preuves à vérifier
            {data && data.pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-[rgba(255,106,50,0.18)] px-2.5 py-0.5 text-[12px] tabular-nums text-[#ffb38f]">
                {data.pendingCount}
              </span>
            )}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-400">
            Vérifiez dans Wave Business que le montant est bien arrivé depuis ce numéro, puis validez.
          </p>
        </div>
        <FilterTabs value={status} options={TABS} onChange={(value) => setStatus(value as ProofStatus)} />
      </div>

      <ErrorAlert error={error} />
      <NoticeAlert notice={notice} />

      {!data ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-stone-400">
          <Spinner /> Chargement des preuves…
        </p>
      ) : data.items.length === 0 ? (
        <p className="dash-card mt-5 p-5 text-sm text-stone-400">
          {status === "PENDING" ? "Aucun paiement à vérifier pour le moment." : "Aucune preuve dans cette liste."}
        </p>
      ) : (
        <ul className="mt-5 grid gap-4 lg:grid-cols-2">
          {data.items.map((proof) => (
            <li key={proof.id} className="dash-card flex gap-4 p-4">
              <button
                type="button"
                onClick={() => setZoom(proof)}
                className="h-36 w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30"
                aria-label="Agrandir la capture"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/v1/admin/payment-proofs/${proof.id}/file`} alt="Capture du reçu Wave" className="h-full w-full object-cover" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[22px] font-semibold tabular-nums text-white">{formatXof(proof.amount)}</p>
                <p className="mt-0.5 truncate text-[13px] text-stone-300">{proof.label}</p>
                <dl className="mt-2 space-y-0.5 text-[12.5px] text-stone-400">
                  <div>
                    <dt className="inline">Payé depuis : </dt>
                    <dd className="inline font-mono text-stone-200" dir="ltr">{proof.senderPhone}</dd>
                  </div>
                  {proof.waveReference && (
                    <div>
                      <dt className="inline">ID Wave : </dt>
                      <dd className="inline font-mono text-stone-200" dir="ltr">{proof.waveReference}</dd>
                    </div>
                  )}
                  <div className="truncate">
                    <dt className="inline">Client : </dt>
                    <dd className="inline text-stone-200">{clientName(proof)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Envoyée le </dt>
                    <dd className="inline">{when(proof.createdAt)}</dd>
                    {proof.orderNumber && <dd className="inline"> · {proof.orderNumber}</dd>}
                  </div>
                </dl>

                {proof.warnings.productSold && (
                  <p className="mt-2 text-[12px] text-[#fca5a5]">Attention : ce compte a déjà été vendu à un autre client.</p>
                )}
                {proof.warnings.referenceReusedBy.length > 0 && (
                  <p className="mt-2 text-[12px] text-[#fca5a5]">
                    ID Wave déjà utilisé pour {proof.warnings.referenceReusedBy.join(", ")}.
                  </p>
                )}
                {proof.warnings.amountChanged && (
                  <p className="mt-2 text-[12px] text-[#fbbf24]">Le montant de ce paiement a changé depuis l’envoi de la preuve.</p>
                )}

                {proof.status === "PENDING" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button className="!min-h-[36px] !px-4 !text-[12px]" onClick={() => setApproving(proof)}>
                      Valider le paiement
                    </Button>
                    <Button variant="ghost" className="!min-h-[36px] !px-4 !text-[12px]" onClick={() => setRejecting(proof)}>
                      Refuser
                    </Button>
                  </div>
                ) : proof.status === "REJECTED" ? (
                  <p className="mt-3 text-[12px] text-stone-400">
                    Refusée{proof.reviewedAt ? ` le ${when(proof.reviewedAt)}` : ""} : {proof.rejectionReason}
                  </p>
                ) : (
                  <p className="mt-3 text-[12px] text-[#6ee7b7]">Validée{proof.reviewedAt ? ` le ${when(proof.reviewedAt)}` : ""}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {approving && (
        <ConfirmDialog
          title="Valider ce paiement"
          confirmLabel="Oui, l’argent est arrivé"
          message={
            <>
              <p>
                Confirmez que <strong className="text-white">{formatXof(approving.amount)}</strong> sont bien arrivés sur
                Wave Business depuis le <span className="font-mono" dir="ltr">{approving.senderPhone}</span>.
              </p>
              <p className="mt-2 text-stone-400">
                Le client reçoit aussitôt les accès du compte et le vendeur est prévenu de la vente.
              </p>
              {approving.warnings.productSold && (
                <div className="mt-3">
                  <Alert tone="danger">Ce compte est déjà vendu : il faudra rembourser ce client.</Alert>
                </div>
              )}
            </>
          }
          onConfirm={() => approve(approving)}
          onClose={() => setApproving(null)}
        />
      )}

      {rejecting && (
        <FieldModal
          title="Refuser cette preuve"
          label="Motif transmis au client"
          hint="Exemple : aucun paiement reçu de ce numéro, montant incomplet… (5 caractères minimum)"
          minLength={5}
          maxLength={300}
          submitLabel="Refuser"
          onClose={() => setRejecting(null)}
          onSubmit={(reason) => reject(rejecting, reason)}
        />
      )}

      {zoom && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Capture du reçu Wave"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/admin/payment-proofs/${zoom.id}/file`}
            alt="Capture du reçu Wave"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </section>
  );
}
