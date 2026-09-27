"use client";

import { useState } from "react";
import { WITHDRAWAL_STATUSES } from "@misterdou/shared";
import { formatXof, request } from "@/lib/api";
import { Button, StatusBadge } from "@/components/ui";
import { buildQuery } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
  FieldModal,
  FilterTabs,
  NoticeAlert,
  Pagination,
  RowAction,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Retraits vendeurs — GET /admin/withdrawals { page, perPage, status, q }
// POST /admin/withdrawals/:id/approve { paymentReference }  (PENDING)
// POST /admin/withdrawals/:id/reject   { reason }           (PENDING)
// ---------------------------------------------------------------------------

type WithdrawalRow = {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
  processedAt: string | null;
  rejectionReason: string | null;
  paymentReference: string | null;
  bankDetailsSnapshot: unknown;
  seller: {
    id: string;
    user: { id: string; email: string; firstName: string | null; lastName: string | null };
  };
  requestedBy: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
};

type Action = { row: WithdrawalRow; kind: "approve" | "reject" } | null;

const STATUS_TABS = [
  { value: "", label: "Tous" },
  ...WITHDRAWAL_STATUSES.map((status) => ({
    value: status,
    label:
      status === "PENDING"
        ? "En attente"
        : status === "APPROVED"
          ? "Approuvé"
          : status === "PROCESSING"
            ? "En traitement"
            : status === "COMPLETED"
              ? "Effectué"
              : status === "REJECTED"
                ? "Refusé"
                : "Annulé",
  })),
];

function sellerLabel(row: WithdrawalRow): string {
  const user = row.seller?.user;
  if (!user) return "—";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return user.email ?? (name || "—");
}

export default function WithdrawalsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [action, setAction] = useState<Action>(null);

  const list = useAdminList<WithdrawalRow>(
    `/api/v1/admin/withdrawals${buildQuery({
      page,
      perPage,
      status: status || undefined,
      q: search || undefined,
    })}`,
  );

  async function approve(id: string, paymentReference: string) {
    list.setNotice(null);
    await request(`/api/v1/admin/withdrawals/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ paymentReference }),
    });
    setAction(null);
    await list.refresh("Retrait approuvé et notifié.");
  }

  async function reject(id: string, reason: string) {
    list.setNotice(null);
    await request(`/api/v1/admin/withdrawals/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    setAction(null);
    await list.refresh("Retrait refusé et notifié.");
  }

  return (
    <>
      <AdminPageHead
        kicker="Trésorerie"
        title="Retraits"
        meta="Demandes de retrait des vendeurs — approbation manuelle."
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Demandes</p>
          <div className="mt-3">
            <FilterTabs
              value={status}
              options={STATUS_TABS}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <SearchBar
          placeholder="Vendeur ou référence"
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
          <TableLoading label="Chargement des retraits…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label="Aucune demande pour ce filtre." />
        ) : (
          <DataTable columns={["Montant", "Vendeur", "Demandé le", "Statut", "Traité le", "Référence"]} minWidth={900}>
            {list.items.map((row) => (
              <tr key={row.id} className="transition hover:bg-white/[0.025]">
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-200">
                  {formatXof(Number(row.amount))}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3.5 text-stone-300">{sellerLabel(row)}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {new Date(row.requestedAt).toLocaleDateString("fr-FR")}
                </td>
                <td className="px-4 py-3.5">
                  <StatusCell row={row} />
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {row.processedAt ? new Date(row.processedAt).toLocaleDateString("fr-FR") : "—"}
                </td>
                <td className="max-w-[180px] truncate px-4 py-3.5 text-stone-300">
                  {row.paymentReference ?? "—"}
                </td>
                <td className="px-4 py-3.5">
                  {row.status === "PENDING" ? (
                    <span className="flex flex-wrap gap-3">
                      <RowAction label="Approuver" onClick={() => setAction({ row, kind: "approve" })} />
                      <RowAction label="Refuser" tone="danger" onClick={() => setAction({ row, kind: "reject" })} />
                    </span>
                  ) : (
                    <span className="text-stone-600">—</span>
                  )}
                </td>
              </tr>
            ))}
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

      {action?.kind === "approve" && (
        <FieldModal
          title="Approuver ce retrait"
          label="Référence de paiement"
          hint="Minimum 3 caractères (référence bancaire, mobile money…)."
          placeholder="ex. WAVE-2026-001"
          minLength={3}
          maxLength={120}
          multiline={false}
          submitLabel="Approuver"
          onClose={() => setAction(null)}
          onSubmit={(value) => approve(action.row.id, value)}
        />
      )}

      {action?.kind === "reject" && (
        <FieldModal
          title="Refuser ce retrait"
          label="Motif du refus"
          hint="Minimum 5 caractères — le motif est transmis au vendeur."
          minLength={5}
          maxLength={300}
          submitLabel="Refuser"
          onClose={() => setAction(null)}
          onSubmit={(value) => reject(action.row.id, value)}
        />
      )}
    </>
  );
}

function StatusCell({ row }: { row: WithdrawalRow }) {
  return (
    <span className="block">
      <StatusBadge status={row.status} />
      {row.rejectionReason && (
        <span
          title={row.rejectionReason}
          className="mt-1 block max-w-[180px] truncate text-[10px] text-stone-500"
        >
          {row.rejectionReason}
        </span>
      )}
    </span>
  );
}
