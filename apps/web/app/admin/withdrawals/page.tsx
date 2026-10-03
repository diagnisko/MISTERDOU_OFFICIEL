"use client";

import { useState, type FormEvent } from "react";
import { WITHDRAWAL_STATUSES } from "@misterdou/shared";
import { errorMessage, formatXof, request, uploadFile } from "@/lib/api";
import { Alert, Button, Field, StatusBadge, TextInput } from "@/components/ui";
import { buildQuery } from "../_lib/api";
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
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Retraits vendeurs — l'équipe envoie l'argent elle-même par Wave
// au numéro choisi par le vendeur, puis joint la capture de l'envoi. Le
// vendeur répond ensuite « Reçu » ou « Pas reçu ».
// GET  /admin/withdrawals { page, perPage, status, q }
// POST /admin/withdrawals/:id/processing { etaMinutes }            (PENDING)
// POST /admin/withdrawals/:id/approve    { proofKey, paymentReference? }
// POST /admin/withdrawals/:id/reject     { reason }
// GET  /admin/withdrawals/:id/proof      (capture de l'envoi)
// ---------------------------------------------------------------------------

type WithdrawalRow = {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
  processedAt: string | null;
  rejectionReason: string | null;
  paymentReference: string | null;
  processingStartedAt: string | null;
  etaMinutes: number | null;
  payout: { method: string; phoneNumber: string } | null;
  hasProof: boolean;
  sellerConfirmedAt: string | null;
  sellerDisputedAt: string | null;
  sellerDisputeNote: string | null;
  seller: {
    id: string;
    user: { id: string; email: string; firstName: string | null; lastName: string | null };
  };
  requestedBy: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
};

type Action = { row: WithdrawalRow; kind: "approve" | "reject" | "processing" } | null;

const METHOD_LABEL: Record<string, string> = { WAVE: "Wave" };
const ETAS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 heure" },
  { minutes: 720, label: "12 heures" },
];

const STATUS_TABS = [
  { value: "", label: "Tous" },
  ...WITHDRAWAL_STATUSES.map((status) => ({
    value: status,
    label:
      status === "PENDING"
        ? "En attente"
        : status === "APPROVED"
          ? "Envoyé"
          : status === "PROCESSING"
            ? "En traitement"
            : status === "COMPLETED"
              ? "Reçu par le vendeur"
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

  async function markPaid(id: string, proofKey: string, paymentReference: string) {
    list.setNotice(null);
    await request(`/api/v1/admin/withdrawals/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ proofKey, paymentReference: paymentReference || undefined }),
    });
    setAction(null);
    await list.refresh("Retrait marqué comme envoyé : le vendeur a reçu la capture et doit confirmer la réception.");
  }

  async function startProcessing(id: string, etaMinutes: number) {
    list.setNotice(null);
    await request(`/api/v1/admin/withdrawals/${id}/processing`, {
      method: "POST",
      body: JSON.stringify({ etaMinutes }),
    });
    setAction(null);
    await list.refresh("Retrait pris en charge : le vendeur connaît le délai.");
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
        meta="Envoyez l’argent au numéro du vendeur, puis joignez la capture de l’envoi."
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
          <DataTable columns={["Montant", "Vendeur", "Envoyer à", "Demandé le", "Statut", "Envoi"]} minWidth={980}>
            {list.items.map((row) => (
              <tr key={row.id} className="transition hover:bg-white/[0.025]">
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-200">
                  {formatXof(Number(row.amount))}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3.5 text-stone-300">{sellerLabel(row)}</td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-200">
                  {row.payout ? (
                    <>
                      <span className="block text-[11px] uppercase tracking-[0.12em] text-stone-500">
                        {METHOD_LABEL[row.payout.method] ?? row.payout.method}
                      </span>
                      <span className="font-mono" dir="ltr">{row.payout.phoneNumber}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {new Date(row.requestedAt).toLocaleDateString("fr-FR")}
                </td>
                <td className="px-4 py-3.5">
                  <StatusCell row={row} />
                </td>
                <td className="max-w-[180px] px-4 py-3.5 text-stone-300">
                  {row.hasProof ? (
                    <a
                      href={`/api/v1/admin/withdrawals/${row.id}/proof`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#ff8a5c] hover:underline"
                    >
                      Voir la capture
                    </a>
                  ) : (
                    "—"
                  )}
                  {row.paymentReference && <span className="block truncate text-[11px] text-stone-500">{row.paymentReference}</span>}
                </td>
                <td className="px-4 py-3.5">
                  {row.status === "PENDING" || row.status === "PROCESSING" ? (
                    <span className="flex flex-wrap gap-3">
                      {row.status === "PENDING" && (
                        <RowAction label="Prendre en charge" onClick={() => setAction({ row, kind: "processing" })} />
                      )}
                      <RowAction label="Payé" onClick={() => setAction({ row, kind: "approve" })} />
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
        <PaidModal row={action.row} onClose={() => setAction(null)} onSubmit={markPaid} />
      )}

      {action?.kind === "processing" && (
        <AdminModal title="Prendre en charge ce retrait" onClose={() => setAction(null)}>
          <p className="text-sm text-stone-300">Délai annoncé au vendeur pour recevoir {formatXof(action.row.amount)} :</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ETAS.map((eta) => (
              <Button key={eta.minutes} variant="outline" onClick={() => void startProcessing(action.row.id, eta.minutes)}>
                {eta.label}
              </Button>
            ))}
          </div>
        </AdminModal>
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

/** « Payé » : capture de l'envoi obligatoire, référence facultative. */
function PaidModal({
  row,
  onClose,
  onSubmit,
}: {
  row: WithdrawalRow;
  onClose: () => void;
  onSubmit: (id: string, proofKey: string, reference: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError("Ajoutez la capture de l’envoi.");
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadFile(file, "withdrawal_proof");
      await onSubmit(row.id, uploaded.key, reference.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Retrait envoyé" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-sm text-stone-300">
          Envoyez <strong className="text-white">{formatXof(row.amount)}</strong>
          {row.payout ? (
            <>
              {" "}par {METHOD_LABEL[row.payout.method] ?? row.payout.method} au{" "}
              <span className="font-mono text-white" dir="ltr">{row.payout.phoneNumber}</span>
            </>
          ) : null}
          , puis joignez la capture de l’envoi : le vendeur la verra et confirmera la réception.
        </p>
        <Field label="Capture de l’envoi" hint="Image JPEG, PNG ou WebP, 8 Mo maximum." required>
          <TextInput
            required
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-stone-200"
          />
        </Field>
        <Field label="Référence de l’envoi (facultative)">
          <TextInput value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} placeholder="ex. ID de transaction Wave" />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" loading={busy}>
            Marquer comme envoyé
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}

function StatusCell({ row }: { row: WithdrawalRow }) {
  return (
    <span className="block">
      <StatusBadge status={row.status} />
      {row.status === "APPROVED" && !row.sellerDisputedAt && (
        <span className="mt-1 block text-[10px] text-stone-500">En attente du « Reçu » du vendeur</span>
      )}
      {row.status === "APPROVED" && row.sellerDisputedAt && (
        <span title={row.sellerDisputeNote ?? undefined} className="mt-1 block max-w-[200px] text-[10.5px] text-[#fca5a5]">
          Pas reçu selon le vendeur{row.sellerDisputeNote ? ` : ${row.sellerDisputeNote}` : ""}
        </span>
      )}
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
