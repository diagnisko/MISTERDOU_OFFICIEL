"use client";

import { Fragment, useState } from "react";
import { Button, SelectInput, TextInput } from "@/components/ui";
import { buildQuery, dateInputToIso } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
  NoticeAlert,
  Pagination,
  SearchBar,
  SeverityBadge,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Journal d'audit — GET /admin/audit
// params : page, perPage, action?, severity?, resourceType?, from?, to?, q?
// ---------------------------------------------------------------------------

type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  severity: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  actorRole: string | null;
  metadata: unknown;
  user: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
};

type Filters = {
  q: string;
  severity: string;
  action: string;
  resourceType: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = { q: "", severity: "", action: "", resourceType: "", from: "", to: "" };

const SEVERITIES = ["", "INFO", "WARNING", "CRITICAL"] as const;

const COLUMNS = ["Date", "Action", "Sévérité", "Ressource", "Acteur", "IP"];

function actorLabel(row: AuditRow): string {
  if (row.user) {
    const name = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ");
    return row.user.email ?? (name || "—");
  }
  return row.actorRole ?? "—";
}

export default function AuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useAdminList<AuditRow>(
    `/api/v1/admin/audit${buildQuery({
      page,
      perPage,
      q: filters.q || undefined,
      action: filters.action || undefined,
      severity: filters.severity || undefined,
      resourceType: filters.resourceType || undefined,
      from: dateInputToIso(filters.from),
      to: dateInputToIso(filters.to),
    })}`,
  );

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
    setExpanded(null);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setExpanded(null);
  }

  return (
    <>
      <AdminPageHead
        kicker="Paramètres & équipe"
        title="Journal d’audit"
        meta="Historique horodaté des actions administratives (filtres serveur)."
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <form onSubmit={applyFilters} className="mt-6 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Recherche
          </span>
          <TextInput
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="Texte libre"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Action
          </span>
          <TextInput
            value={draft.action}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            placeholder="ex. ADMIN_CLIENT_STATUS_CHANGED"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Ressource
          </span>
          <TextInput
            value={draft.resourceType}
            onChange={(event) => setDraft({ ...draft, resourceType: event.target.value })}
            placeholder="ex. Order"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Sévérité
          </span>
          <SelectInput
            value={draft.severity}
            onChange={(event) => setDraft({ ...draft, severity: event.target.value })}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity || "all"} value={severity}>
                {severity || "Toutes"}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Du
          </span>
          <TextInput
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Au
          </span>
          <TextInput
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit">Filtrer</Button>
          <Button type="button" variant="ghost" onClick={resetFilters}>
            Réinitialiser
          </Button>
        </div>
      </form>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Événements</p>
          <p className="mt-2 text-sm text-stone-400">
            Cliquez sur une ligne pour afficher les métadonnées brutes.
          </p>
        </div>
        <SearchBar
          placeholder="Recherche rapide"
          onSearch={(query) => {
            setDraft({ ...draft, q: query });
            setFilters({ ...draft, q: query });
            setPage(1);
          }}
        />
      </div>

      <TableCard>
        {list.loading ? (
          <TableLoading label="Chargement du journal…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label="Aucun événement pour ces filtres." />
        ) : (
          <DataTable columns={COLUMNS} actionLabel="Détails" minWidth={860}>
            {list.items.map((row) => {
              const open = expanded === row.id;
              return (
                <Fragment key={row.id}>
                  <tr
                    className="cursor-pointer transition hover:bg-white/[0.025]"
                    onClick={() => setExpanded(open ? null : row.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                      {new Date(row.createdAt).toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-stone-200">{row.action}</td>
                    <td className="px-4 py-3.5">
                      <SeverityBadge severity={row.severity} />
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3.5 text-stone-300">
                      {row.resourceType
                        ? `${row.resourceType}${row.resourceId ? ` · ${row.resourceId}` : ""}`
                        : "—"}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3.5 text-stone-300">
                      {actorLabel(row)}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-stone-400">{row.ip ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpanded(open ? null : row.id);
                        }}
                        className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--lux-gold-light)] transition hover:opacity-80"
                      >
                        {open ? "Masquer" : "Voir"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="bg-black/25 px-4 py-4">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">
                          Métadonnées
                        </p>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-stone-300">
                          {row.metadata === null || row.metadata === undefined
                            ? "—"
                            : JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
