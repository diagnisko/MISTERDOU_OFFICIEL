"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { buildQuery } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import { CredentialKeyButton } from "../_lib/credential-key";
import { useAdminAccess } from "../_lib/access";
import { PasswordConfirmDialog } from "@/components/password-confirm";
import { request } from "@/lib/api";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
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

  const { isAdmin } = useAdminAccess();
  const [purging, setPurging] = useState<OrderRow | null>(null);
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
                    <span className="flex flex-wrap gap-2">
                      {row.item ? (
                        <CredentialKeyButton productId={row.item.productId} missing={!row.item.hasCredentials} />
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                      {isAdmin && <RowAction label="Effacer (test)" tone="danger" onClick={() => setPurging(row)} />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </TableCard>

      {purging && (
        <PasswordConfirmDialog
          title="Effacer cette commande de test"
          message={
            <>
              La commande <strong className="text-stone-100">{purging.orderNumber}</strong> est effacée avec ses paiements, preuves Wave,
              échéancier et notifications : elle disparaît des statistiques. La part du vendeur est retirée de son solde et le compte
              est désactivé (à supprimer ou remettre en vente dans « Offres »). À utiliser uniquement pour un achat de test.
            </>
          }
          confirmLabel="Effacer définitivement"
          onClose={() => setPurging(null)}
          onConfirm={async (password) => {
            await request(`/api/v1/admin/orders/${purging.id}/test`, { method: "DELETE", body: JSON.stringify({ password }) });
            setPurging(null);
            await list.refresh("Commande de test effacée.");
          }}
        />
      )}

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
