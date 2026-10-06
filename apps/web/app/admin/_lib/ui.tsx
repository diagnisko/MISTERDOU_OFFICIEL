"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { DashHeading } from "@/components/dash/dash-ui";
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
    <div>
      <DashHeading greeting={kicker} title={title} actions={action} />
      {meta && <p className="mt-2 max-w-2xl text-[13px] text-[#8f7d77]">{meta}</p>}
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
/** Pause de frappe avant de relancer la recherche (une requête par pause, pas par touche). */
const LIVE_SEARCH_DELAY_MS = 300;

/**
 * Barre de recherche des listes de la console : les résultats suivent la
 * frappe (après une courte pause) ; Entrée ou la flèche cherchent tout de suite.
 */
export function SearchBar({
  placeholder,
  onSearch,
  initial = "",
}: {
  placeholder?: string;
  onSearch: (query: string) => void;
  /** Texte déjà cherché (ex. recherche lancée depuis l'en-tête). */
  initial?: string;
}) {
  const [draft, setDraft] = useState(initial);
  // Dernière recherche lancée, et rappel toujours à jour (sans relancer le minuteur).
  const sent = useRef(initial.trim());
  const callback = useRef(onSearch);
  callback.current = onSearch;

  function run(query: string) {
    if (query === sent.current) return;
    sent.current = query;
    callback.current(query);
  }

  useEffect(() => {
    const query = draft.trim();
    const timer = setTimeout(() => run(query), LIVE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(draft.trim());
      }}
      role="search"
      className="relative w-full sm:w-72"
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-[#8a7771]">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.2-4.2" />
      </svg>
      <TextInput
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder ?? "Rechercher"}
        aria-label={placeholder ?? "Rechercher"}
        enterKeyHint="search"
        className="w-full !pl-10 !pr-12"
      />
      <button
        type="submit"
        aria-label="Rechercher"
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white"
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
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
    <div className="flex flex-wrap gap-1 rounded-full border border-[rgba(255,236,229,0.08)] bg-white/[0.02] p-1" role="tablist" aria-label="Filtre par statut">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
              active
                ? "bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white"
                : "text-[#b8a6a1] hover:text-white"
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
    "grid h-8 w-8 place-items-center rounded-full border border-[rgba(255,236,229,0.1)] text-[#e9dad3] transition hover:border-[rgba(255,106,50,0.4)] hover:text-white disabled:opacity-35";
  const arrow = (d: string) => (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180">
      <path d={d} />
    </svg>
  );
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-stone-400">
      <span className="tabular-nums">
        {from}–{to} sur {meta.total.toLocaleString("fr-FR")}
      </span>
      <div className="flex items-center gap-2">
        {onPerPage && meta.total > 10 && (
          <label className="hidden items-center gap-2 sm:flex">
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
        {totalPages > 1 && (
          <>
            <button type="button" className={btn} aria-label="Page précédente" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
              {arrow("M15 18l-6-6 6-6")}
            </button>
            <span className="tabular-nums">
              {meta.page} / {totalPages}
            </span>
            <button type="button" className={btn} aria-label="Page suivante" disabled={meta.page >= totalPages} onClick={() => onPage(meta.page + 1)}>
              {arrow("M9 18l6-6-6-6")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Conteneur de tableau (même cadre que la console). */
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="dash-card mt-5 overflow-hidden">
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
    <div className="dash-scroll overflow-x-auto">
      <table
        className="dash-table w-full border-collapse text-left"
        style={{ minWidth: `${minWidth}px` }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>
                {column}
              </th>
            ))}
            {actionLabel && <th>{actionLabel}</th>}
          </tr>
        </thead>
        <tbody>{children}</tbody>
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
        className={`dash-card my-auto w-full ${width} p-5 sm:p-6`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[18px] font-semibold text-stone-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-8 w-8 place-items-center rounded-full border border-[rgba(255,236,229,0.12)] text-xs text-[#b8a6a1] transition hover:text-white"
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

/** Nature d'un paiement, en mots de l'équipe (enum PaymentType). */
export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ORDER_PAYMENT: "Achat",
  INITIAL_INSTALLMENT: "Apport",
  INSTALLMENT: "Mensualité",
  SELLER_REGISTRATION_FEE: "Frais vendeur",
  SELLER_CONTRACT: "Contrat revendeur",
  FEATURED: "Mise en avant",
  REFUND: "Remboursement",
};

export function formatCell(value: unknown, key: string): ReactNode {
  if (key === "status" || key === "kycStatus") return <StatusBadge status={String(value ?? "—")} />;
  if (key === "type" && typeof value === "string" && PAYMENT_TYPE_LABELS[value]) return <span>{PAYMENT_TYPE_LABELS[value]}</span>;
  if (key === "paymentMode") return <span>{value === "INSTALLMENTS" ? "Mensualités" : "Comptant"}</span>;
  if (key === "ownerType") return <span>{value === "VENDOR" ? "Vendeur" : "MISTERDOU"}</span>;
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
        : "text-[#ff8a5c]";
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border border-current/20 px-2.5 py-1 text-[12px] font-medium transition hover:bg-white/[0.04] disabled:opacity-50 ${cls}`}
    >
      {label}
    </button>
  );
}
