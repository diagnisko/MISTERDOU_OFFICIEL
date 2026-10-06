"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { errorMessage, request } from "@/lib/api";
import { Alert, Button } from "@/components/ui";
import { buildQuery } from "../_lib/api";
import { MemberDossierModal } from "../_lib/member-dossier";
import { PasswordConfirmDialog } from "@/components/password-confirm";
import { useAdminList } from "../_lib/hooks";
import {
  AdminModal,
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
  formatCell,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Clients — port de la vue « clients » de la console (colones + action
// suspendre/réactiver) avec pagination et recherche pilotées par l'API.
// GET  /admin/clients            { page, perPage, q, kyc } (inscrits récents d'abord)
// PATCH /admin/clients/:id/status { status, reason }
// POST  /admin/clients/:id/password-reset-link  (ADMIN : lien à transmettre au client)
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
  role: string;
  _count: { orders: number };
};

type KycFilter = "all" | "verified" | "pending" | "rejected" | "none";

const KYC_TABS: Array<{ value: KycFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "verified", label: "Vérifiés" },
  { value: "pending", label: "En attente" },
  { value: "rejected", label: "Refusés" },
  { value: "none", label: "Non vérifiés" },
];

const COLUMNS = [
  { key: "firstName", label: "Client" },
  { key: "createdAt", label: "Inscrit le" },
  { key: "email", label: "E-mail" },
  { key: "phoneNumber", label: "Téléphone" },
  { key: "kycStatus", label: "Identité" },
  { key: "status", label: "Compte" },
  { key: "_count", label: "Commandes" },
];

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsView />
    </Suspense>
  );
}

function ClientsView() {
  // Recherche lancée depuis l'en-tête de la console : ?q=… (et ?view=id pour ouvrir la fiche).
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [kyc, setKyc] = useState<KycFilter>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(params.get("view"));
  const [target, setTarget] = useState<{ row: ClientRow; next: string } | null>(null);
  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<ClientRow | null>(null);

  async function deleteClient(row: ClientRow, password: string) {
    await request(`/api/v1/admin/clients/${row.id}`, { method: "DELETE", body: JSON.stringify({ password }) });
    setDeleting(null);
    await list.refresh("Compte supprimé : données personnelles effacées, sessions coupées.");
  }

  // Mot de passe oublié sans e-mail : lien (30 min) à envoyer au client (WhatsApp…).
  async function createResetLink(row: ClientRow) {
    setBusy(row.id);
    setResetError(null);
    setCopied(false);
    try {
      const res = await request<{ link: string }>(`/api/v1/admin/clients/${row.id}/password-reset-link`, { method: "POST", body: "{}" });
      setResetLink({ email: String((row as unknown as Record<string, unknown>).email ?? ""), link: res.link });
    } catch (err) {
      setResetError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const list = useAdminList<ClientRow>(
    `/api/v1/admin/clients${buildQuery({ page, perPage, q: search || undefined, kyc: kyc === "all" ? undefined : kyc })}`,
  );
  const counts = (list.extra.counts ?? null) as Record<KycFilter, number> | null;

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
          <p className="mt-2 text-sm text-stone-400">Inscrits récemment en premier. Recherche par nom, e-mail ou téléphone.</p>
        </div>
        <SearchBar
          placeholder="Nom, e-mail ou téléphone"
          initial={search}
          onSearch={(query) => {
            setSearch(query);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4">
        <FilterTabs
          value={kyc}
          options={KYC_TABS.map((tab) => ({ value: tab.value, label: counts ? `${tab.label} · ${counts[tab.value] ?? 0}` : tab.label }))}
          onChange={(value) => {
            setKyc(value as KycFilter);
            setPage(1);
          }}
        />
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />
      {resetError && (
        <div className="mt-4">
          <Alert tone="danger">{resetError}</Alert>
        </div>
      )}

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
                      {column.key === "firstName" ? (
                        <span className="flex items-center gap-2">
                          <span className="max-w-[180px] truncate">{[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}</span>
                          {row.role === "VENDOR" && (
                            <span className="rounded-full border border-[rgba(255,160,112,0.35)] bg-[rgba(255,106,50,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#ffb08a]">
                              Vendeur
                            </span>
                          )}
                        </span>
                      ) : (
                        formatCell(data[column.key], column.key)
                      )}
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
                    <RowAction label="Supprimer" tone="danger" onClick={() => setDeleting(row)} />
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
      {resetLink && (
        <AdminModal title="Lien de réinitialisation" onClose={() => setResetLink(null)}>
          <p className="text-sm text-stone-300">
            Envoyez ce lien à {resetLink.email || "ce client"} (WhatsApp, e-mail). Il est valable 30 minutes et ne sert qu’une fois.
          </p>
          <p className="mt-3 break-all rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[12.5px] text-stone-200">{resetLink.link}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResetLink(null)}>
              Fermer
            </Button>
            <Button
              onClick={() =>
                void navigator.clipboard?.writeText(resetLink.link).then(() => setCopied(true))
              }
            >
              {copied ? "Copié" : "Copier le lien"}
            </Button>
          </div>
        </AdminModal>
      )}
      {viewing && (
        <MemberDossierModal
          url={`/api/v1/admin/clients/${viewing}`}
          onClose={() => setViewing(null)}
          actions={
            (() => {
              const row = list.items.find((item) => item.id === viewing);
              return row ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-sm text-[12px] leading-relaxed text-[#8f7d77]">
                    Mot de passe oublié ? Créez un lien à lui envoyer (WhatsApp, e-mail) : valable 30 minutes, une seule fois.
                  </p>
                  <Button variant="outline" loading={busy === row.id} onClick={() => void createResetLink(row)}>
                    Lien de nouveau mot de passe
                  </Button>
                </div>
              ) : null;
            })()
          }
        />
      )}
      {deleting && (
        <PasswordConfirmDialog
          title="Supprimer ce compte"
          message={
            <>
              Le compte <strong className="text-stone-100">{String((deleting as unknown as Record<string, unknown>).email ?? "")}</strong> sera
              anonymisé : nom, e-mail, téléphone, photo et accès effacés, sessions coupées, offres retirées s’il vend. Ses commandes
              passées restent pour la comptabilité. Impossible si une commande, un retrait ou un solde est en cours.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={(password) => deleteClient(deleting, password)}
        />
      )}
    </>
  );
}
