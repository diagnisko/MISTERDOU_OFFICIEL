"use client";

import { useState } from "react";
import { request } from "@/lib/api";
import { Button } from "@/components/ui";
import { buildQuery } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
  FieldModal,
  NoticeAlert,
  Pagination,
  RowAction,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
  formatCell,
} from "../_lib/ui";
import { PaymentProofsPanel } from "./payment-proofs";
import { useAdminAccess } from "../_lib/access";
import { PasswordConfirmDialog } from "@/components/password-confirm";

// ---------------------------------------------------------------------------
// Paiements — port de la vue « payments » de la console + remboursement.
// GET  /admin/payments             { page, perPage, q }
// POST /admin/payments/:id/refund  { reason }  (uniquement statut SUCCESS)
// ---------------------------------------------------------------------------

type PaymentRow = {
  id: string;
  paymentNumber: string;
  providerReference: string | null;
  type: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  user: { email: string; firstName: string | null; lastName: string | null } | null;
  orderId: string | null;
  order: { orderNumber: string } | null;
};

const COLUMNS = [
  { key: "paymentNumber", label: "Transaction" },
  { key: "providerReference", label: "Référence" },
  { key: "user", label: "Compte" },
  { key: "amount", label: "Montant" },
  { key: "type", label: "Type" },
  { key: "status", label: "État" },
];

export default function PaymentsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<PaymentRow | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<PaymentRow | null>(null);
  const { isAdmin } = useAdminAccess();

  const list = useAdminList<PaymentRow>(
    `/api/v1/admin/payments${buildQuery({ page, perPage, q: search || undefined })}`,
  );

  async function refund(id: string, reason: string) {
    setBusy(id);
    list.setNotice(null);
    try {
      await request(`/api/v1/admin/payments/${id}/refund`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setRefundTarget(null);
      await list.refresh("Remboursement enregistré et journalisé.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Gestion de la plateforme"
        title="Paiements"
        meta="Transactions enregistrées"
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <PaymentProofsPanel onReviewed={() => void list.refresh()} />

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Paiements reçus</p>
          <p className="mt-2 text-sm text-stone-400">
            L’argent réellement encaissé. Les clients qui n’ont encore rien envoyé n’apparaissent pas ici : ils voient leur paiement en
            attente dans leur espace.
          </p>
        </div>
        <SearchBar
          placeholder="Référence ou nom"
          onSearch={(query) => {
            setSearch(query);
            setPage(1);
          }}
        />
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading />
        ) : list.items.length === 0 ? (
          <TableEmpty />
        ) : (
          <DataTable columns={COLUMNS.map((column) => column.label)}>
            {list.items.map((row) => {
              const data = row as unknown as Record<string, unknown>;
              const refundable = row.status === "SUCCESS";
              return (
                <tr key={row.id} className="transition hover:bg-white/[0.025]">
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3.5 text-stone-300">
                      {formatCell(data[column.key], column.key)}
                    </td>
                  ))}
                  <td className="px-4 py-3.5">
                    <span className="flex flex-wrap gap-2">
                      {refundable && (
                        <RowAction
                          label="Rembourser"
                          busy={busy === row.id}
                          onClick={() => setRefundTarget(row)}
                        />
                      )}
                      {/* Paiement de test (simulation) : retiré de l'historique et des statistiques. */}
                      {isAdmin && <RowAction label="Effacer (test)" tone="danger" onClick={() => setPurgeTarget(row)} />}
                      {!refundable && !isAdmin && <span className="text-stone-600">—</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </TableCard>

      <Pagination
        meta={list.meta}
        onPage={setPage}
        onPerPage={(size) => {
          setPerPage(size);
          setPage(1);
        }}
      />

      {purgeTarget && (
        <PasswordConfirmDialog
          title="Effacer ce paiement de test"
          message={
            purgeTarget.orderId ? (
              <>
                Ce paiement appartient à la commande <strong className="text-stone-100">{purgeTarget.order?.orderNumber}</strong> : toute la
                commande de test est effacée (paiements, preuves Wave, contrat et mensualités), et disparaît des statistiques. La part du
                vendeur est retirée de son solde. À utiliser seulement pour vos essais : un vrai paiement sert de preuve.
              </>
            ) : (
              <>
                Le paiement <strong className="text-stone-100">{purgeTarget.paymentNumber}</strong> est retiré de l’historique et des
                statistiques. Ce qu’il a activé (adhésion, contrat revendeur, mise en avant) reste actif. À utiliser seulement pour vos
                essais.
              </>
            )
          }
          confirmLabel="Effacer définitivement"
          onClose={() => setPurgeTarget(null)}
          onConfirm={async (password) => {
            await request(`/api/v1/admin/payments/${purgeTarget.id}/test`, { method: "DELETE", body: JSON.stringify({ password }) });
            const wasOrder = Boolean(purgeTarget.orderId);
            setPurgeTarget(null);
            await list.refresh(wasOrder ? "Commande de test effacée, avec ses paiements." : "Paiement de test effacé.");
          }}
        />
      )}

      {refundTarget && (
        <FieldModal
          title="Rembourser ce paiement"
          label="Motif du remboursement"
          hint="Envoyez d’abord le remboursement par Wave au numéro qui a payé. La part du vendeur lui est retirée et le client est prévenu. Motif : 5 caractères minimum, journalisé."
          minLength={5}
          maxLength={300}
          submitLabel="Rembourser"
          onClose={() => setRefundTarget(null)}
          onSubmit={(value) => refund(refundTarget.id, value)}
        />
      )}
    </>
  );
}
