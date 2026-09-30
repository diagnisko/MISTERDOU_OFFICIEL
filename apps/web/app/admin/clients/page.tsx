"use client";

import { useState } from "react";
import { request } from "@/lib/api";
import { Button } from "@/components/ui";
import { buildQuery } from "../_lib/api";
import { MemberDossierModal } from "../_lib/member-dossier";
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
// Clients — port de la vue « clients » de la console (colones + action
// suspendre/réactiver) avec pagination et recherche pilotées par l'API.
// GET  /admin/clients            { page, perPage, q }
// PATCH /admin/clients/:id/status { status, reason }
// ---------------------------------------------------------------------------

type ClientRow = {
  id: string;
  email: string;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string;
  kycStatus: string;
  createdAt: string;
  _count: { orders: number };
};

const COLUMNS = [
  { key: "firstName", label: "Client" },
  { key: "email", label: "E-mail" },
  { key: "phoneNumber", label: "Téléphone" },
  { key: "kycStatus", label: "Identité" },
  { key: "status", label: "Compte" },
  { key: "_count", label: "Commandes" },
];

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [target, setTarget] = useState<{ row: ClientRow; next: string } | null>(null);

  const list = useAdminList<ClientRow>(
    `/api/v1/admin/clients${buildQuery({ page, perPage, q: search || undefined })}`,
  );

  async function changeStatus(id: string, status: string, reason: string) {
    setBusy(id);
    list.setNotice(null);
    try {
      await request(`/api/v1/admin/clients/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason }),
      });
      setTarget(null);
      await list.refresh("Modification enregistrée et journalisée.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Gestion de la plateforme"
        title="Clients"
        meta="Comptes clients et accès"
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Comptes</p>
          <p className="mt-2 text-sm text-stone-400">Recherche par nom, email ou téléphone.</p>
        </div>
        <SearchBar
          placeholder="Nom ou e-mail"
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
              const status = String(row.status ?? "");
              return (
                <tr key={row.id} className="transition hover:bg-white/[0.025]">
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3.5 text-stone-300">
                      {formatCell(data[column.key], column.key)}
                    </td>
                  ))}
                  <td className="flex gap-2 px-4 py-3.5">
                    <RowAction label="Voir la fiche" tone="muted" onClick={() => setViewing(row.id)} />
                    <RowAction
                      label={status === "ACTIVE" ? "Suspendre" : "Réactiver"}
                      busy={busy === row.id}
                      onClick={() =>
                        setTarget({ row, next: status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })
                      }
                    />
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

      {target && (
        <FieldModal
          title={
            target.next === "SUSPENDED" ? "Suspendre ce client" : "Réactiver ce client"
          }
          label="Motif de cette action"
          hint="Minimum 5 caractères — le motif est journalisé."
          minLength={5}
          maxLength={300}
          submitLabel={target.next === "SUSPENDED" ? "Suspendre" : "Réactiver"}
          onClose={() => setTarget(null)}
          onSubmit={(value) => changeStatus(target.row.id, target.next, value)}
        />
      )}
      {viewing && <MemberDossierModal url={`/api/v1/admin/clients/${viewing}`} onClose={() => setViewing(null)} />}
    </>
  );
}
