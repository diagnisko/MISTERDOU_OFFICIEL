"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { errorMessage, formatXof } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import {
  confirmOrderReceipt,
  fetchMyOrder,
  orderStatusLabel,
  reportOrderProblem,
  requestVerificationCode,
  revealOrderCredentials,
  type OrderDetail,
  type ReportReason,
  type RevealedCredentials,
  type VerificationCode,
} from "@/lib/orders";
import { payNextInstallment, type Schedule } from "@/lib/installments";
import { useVisiblePoll } from "@/lib/use-visible-poll";

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const monthFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

// ---------------------------------------------------------------------------
// Détail d'une commande côté client : tout ce qui concerne le compte acheté
// au même endroit (accès, code de vérification, réception, mensualités,
// signalement).
// ---------------------------------------------------------------------------

export function OrderDetailView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await fetchMyOrder(orderId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Commande indisponible."));
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Code demandé : on guette la réponse de l'équipe ou du vendeur.
  useVisiblePoll(load, 8_000, { enabled: order?.verificationCode?.status === "PENDING" });

  if (error && !order) return <Alert tone="danger">{error}</Alert>;
  if (!order) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-stone-400">
        <Spinner className="h-4 w-4 text-[var(--lux-gold)]" /> Chargement de la commande…
      </p>
    );
  }

  const item = order.items[0];
  const closed = order.status === "REFUNDED" || order.status === "CANCELLED";

  return (
    <div className="space-y-5">
      <Link href="/account/orders" className="inline-flex items-center gap-1.5 text-[13px] text-[#b8a6a1] hover:text-white">
        <span aria-hidden>←</span> Mes commandes
      </Link>

      <section className="dash-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">{order.orderNumber}</p>
            <h1 className="mt-1 text-[22px] font-semibold leading-tight text-white">{item?.title ?? "Commande"}</h1>
            <p className="mt-1.5 text-[13px] text-stone-400">
              Achetée le {dateFr(order.createdAt)} · vendue par {item?.soldBy ?? "MISTERDOU"}
            </p>
          </div>
          <div className="text-right">
            <OrderStatusPill status={order.status} />
            <p className="mt-2 text-[20px] font-semibold tabular-nums text-white">{formatXof(order.totalAmount)}</p>
          </div>
        </div>
        {item && (
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4 text-center">
            <Stat label="Division" value={item.division} />
            <Stat label="Puissance" value={item.teamPower.toLocaleString("fr-FR")} />
            <Stat label="Pièces" value={item.coins.toLocaleString("fr-FR")} />
          </dl>
        )}
        {!closed && <Progress order={order} />}
      </section>

      {error && <Alert tone="warning">{error}</Alert>}

      {order.status === "REFUNDED" && (
        <Alert tone="warning" title="Commande remboursée">
          L’accès à ce compte a été révoqué.
        </Alert>
      )}

      {order.status === "PENDING_PAYMENT" && (
        <Alert tone="info" title="Paiement en attente">
          Finalisez votre règlement pour recevoir le compte. Une commande non réglée est libérée au bout de 20 minutes.
        </Alert>
      )}

      {order.schedule && !closed && <InstallmentTimeline orderId={order.id} schedule={order.schedule} />}

      {order.canReveal && (
        <div className="grid gap-5 md:grid-cols-2">
          <CredentialsCard orderId={order.id} />
          <VerificationCodeCard orderId={order.id} code={order.verificationCode} onChange={load} />
        </div>
      )}

      {order.canConfirmReceipt && <ReceiptCard order={order} onDone={load} />}

      {order.receivedAt && (
        <Alert tone="success" title="Réception confirmée">
          Vous avez confirmé la réception le {dateFr(order.receivedAt)}. Merci !
        </Alert>
      )}

      {!closed && order.status !== "PENDING_PAYMENT" && <ReportCard order={order} onDone={load} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.16em] text-stone-500">{label}</dt>
      <dd className="mt-1 text-[14px] font-semibold tabular-nums text-stone-100">{value}</dd>
    </div>
  );
}

