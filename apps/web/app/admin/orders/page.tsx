"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { buildQuery } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import { CredentialKeyButton } from "../_lib/credential-key";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
  NoticeAlert,
  Pagination,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
  formatCell,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Commandes — port de la vue « orders » de la console.
// GET /admin/orders { page, perPage, q } — action : « Clé d'accès » du compte
// acheté (afficher, saisir ou remplacer ; l'acheteur la voit aussitôt).
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: string;
  totalAmount: number;
  createdAt: string;
  buyer: { id: string; email: string; firstName: string | null; lastName: string | null };
  payments: { status: string; amount: number; type: string }[];
  item: { productId: string; title: string; hasCredentials: boolean } | null;
};

const COLUMNS = [
  { key: "orderNumber", label: "Commande" },
  { key: "buyer", label: "Client" },
  { key: "totalAmount", label: "Montant" },
  { key: "paymentMode", label: "Mode" },
  { key: "status", label: "État" },
  { key: "createdAt", label: "Créée" },
];

export default function AdminOrdersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const list = useAdminList<OrderRow>(
    `/api/v1/admin/orders${buildQuery({ page, perPage, q: search || undefined })}`,
  );

  return (
    <>
      <AdminPageHead
        kicker="Gestion de la plateforme"
        title="Commandes"
        meta="Suivi des commandes"
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Suivi</p>
          <p className="mt-2 text-sm text-stone-400">Recherche par numéro de commande ou e-mail acheteur.</p>
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
              return (
                <tr key={row.id} className="transition hover:bg-white/[0.025]">
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3.5 text-stone-300">
                      {formatCell(data[column.key], column.key)}
                    </td>
                  ))}
                  <td className="px-4 py-3.5">
                    {row.item ? (
                      <CredentialKeyButton productId={row.item.productId} missing={!row.item.hasCredentials} />
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
    </>
  );
}
