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
  order: { orderNumber: string } | null;
};

const COLUMNS = [
  { key: "paymentNumber", label: "Transaction" },
  { key: "providerReference", label: "Référence PayTech" },
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

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Trésorerie</p>
          <p className="mt-2 text-sm text-stone-400">
            Recherche par numéro de transaction ou référence fournisseur.
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
                    {refundable ? (
                      <RowAction
                        label="Rembourser"
                        busy={busy === row.id}
                        onClick={() => setRefundTarget(row)}
                      />
                    ) : (
                      <span className="text-stone-600">—</span>
                    )}
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

      {refundTarget && (
        <FieldModal
          title="Rembourser ce paiement"
          label="Motif du remboursement"
          hint="Minimum 5 caractères — le motif est journalisé avec l’opération."
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