export function OrderStatusPill({ status }: { status: string }) {
  const tone =
    status === "COMPLETED" || status === "DELIVERED" || status === "PAID"
      ? "border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)] text-[#6ee7b7]"
      : status === "REFUNDED" || status === "CANCELLED"
        ? "border-white/15 bg-white/5 text-stone-400"
        : "border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)] text-[#fbbf24]";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${tone}`}>
      {orderStatusLabel(status)}
    </span>
  );
}

/** Frise « Paiement → Livraison → Réception ». */
function Progress({ order }: { order: OrderDetail }) {
  const paid = !["PENDING_PAYMENT", "PARTIALLY_PAID"].includes(order.status);
  const steps = [
    { label: order.paymentMode === "INSTALLMENTS" ? "Mensualités réglées" : "Paiement", done: paid },
    { label: "Compte livré", done: Boolean(order.deliveredAt) },
    { label: "Réception confirmée", done: Boolean(order.receivedAt) },
  ];
  return (
    <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Avancement de la commande">
      {steps.map((step, i) => (
        <li key={step.label} className="flex flex-col gap-2">
          <span className={`h-1 rounded-full ${step.done ? "bg-[linear-gradient(90deg,#ffa070,#ff6a32)]" : "bg-white/10"}`} />
          <span className={`text-[11.5px] ${step.done ? "text-stone-100" : "text-stone-500"}`}>
            <span className="tabular-nums">{i + 1}.</span> {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// --- Identifiants du compte ------------------------------------------------

function CredentialsCard({ orderId }: { orderId: string }) {
  const [creds, setCreds] = useState<RevealedCredentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      setCreds(await revealOrderCredentials(orderId));
    } catch (err) {
      setError(errorMessage(err, "Accès indisponible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card p-5">
      <h2 className="text-[15px] font-semibold text-white">Identifiants du compte</h2>
      <p className="mt-1 text-[13px] text-stone-400">E-mail et mot de passe pour vous connecter au jeu.</p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {creds ? (
        <dl className="mt-4 space-y-3">
          <CopyRow label="E-mail" value={creds.email} />
          <CopyRow label="Mot de passe" value={creds.password} />
          <p className="text-[12px] text-stone-500">Changez le mot de passe dès votre première connexion.</p>
        </dl>
      ) : (
        <button
          type="button"
          onClick={() => void reveal()}
          disabled={busy}
          className="lux-btn lux-btn-gold mt-4 w-full !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-60"
          style={{ borderRadius: 16 }}
        >
          {busy ? "Ouverture…" : "Afficher les identifiants"}
        </button>
      )}
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
      <dt className="text-[10.5px] uppercase tracking-[0.16em] text-stone-500">{label}</dt>
      <dd className="mt-1 flex items-center justify-between gap-3">
        <span className="break-all font-mono text-[14px] text-stone-100">{value}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-[11.5px] text-stone-300 hover:border-white/25 hover:text-white"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </dd>
    </div>
  );
}

// --- Code de vérification --------------------------------------------------

function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

function VerificationCodeCard({ orderId, code, onChange }: { orderId: string; code: VerificationCode | null; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = useCountdown(code?.status === "PROVIDED" ? code.expiresAt : null);
  const expired = code?.status === "EXPIRED" || (code?.status === "PROVIDED" && remaining === 0);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      await requestVerificationCode(orderId);
      await onChange();
    } catch (err) {
      setError(errorMessage(err, "Demande impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card p-5">
      <h2 className="text-[15px] font-semibold text-white">Code de vérification</h2>
      <p className="mt-1 text-[13px] text-stone-400">
        Le jeu vous demande un code à la connexion ? Demandez-le ici : il vous est envoyé en quelques minutes.
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {code?.status === "PENDING" && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] px-3 py-3 text-[13px] text-stone-200">
          <Spinner className="h-4 w-4 text-[#fbbf24]" />
          Demande envoyée à {new Date(code.requestedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Le code
          s’affichera ici automatiquement.
        </div>
      )}

      {code?.status === "PROVIDED" && !expired && code.code && (
        <div className="mt-4 rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-4 py-4 text-center">
          <p className="font-mono text-[30px] font-semibold tracking-[0.25em] text-white" aria-label="Code">
            {code.code}
          </p>
          <p className="mt-1 text-[12.5px] text-[#6ee7b7]" aria-live="polite">
            Valable encore {Math.floor((remaining ?? 0) / 60)} min {String((remaining ?? 0) % 60).padStart(2, "0")} s
          </p>
        </div>
      )}

      {(!code || expired) && (
        <>
          {expired && <p className="mt-4 text-[13px] text-stone-400">Le dernier code a expiré. Vous pouvez en demander un nouveau.</p>}
          <button
            type="button"
            onClick={() => void ask()}
            disabled={busy}
            className="lux-btn lux-btn-ghost mt-4 w-full !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ borderRadius: 16 }}
          >
            {busy ? "Envoi…" : expired ? "Redemander un code" : "Demander un code"}
          </button>
        </>
      )}
    </section>
  );
}

// --- Réception --------------------------------------------------------------

function ReceiptCard({ order, onDone }: { order: OrderDetail; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmOrderReceipt(order.id);
      await onDone();
    } catch (err) {
      setError(errorMessage(err, "Confirmation impossible."));
      setBusy(false);
    }
  }

  return (
    <section className="dash-card border-[rgba(255,106,50,0.28)] p-5">
      <h2 className="text-[15px] font-semibold text-white">Avez-vous bien reçu votre compte ?</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-stone-400">
        Connectez-vous, changez le mot de passe, puis confirmez. Sans réponse ni signalement
        {order.autoConfirmAt ? ` d’ici le ${dateFr(order.autoConfirmAt)}` : ""}, la réception sera considérée comme confirmée.
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="lux-btn lux-btn-gold !min-h-[44px] flex-1 text-[12px] uppercase tracking-[0.14em] disabled:opacity-60"
          style={{ borderRadius: 16 }}
        >
          {busy ? "Confirmation…" : "Oui, j’ai bien reçu"}
        </button>
        <a
          href="#signaler"
          className="lux-btn lux-btn-ghost !min-h-[44px] flex-1 text-[12px] uppercase tracking-[0.14em]"
          style={{ borderRadius: 16 }}
        >
          Non, signaler un problème
        </a>
      </div>
    </section>
  );
}

// --- Mensualités ------------------------------------------------------------

function InstallmentTimeline({ orderId, schedule }: { orderId: string; schedule: Schedule }) {
  const open = schedule.installments.filter((l) => l.status !== "PAID" && l.status !== "WAIVED" && l.status !== "CANCELLED");
  // Sélection contiguë : choisir un mois inclut tous les mois non payés avant lui.
  const [months, setMonths] = useState(open.length > 0 ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = open.slice(0, months);
  const amount = selected.reduce((sum, l) => sum + (l.amountDue - l.amountPaid), 0);
  const pct = schedule.totalAmount > 0 ? Math.min(100, Math.round((schedule.totalPaid / schedule.totalAmount) * 100)) : 0;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await payNextInstallment(orderId, months);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(errorMessage(err, "Règlement impossible."));
      setBusy(false);
    }
  }

  return (
    <section className="dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Mensualités</h2>
          <p className="mt-1 text-[13px] text-stone-400">
            {schedule.installments.filter((l) => l.status === "PAID").length} sur {schedule.monthCount} payées · reste{" "}
            <span className="tabular-nums text-stone-200">{formatXof(schedule.remainingAmount)}</span>
          </p>
        </div>
        <span className="text-[13px] tabular-nums text-stone-400">{pct} %</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-[linear-gradient(90deg,#ffa070,#ff6a32)]" style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-5 space-y-2">
        <li className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[13px]">
          <span className="flex items-center gap-3">
            <MonthDot state={schedule.downPaid ? "paid" : "due"} />
            <span className="text-stone-200">Apport initial</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="tabular-nums text-stone-100">{formatXof(schedule.downPaymentAmount)}</span>
            <MonthTag state={schedule.downPaid ? "paid" : "due"} />
          </span>
        </li>
        {schedule.installments.map((line) => {
          const openIndex = open.findIndex((o) => o.index === line.index);
          const isOpen = openIndex >= 0;
          const isSelected = isOpen && openIndex < months;
          const state = line.status === "PAID" || line.status === "WAIVED" ? "paid" : line.status === "OVERDUE" ? "late" : "due";
          return (
            <li key={line.index}>
              <button
                type="button"
                disabled={!isOpen || busy}
                onClick={() => setMonths(openIndex + 1 === months ? openIndex : openIndex + 1)}
                aria-pressed={isOpen ? isSelected : undefined}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] transition ${
                  isSelected
                    ? "border-[rgba(255,106,50,0.55)] bg-[rgba(232,71,36,0.12)]"
                    : "border-white/[0.06] bg-white/[0.02] enabled:hover:border-white/20"
                } disabled:cursor-default`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <MonthDot state={state} selected={isSelected} />
                  <span className="min-w-0">
                    <span className="block capitalize text-stone-200">{monthFr(line.dueDate)}</span>
                    <span className="block text-[11.5px] text-stone-500">
                      {line.label}
                      {line.paidAt ? ` · payée le ${dateFr(line.paidAt)}` : ` · avant le ${dateFr(line.dueDate)}`}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-stone-100">{formatXof(line.amountDue)}</span>
                  <MonthTag state={state} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {open.length > 0 && schedule.downPaid && (
        <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-stone-400">
            {months === 0
              ? "Touchez un mois pour le sélectionner."
              : `${months} mois sélectionné${months > 1 ? "s" : ""} : `}
            {months > 0 && <span className="font-semibold tabular-nums text-white">{formatXof(amount)}</span>}
          </p>
          <button
            type="button"
            onClick={() => void pay()}
            disabled={busy || months === 0}
            className="lux-btn lux-btn-gold !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-50 sm:w-auto"
            style={{ borderRadius: 16 }}
          >
            {busy ? "Ouverture…" : months > 1 ? `Payer ${months} mois` : "Payer ce mois"}
          </button>
        </div>
      )}
      {schedule.fullyPaid && <p className="mt-4 text-[13px] text-[#6ee7b7]">Tout est réglé : votre compte est livré ci-dessous.</p>}
    </section>
  );
}

