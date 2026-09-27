"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { LuxPageHead } from "@/components/lux/lux-shell";
import { errorMessage, formatXof, isPermissionError, type PageMeta } from "./api";

// ---------------------------------------------------------------------------
// Briques visuelles de l'espace administration.
// Réutilisation à l'identique des motifs de la console (`app/console/page.tsx`)
// et du kit UI (`components/ui.tsx`) : mêmes classes, mêmes jetons --lux-*.
// ---------------------------------------------------------------------------

/** En-tête de page (kicker or + titre serif + actions) avec séparateur. */
export function AdminPageHead({
  kicker,
  title,
  meta,
  action,
}: {
  kicker: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border-b border-white/10 pb-6">
      <LuxPageHead kicker={kicker} title={title} meta={meta} action={action} />
    </div>
  );
}

/** Erreur d'appel API : 403 → alerte de permission (aucune redirection). */
export function ErrorAlert({ error }: { error: unknown }) {
  if (error === null || error === undefined || error === false || error === "") return null;
  return (
    <div className="mt-5">
      <Alert tone={isPermissionError(error) ? "warning" : "danger"}>{errorMessage(error)}</Alert>
    </div>
  );
}

export function NoticeAlert({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return (
    <div className="mt-5">
      <Alert tone="success">{notice}</Alert>
    </div>
  );
}

/** Barre de recherche (motif identique à la console). */
export function SearchBar({
  placeholder,
  onSearch,
}: {
  placeholder?: string;
  onSearch: (query: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
      className="flex w-full gap-2 sm:w-auto"
    >
      <TextInput
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder ?? "Rechercher"}
        className="min-w-0 sm:w-64"
      />
      <Button type="submit">Rechercher</Button>
    </form>
  );
}

/** Onglets de filtre par statut (style « chips » de la console). */
export function FilterTabs({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtre par statut">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
              active
                ? "border-amber-200/15 bg-amber-300/[0.09] text-[var(--lux-gold-light)]"
                : "border-white/10 text-stone-400 hover:bg-white/[0.06] hover:text-stone-100"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pagination pilotée par le meta { page, perPage, total } de l'API. */
export function Pagination({
  meta,
  onPage,
  onPerPage,
}: {
  meta: PageMeta;
  onPage: (page: number) => void;
  onPerPage?: (perPage: number) => void;
}) {
  const perPage = Math.max(1, meta.perPage);
  const totalPages = Math.max(1, Math.ceil(meta.total / perPage));
  const from = meta.total === 0 ? 0 : (meta.page - 1) * perPage + 1;
  const to = Math.min(meta.total, meta.page * perPage);
  const btn =
    "rounded-xl border border-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-400 transition hover:bg-white/[0.06] hover:text-stone-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-400";
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-400">
      <span className="tabular-nums">
        {from}–{to} sur {meta.total.toLocaleString("fr-FR")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPerPage && (
          <label className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-stone-500">Par page</span>
            <select
              value={perPage}
              onChange={(event) => onPerPage(Number(event.target.value))}
              className="rounded-xl border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-stone-300 outline-none"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={btn} disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Précédent
        </button>
        <span className="tabular-nums">
          Page {meta.page} / {totalPages}
        </span>
        <button
          type="button"
          className={btn}
          disabled={meta.page >= totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

/** Conteneur de tableau (même cadre que la console). */
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#101825]/80">
      {children}
    </div>
  );
}

/** Tableau : en-tête seul, les lignes sont fournies par la page. */
export function DataTable({
  columns,
  actionLabel = "Action",
  minWidth = 760,
  children,
}: {
  columns: string[];
  actionLabel?: string | null;
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-left text-xs"
        style={{ minWidth: `${minWidth}px` }}
      >
        <thead className="bg-white/[0.035] text-[9px] uppercase tracking-[0.14em] text-stone-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-semibold">
                {column}
              </th>
            ))}
            {actionLabel && <th className="px-4 py-3 font-semibold">{actionLabel}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">{children}</tbody>
      </table>
    </div>
  );
}

export function TableLoading({ label }: { label?: string }) {
  return (
    <p className="flex items-center gap-3 p-6 text-sm text-stone-400">
      <Spinner /> {label ?? "Chargement des données…"}
    </p>
  );
}

export function TableEmpty({ label }: { label?: string }) {
  return <p className="p-6 text-sm text-stone-400">{label ?? "Aucun résultat pour cette recherche."}</p>;
}

// ---------------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------------

/** Modale de base (panneau verre, fermeture Échap / clic sur le fond). */
export function AdminModal({
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`lux-glass my-auto w-full ${width} rounded-[20px] p-5 sm:p-6`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl text-stone-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-stone-400 transition hover:text-stone-100"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** Dialogue de confirmation (aucune donnée saisie). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmer",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const working = pending || busy;

  async function confirm() {
    setPending(true);
    setDialogError(null);
    try {
      await onConfirm();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal title={title} onClose={onClose}>
      <div className="text-sm leading-relaxed text-stone-300">{message}</div>
      {dialogError && (
        <div className="mt-3">
          <Alert tone="danger">{dialogError}</Alert>
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={working}>
          Annuler
        </Button>
        <Button variant={danger ? "danger" : "primary"} loading={working} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </AdminModal>
  );
}

/**
 * Modale à champ de saisie unique (motif, référence…) : validation minimale
 * côté client + affichage inline de l'erreur serveur.
 */
export function FieldModal({
  title,
  label,
  hint,
  placeholder,
  multiline = true,
  minLength = 1,
  maxLength,
  submitLabel = "Valider",
  requiredLabel = true,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  submitLabel?: string;
  requiredLabel?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < minLength) {
      setLocalError(`${label} : ${minLength} caractères minimum.`);
      return;
    }
    setLocalError(null);
    setPending(true);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setLocalError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal title={title} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            {label}
            {requiredLabel && minLength > 0 && (
              <span className="ml-1 text-[var(--lux-gold, #ff6a32)]">*</span>
            )}
          </span>
          {multiline ? (
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              rows={4}
              maxLength={maxLength}
              className="glass w-full rounded-[14px] px-3.5 py-2.5 text-sm text-stone-100 outline-none transition-colors border-[rgba(255,255,255,0.12)] focus:border-[rgba(232,71,36,0.6)] placeholder:text-stone-400"
            />
          ) : (
            <TextInput
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              maxLength={maxLength}
            />
          )}
          {hint && !localError && <span className="mt-1.5 block text-xs text-stone-400">{hint}</span>}
          {localError && <span className="mt-1.5 block text-xs text-[#fca5a5]">{localError}</span>}
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// Formatage des cellules (motif repris de la console)
// ---------------------------------------------------------------------------

const MONEY_KEYS = new Set([
  "basePrice",
  "totalAmount",
  "amount",
  "balanceAvailable",
  "balancePending",
  "registrationFee",
  "promoPrice",
  "totalPaid",
  "monthlyAmount",
  "remainingAmount",
  "downPaymentAmount",
  "amountDue",
  "amountPaid",
  "lastMonthAmount",
  "settledRevenue",
  "dailyRate",
]);

const DATE_KEYS = new Set([
  "createdAt",
  "paidAt",
  "sellerSince",
  "requestedAt",
  "processedAt",
  "startsAt",
  "endsAt",
  "dueDate",
  "startedAt",
  "expiresAt",
  "updatedAt",
]);

export function formatCell(value: unknown, key: string): ReactNode {
  if (key === "status" || key === "kycStatus") return <StatusBadge status={String(value ?? "—")} />;
  if (value === null || value === undefined || value === "")
    return <span className="text-stone-600">—</span>;
  if (MONEY_KEYS.has(key))
    return (
      <span className="whitespace-nowrap tabular-nums">{formatXof(Number(value))}</span>
    );
  if (DATE_KEYS.has(key))
    return <span className="whitespace-nowrap">{new Date(String(value)).toLocaleDateString("fr-FR")}</span>;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (key === "_count") return <span>{String(item.orders ?? 0)}</span>;
    const name = [item.firstName, item.lastName].filter(Boolean).join(" ");
    return <span className="max-w-[200px] truncate">{String(item.email ?? item.orderNumber ?? (name || "—"))}</span>;
  }
  return <span className="max-w-[220px] truncate">{String(value)}</span>;
}

/** Badge de sévérité du journal d'audit. */
export function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "CRITICAL"
      ? "text-[#fca5a5] border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)]"
      : severity === "WARNING"
        ? "text-[#fbbf24] border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)]"
        : "text-stone-300 border-white/15 bg-white/5";
  return <Badge cls={cls}>{severity}</Badge>;
}

/** Ligne d'action de tableau (motif de la console). */
export function RowAction({
  label,
  busy,
  disabled,
  onClick,
  tone = "gold",
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tone?: "gold" | "danger" | "muted";
}) {
  const cls =
    tone === "danger"
      ? "text-[#fca5a5]"
      : tone === "muted"
        ? "text-stone-500"
        : "text-[var(--lux-gold-light)]";
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.1em] transition hover:opacity-80 disabled:opacity-50 ${cls}`}
    >
      {label}
    </button>
  );
}
