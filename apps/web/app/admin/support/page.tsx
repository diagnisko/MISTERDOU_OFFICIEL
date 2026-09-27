"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, SelectInput, StatusBadge, TextInput } from "@/components/ui";
import { errorMessage as envelopeMessage, request, requestPaged, buildQuery } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminModal,
  AdminPageHead,
  DataTable,
  ErrorAlert,
  FilterTabs,
  NoticeAlert,
  Pagination,
  RowAction,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_OPTIONS,
  personLabel,
  supportCategoryLabel,
  type SupportTicket,
} from "@/lib/support";
import { formatDateTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Support — GET /admin/support/tickets { page, perPage, status, category, q }
// PATCH /admin/support/tickets/:id { status?, assignedToId?, reason? }
// Liste d’assignation : GET /admin/managers (comptes actifs uniquement).
// ---------------------------------------------------------------------------

const PER_PAGE = 25;

type ManagerRow = {
  id: string;
  title: string | null;
  user: { id: string; email: string; firstName: string; lastName: string; status: string };
};

const STATUS_TABS = SUPPORT_STATUS_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const CATEGORY_OPTIONS = [
  { value: "", label: "Toutes catégories" },
  ...Object.entries(SUPPORT_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

export default function AdminSupportPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE);
  const [selected, setSelected] = useState<SupportTicket | null>(null);

  const list = useAdminList<SupportTicket>(
    `/api/v1/admin/support/tickets${buildQuery({
      page,
      perPage,
      status: status || undefined,
      category: category || undefined,
      q: search || undefined,
    })}`,
  );

  async function saveTicket(ticket: SupportTicket, payload: Record<string, unknown>) {
    list.setNotice(null);
    await request(`/api/v1/admin/support/tickets/${ticket.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setSelected(null);
    await list.refresh("Ticket mis à jour.");
  }

  return (
    <>
      <AdminPageHead
        kicker="Clients & support"
        title="Support"
        meta="Demandes d’aide des membres — statut, assignation et suivi."
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
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              Catégorie
            </span>
            <SelectInput
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              className="min-w-[190px]"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </label>
          <SearchBar
            placeholder="Sujet ou email de l’auteur"
            onSearch={(query) => {
              setSearch(query);
              setPage(1);
            }}
          />
        </div>
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading label="Chargement des demandes…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label="Aucune demande pour ce filtre." />
        ) : (
          <DataTable
            columns={["Code", "Sujet", "Catégorie", "Statut", "Signalé par", "Créée"]}
            minWidth={920}
          >
            {list.items.map((row) => (
              <tr key={row.id} className="transition hover:bg-white/[0.025]">
                <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] tracking-[0.08em] text-[var(--lux-gold-light)]">
                  {row.code}
                </td>
                <td className="max-w-[260px] truncate px-4 py-3.5 text-stone-200">{row.subject}</td>
                <td className="px-4 py-3.5 text-stone-300">{supportCategoryLabel(row.category)}</td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="max-w-[200px] truncate px-4 py-3.5 text-stone-300">
                  {personLabel(row.reporter)}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {formatDateTime(row.createdAt)}
                </td>
                <td className="px-4 py-3.5">
                  <RowAction label="Ouvrir" onClick={() => setSelected(row)} />
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

      {selected && (
        <TicketDetailModal
          ticket={selected}
          onClose={() => setSelected(null)}
          onSubmit={(payload) => saveTicket(selected, payload)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function TicketDetailModal({
  ticket,
  onClose,
  onSubmit,
}: {
  ticket: SupportTicket;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [managers, setManagers] = useState<ManagerRow[] | null>(null);
  const [managersError, setManagersError] = useState<string | null>(null);
  const [status, setStatus] = useState(ticket.status);
  const [assignedToId, setAssignedToId] = useState(ticket.assignedTo?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    requestPaged<ManagerRow>("/api/v1/admin/managers")
      .then((result) => {
        if (!active) return;
        setManagers(result.items.filter((row) => row.user?.status === "ACTIVE"));
      })
      .catch((err) => {
        if (!active) return;
        setManagers([]);
        setManagersError(envelopeMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    if (status !== ticket.status) payload.status = status;
    if (assignedToId !== (ticket.assignedTo?.id ?? "")) {
      // L’API accepte `assignedToId: null` pour désaffecter (champ nullable).
      payload.assignedToId = assignedToId || null;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason) payload.reason = trimmedReason;

    if (payload.status === undefined && payload.assignedToId === undefined) {
      setError("Aucune modification à enregistrer.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(envelopeMessage(err));
    } finally {
      setPending(false);
    }
  }

  // Titulaire actuel absent de l’équipe active (ex. désactivé) : on l’affiche
  // quand même pour ne pas présenter un ticket comme « non assigné ».
  const currentAssignee = ticket.assignedTo ?? null;
  const currentAssigneeMissing =
    currentAssignee !== null &&
    managers !== null &&
    !managers.some((row) => row.user.id === currentAssignee.id);

  return (
    <AdminModal title={`Demande ${ticket.code}`} onClose={onClose} width="max-w-2xl">
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} />
          <Badge cls="border-white/15 bg-white/5 text-stone-300">
            {supportCategoryLabel(ticket.category)}
          </Badge>
          <span className="text-[11px] tabular-nums text-stone-500">
            {formatDateTime(ticket.createdAt)}
          </span>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Sujet
          </p>
          <p className="mt-1.5 text-base font-semibold text-stone-100">{ticket.subject}</p>
        </div>

        <div className="rounded-[14px] border border-white/10 bg-black/15 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">Description</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-300">
            {ticket.description}
          </p>
        </div>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.16em] text-stone-500">Signalé par</dt>
            <dd className="mt-1 text-stone-200">
              {personLabel(ticket.reporter)}
              {ticket.reporter?.role ? ` · ${ticket.reporter.role}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.16em] text-stone-500">Assigné à</dt>
            <dd className="mt-1 text-stone-200">
              {ticket.assignedTo ? personLabel(ticket.assignedTo) : "Non assigné"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.16em] text-stone-500">Commande</dt>
            <dd className="mt-1 text-stone-200">{ticket.orderNumber ?? ticket.orderId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.16em] text-stone-500">Mise à jour</dt>
            <dd className="mt-1 tabular-nums text-stone-200">
              {formatDateTime(ticket.updatedAt)}
            </dd>
          </div>
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
              Statut
            </span>
            <SelectInput value={status} onChange={(event) => setStatus(event.target.value)}>
              {SUPPORT_STATUS_OPTIONS.filter((option) => option.value !== "").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
              Assigner à
            </span>
            <SelectInput
              value={assignedToId}
              onChange={(event) => setAssignedToId(event.target.value)}
              disabled={managers === null}
            >
              <option value="">
                {managers === null ? "Chargement…" : "Non assigné"}
              </option>
              {currentAssigneeMissing && currentAssignee && (
                <option value={currentAssignee.id}>{personLabel(currentAssignee)}</option>
              )}
              {managers?.map((manager) => (
                <option key={manager.user.id} value={manager.user.id}>
                  {[manager.user.firstName, manager.user.lastName].filter(Boolean).join(" ") ||
                    manager.user.email}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Motif (facultatif)
          </span>
          <TextInput
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            placeholder="Justification de la modification (journalisée)"
          />
          <span className="mt-1.5 block text-xs text-stone-500">
            Transmis au demandeur et inscrit au journal d’activité.
          </span>
        </label>

        {managersError && (
          <Alert tone="warning">
            Équipe indisponible — impossible de réassigner : {managersError}
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Fermer
          </Button>
          <Button type="submit" loading={pending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}