type MonthState = "paid" | "due" | "late";

function MonthDot({ state, selected = false }: { state: MonthState; selected?: boolean }) {
  const cls =
    state === "paid"
      ? "border-[#10b981] bg-[#10b981]"
      : selected
        ? "border-[#ff6a32] bg-[#ff6a32]"
        : state === "late"
          ? "border-[#ef4444] bg-transparent"
          : "border-white/30 bg-transparent";
  return <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full border-2 ${cls}`} />;
}

function MonthTag({ state }: { state: MonthState }) {
  const map = {
    paid: { label: "Validé", cls: "text-[#6ee7b7]" },
    due: { label: "À payer", cls: "text-stone-400" },
    late: { label: "En retard", cls: "text-[#fca5a5]" },
  } as const;
  return <span className={`w-16 text-right text-[11px] font-semibold uppercase tracking-[0.08em] ${map[state].cls}`}>{map[state].label}</span>;
}

// --- Signalement ------------------------------------------------------------

const REASONS: Array<{ value: ReportReason; label: string; subject: string }> = [
  { value: "SELLER_REPORT", label: "Le vendeur a repris ou modifié le compte", subject: "Signalement du vendeur" },
  { value: "DELIVERY", label: "Les identifiants ne fonctionnent pas", subject: "Identifiants non fonctionnels" },
  { value: "VERIFICATION_CODE", label: "Je ne reçois pas de code de vérification", subject: "Code de vérification non reçu" },
  { value: "OTHER", label: "Autre problème", subject: "Problème sur une commande" },
];

function ReportCard({ order, onDone }: { order: OrderDetail; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("SELLER_REPORT");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const picked = REASONS.find((r) => r.value === reason)!;
      const ticket = await reportOrderProblem(order.id, {
        category: reason,
        subject: `${picked.subject} — ${order.orderNumber}`,
        description: message,
      });
      setSent(ticket.code);
      setOpen(false);
      setMessage("");
      await onDone();
    } catch (err) {
      setError(errorMessage(err, "Signalement impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="signaler" className="dash-card scroll-mt-28 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Un problème avec ce compte ?</h2>
          <p className="mt-1 text-[13px] text-stone-400">
            Votre signalement part directement à l’équipe MISTERDOU. Les fonds du vendeur restent bloqués pendant l’examen.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-[rgba(239,68,68,0.4)] px-4 py-2 text-[12.5px] font-medium text-[#fca5a5] hover:bg-[rgba(239,68,68,0.08)]"
          >
            Signaler un problème
          </button>
        )}
      </div>

      {sent && (
        <div className="mt-4">
          <Alert tone="success" title="Signalement envoyé">
            Référence {sent}. Nous revenons vers vous rapidement dans vos notifications.
          </Alert>
        </div>
      )}

      {open && (
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-[12px] uppercase tracking-[0.14em] text-stone-500">Motif</legend>
            {REASONS.map((r) => (
              <label
                key={r.value}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-[13.5px] ${
                  reason === r.value ? "border-[rgba(255,106,50,0.5)] bg-[rgba(232,71,36,0.08)] text-white" : "border-white/[0.08] text-stone-300"
                }`}
              >
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[#ff6a32]" />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="text-[12px] uppercase tracking-[0.14em] text-stone-500">Décrivez ce qui se passe</span>
            <textarea
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ex. : je n’arrive plus à me connecter depuis ce matin, le mot de passe a été changé."
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-[14px] text-stone-100 placeholder:text-stone-600 focus:border-[rgba(255,106,50,0.6)] focus:outline-none"
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || message.trim().length < 10}
              className="lux-btn lux-btn-gold !min-h-[42px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-50"
              style={{ borderRadius: 16 }}
            >
              {busy ? "Envoi…" : "Envoyer le signalement"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-4 text-[13px] text-stone-400 hover:text-white">
              Annuler
            </button>
          </div>
        </form>
      )}

      {order.reports.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
          {order.reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-stone-300">{r.subject}</span>
              <span className="shrink-0 text-[12px] text-stone-500">
                {dateFr(r.createdAt)} · {r.status === "RESOLVED" || r.status === "CLOSED" ? "Traité" : "En cours d’examen"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
