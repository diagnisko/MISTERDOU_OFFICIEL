"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

// ---------------------------------------------------------------------------
// Kit UI — design system MISTERDOU (univers [data-lux] : slate & or, verre,
// titres serif). Source unique consommée par l'espace admin, l'espace vendeur,
// le KYC et le checkout : toute évolution se propage partout.
// ---------------------------------------------------------------------------

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

const BTN_VARIANTS = {
  primary:
    "lux-btn lux-btn-gold !min-h-[42px] !px-5 !text-[11.5px] disabled:opacity-60 disabled:hover:translate-y-0",
  outline: "lux-btn lux-btn-ghost !min-h-[42px] !px-5 !text-[11.5px] disabled:opacity-60",
  danger:
    "lux-btn !min-h-[42px] !px-5 !text-[11.5px] border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)] text-[#fca5a5] hover:border-[rgba(239,68,68,0.75)] hover:bg-[rgba(239,68,68,0.22)] disabled:opacity-60",
  success:
    "lux-btn !min-h-[42px] !px-5 !text-[11.5px] border border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[#6ee7b7] hover:border-[rgba(16,185,129,0.75)] hover:bg-[rgba(16,185,129,0.22)] disabled:opacity-60",
  ghost:
    "lux-btn lux-btn-ghost !min-h-[42px] !px-5 !text-[11.5px] bg-transparent shadow-none disabled:opacity-60",
} as const;

export type ButtonVariant = keyof typeof BTN_VARIANTS;

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${BTN_VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
        {label}
        {required && <span className="ml-1 text-[var(--lux-gold, #f59e0b)]">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-stone-400">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs text-[#fca5a5]">{error}</span>}
    </label>
  );
}

const INPUT_CLS =
  "glass w-full rounded-[14px] px-3.5 py-2.5 text-sm text-stone-100 outline-none transition-colors border-[rgba(255,255,255,0.12)] focus:border-[rgba(245,158,11,0.6)] placeholder:text-stone-400";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLS} ${props.className ?? ""}`} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${INPUT_CLS} ${props.className ?? ""}`}>
      {props.children}
    </select>
  );
}

export function Alert({
  tone = "info",
  children,
  title,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    info: "border-[rgba(245,158,11,0.32)] bg-[rgba(245,158,11,0.09)] text-stone-100",
    success: "border-[rgba(16,185,129,0.34)] bg-[rgba(16,185,129,0.09)] text-stone-100",
    warning: "border-[rgba(251,191,36,0.34)] bg-[rgba(251,191,36,0.09)] text-stone-100",
    danger: "border-[rgba(239,68,68,0.34)] bg-[rgba(239,68,68,0.09)] text-stone-100",
  };
  const dot: Record<string, string> = {
    info: "bg-[#f59e0b]",
    success: "bg-[#10b981]",
    warning: "bg-[#fbbf24]",
    danger: "bg-[#ef4444]",
  };
  return (
    <div className={`rounded-[16px] border px-4 py-3 text-sm backdrop-blur-sm ${tones[tone]}`}>
      <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${dot[tone]}`} aria-hidden />
      {title && <span className="font-semibold">{title}</span>}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge de statut (labels FR + couleurs stables par machine-status)
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  // KYC
  NOT_SUBMITTED: { label: "Non vérifié", cls: "text-stone-400 border-white/15 bg-white/5" },
  PENDING: { label: "En attente", cls: "text-[#fbbf24] border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)]" },
  IN_PROGRESS: { label: "En cours", cls: "text-[#f59e0b] border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)]" },
  VERIFIED: { label: "Vérifié", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  REJECTED: { label: "Refusé", cls: "text-[#fca5a5] border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)]" },
  RESUBMISSION_REQUIRED: { label: "Nouvelle pièce demandée", cls: "text-[#fbbf24] border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)]" },
  // Téléphone
  UNVERIFIED: { label: "Numéro non vérifié", cls: "text-stone-400 border-white/15 bg-white/5" },
  VERIFIED_PHONE: { label: "Numéro vérifié", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  // Vendeur
  APPLICATION_PENDING: { label: "Demande en attente", cls: "text-[#fbbf24] border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)]" },
  ACTIVE: { label: "Actif", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  SUSPENDED: { label: "Suspendu", cls: "text-[#fca5a5] border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)]" },
  REVOKED: { label: "Révoqué", cls: "text-[#fca5a5] border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)]" },
  // Paiement
  SUCCESS: { label: "Payé", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  FAILED: { label: "Échec", cls: "text-[#fca5a5] border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)]" },
  PROCESSING: { label: "En traitement", cls: "text-[#f59e0b] border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)]" },
  CANCELLED: { label: "Annulé", cls: "text-stone-400 border-white/15 bg-white/5" },
  REFUNDED: { label: "Remboursé", cls: "text-[#fbbf24] border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)]" },
  // Retrait vendeur
  APPROVED: { label: "Approuvé", cls: "text-[#f59e0b] border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)]" },
  COMPLETED: { label: "Effectué", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  // Commande
  PENDING_PAYMENT: { label: "En attente de paiement", cls: "text-[#fbbf24] border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)]" },
  PARTIALLY_PAID: { label: "Partiellement payée", cls: "text-[#f59e0b] border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)]" },
  PAID: { label: "Payée", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  DELIVERED: { label: "Livrée", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  // Support (tickets)
  CREATED: { label: "Créée", cls: "text-[var(--lux-gold-light)] border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)]" },
  RESOLVED: { label: "Résolue", cls: "text-[#6ee7b7] border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)]" },
  CLOSED: { label: "Fermée", cls: "text-stone-400 border-white/15 bg-white/5" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status];
  if (!s) return <Badge>{status}</Badge>;
  return <Badge cls={s.cls}>{s.label}</Badge>;
}

export function Badge({ children, cls = "" }: { children: ReactNode; cls?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] backdrop-blur-sm ${cls}`}
    >
      {children}
    </span>
  );
}

/** Pagination simple pilotée par le meta { page, perPage, total } de l'API. */
export function ListPager({
  meta,
  hidden,
  onPage,
}: {
  meta: { page: number; perPage: number; total: number };
  hidden?: boolean;
  onPage: (page: number) => void;
}) {
  if (hidden) return null;
  const perPage = Math.max(1, meta.perPage);
  const totalPages = Math.max(1, Math.ceil(meta.total / perPage));
  if (totalPages <= 1) return null;
  const btn =
    "rounded-xl border border-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-400 transition hover:bg-white/[0.06] hover:text-stone-100 disabled:opacity-40";
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-400">
      <span className="tabular-nums">
        {((meta.page - 1) * perPage + 1).toLocaleString("fr-FR")}–
        {Math.min(meta.total, meta.page * perPage).toLocaleString("fr-FR")} sur{" "}
        {meta.total.toLocaleString("fr-FR")}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
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

export function Steps({ current, steps }: { current: number; steps: string[] }) {
  return (
    <ol className="mb-8 flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold transition-colors ${
                done
                  ? "bg-[#10b981] text-[#04140e]"
                  : active
                    ? "bg-[linear-gradient(120deg,#f5d78e,#f59e0b_45%,#d97706)] text-[#1c1303]"
                    : "bg-white/5 text-stone-400 ring-1 ring-white/10"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`hidden text-[11px] font-semibold uppercase tracking-[0.14em] sm:inline ${
                active ? "text-stone-100" : "text-stone-400"
              }`}
            >
              {s}
            </span>
            {i < steps.length - 1 && <span className="h-px w-5 bg-white/10 sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}
