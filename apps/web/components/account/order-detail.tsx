"use client";

import { WhatsappUrgentLine } from "@/components/support/support-contacts";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { errorMessage, formatXof } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import {
  confirmOrderReceipt,
  fetchMyOrder,
  reportOrderProblem,
  requestVerificationCode,
  revealOrderCredentials,
  submitOrderReview,
  type OrderDetail,
  type ReportReason,
  type RevealedCredentials,
  type VerificationCode,
} from "@/lib/orders";
import { payNextInstallment, type Schedule } from "@/lib/installments";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useT, type MessageKey } from "@/lib/i18n";

const fmtDate = (locale: string, iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
const fmtMonth = (locale: string, iso: string) => new Date(iso).toLocaleDateString(locale, { month: "long", year: "numeric" });

// ---------------------------------------------------------------------------
// Détail d'une commande côté client : tout ce qui concerne le compte acheté
// au même endroit (accès, code de vérification, réception, mensualités,
// signalement).
// ---------------------------------------------------------------------------

export function OrderDetailView({ orderId }: { orderId: string }) {
  const t = useT();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await fetchMyOrder(orderId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t("order.unavailable")));
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
        <Spinner className="h-4 w-4 text-[var(--lux-gold)]" /> {t("order.loading")}
      </p>
    );
  }

  const item = order.items[0];
  const closed = order.status === "REFUNDED" || order.status === "CANCELLED";

  return (
    <div className="space-y-5">
      <Link href="/account/orders" className="inline-flex items-center gap-1.5 text-[13px] text-[#b8a6a1] hover:text-white">
        <span aria-hidden>←</span> {t("order.back")}
      </Link>

      <section className="dash-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">{order.orderNumber}</p>
            <h1 className="mt-1 text-[22px] font-semibold leading-tight text-white">{item?.title ?? t("order.fallbackTitle")}</h1>
            <p className="mt-1.5 text-[13px] text-stone-400">
              {t("order.boughtOn", { date: fmtDate(t.intl, order.createdAt), seller: item?.soldBy === "Vendeur partenaire" ? t("chat.seller") : (item?.soldBy ?? "MISTERDOU") })}
            </p>
          </div>
          <div className="flex w-full items-center justify-between gap-3 sm:block sm:w-auto sm:text-right">
            <span className="shrink-0 whitespace-nowrap">
              <OrderStatusPill status={order.status} />
            </span>
            <p className="whitespace-nowrap text-[20px] font-semibold tabular-nums text-white sm:mt-2">{formatXof(order.totalAmount)}</p>
          </div>
        </div>
        {item && (
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4 text-center">
            <Stat label={t("order.division")} value={item.division} />
            <Stat label={t("order.power")} value={item.teamPower.toLocaleString(t.intl)} />
            <Stat label={t("order.coins")} value={item.coins.toLocaleString(t.intl)} />
          </dl>
        )}
        {!closed && <Progress order={order} />}
      </section>

      {error && <Alert tone="warning">{error}</Alert>}

      {order.status === "REFUNDED" && (
        <Alert tone="warning" title={t("order.refundedTitle")}>
          {t("order.refundedBody")}
        </Alert>
      )}

      {order.paymentUnderReview && (
        <Alert tone="info" title={t("order.reviewTitle")}>
          {t("order.reviewBody")}
        </Alert>
      )}

      {order.status === "PENDING_PAYMENT" && !order.paymentUnderReview && (
        <Alert tone="info" title={t("order.pendingTitle")}>
          {t("order.pendingBody")}
          {order.checkoutUrl && (
            <Link href={order.checkoutUrl} className="mt-3 block font-semibold text-[#ff8a5c] hover:underline">
              {t("order.payNow")}
            </Link>
          )}
        </Alert>
      )}

      {order.schedule && !closed && <InstallmentTimeline orderId={order.id} schedule={order.schedule} />}

      {order.canReveal && (
        <div className="grid gap-5 md:grid-cols-2">
          <CredentialsCard orderId={order.id} />
          <VerificationCodeCard orderId={order.id} code={order.verificationCode} onChange={load} />
        </div>
      )}

      {/* Mensualités en cours : le compte est remis, il reste à MISTERDOU jusqu'à la dernière échéance. */}
      {order.canReveal && order.status === "PARTIALLY_PAID" && <Alert tone="warning">{t("creds.monthlyRule")}</Alert>}

      {order.canReveal && !closed && (
        <section className="dash-card flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-white">{t("order.helpTitle")}</h2>
            <p className="mt-1 text-[13px] text-stone-400">{t("order.helpBody")}</p>
          </div>
          <Link
            href="/messages"
            className="lux-btn lux-btn-ghost !min-h-[42px] shrink-0 text-[12px] uppercase tracking-[0.14em]"
            style={{ borderRadius: 16 }}
          >
            {t("order.helpCta")}
          </Link>
        </section>
      )}

      {order.canConfirmReceipt && <ReceiptCard order={order} onDone={load} />}

      {order.receivedAt && (
        <Alert tone="success" title={t("order.receivedTitle")}>
          {t("order.receivedBody", { date: fmtDate(t.intl, order.receivedAt) })}
        </Alert>
      )}

      {(order.canReview || order.review) && <ReviewCard order={order} onDone={load} />}

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
  const t = useT();
  const tone =
    status === "COMPLETED" || status === "DELIVERED" || status === "PAID"
      ? "border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)] text-[#6ee7b7]"
      : status === "REFUNDED" || status === "CANCELLED"
        ? "border-white/15 bg-white/5 text-stone-400"
        : "border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.1)] text-[#fbbf24]";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${tone}`}>
      {t(`status.${status}` as MessageKey)}
    </span>
  );
}

/** Frise « Paiement → Livraison → Réception ». */
function Progress({ order }: { order: OrderDetail }) {
  const t = useT();
  const paid = !["PENDING_PAYMENT", "PARTIALLY_PAID"].includes(order.status);
  const steps = [
    { label: order.paymentMode === "INSTALLMENTS" ? t("order.stepMonthly") : t("order.stepPaid"), done: paid },
    { label: t("order.stepDelivered"), done: Boolean(order.deliveredAt) },
    { label: t("order.stepReceived"), done: Boolean(order.receivedAt) },
  ];
  return (
    <ol className="mt-5 grid grid-cols-3 gap-2" aria-label={t("order.progress")}>
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
  const t = useT();
  const [creds, setCreds] = useState<RevealedCredentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      setCreds(await revealOrderCredentials(orderId));
    } catch (err) {
      setError(errorMessage(err, t("creds.unavailable")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card p-5">
      <h2 className="text-[15px] font-semibold text-white">{t("creds.title")}</h2>
      <p className="mt-1 text-[13px] text-stone-400">{t("creds.lead")}</p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {creds ? (
        <dl className="mt-4 space-y-3">
          <CopyRow label={t("creds.email")} value={creds.email} />
          <CopyRow label={t("creds.password")} value={creds.password} />
          <p className="text-[12px] text-stone-500">{t("creds.changeIt")}</p>
        </dl>
      ) : (
        <button
          type="button"
          onClick={() => void reveal()}
          disabled={busy}
          className="lux-btn lux-btn-gold mt-4 w-full !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-60"
          style={{ borderRadius: 16 }}
        >
          {busy ? t("creds.opening") : t("creds.show")}
        </button>
      )}
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useT();
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
          {copied ? t("creds.copied") : t("creds.copy")}
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
  const t = useT();
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
      setError(errorMessage(err, t("code.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card p-5">
      <h2 className="text-[15px] font-semibold text-white">{t("code.title")}</h2>
      <p className="mt-1 text-[13px] text-stone-400">
        {t("code.lead")}
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {code?.status === "PENDING" && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] px-3 py-3 text-[13px] text-stone-200">
          <Spinner className="h-4 w-4 text-[#fbbf24]" />
          {t("code.pending", { time: new Date(code.requestedAt).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" }) })}
        </div>
      )}

      {code?.status === "PROVIDED" && !expired && code.code && (
        <div className="mt-4 rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-4 py-4 text-center">
          <p className="font-mono text-[30px] font-semibold tracking-[0.25em] text-white" aria-label={t("code.label")}>
            {code.code}
          </p>
          <p className="mt-1 text-[12.5px] text-[#6ee7b7]" aria-live="polite">
            {t("code.validFor", { min: Math.floor((remaining ?? 0) / 60), sec: String((remaining ?? 0) % 60).padStart(2, "0") })}
          </p>
        </div>
      )}

      {(!code || expired) && (
        <>
          {expired && <p className="mt-4 text-[13px] text-stone-400">{t("code.expired")}</p>}
          <button
            type="button"
            onClick={() => void ask()}
            disabled={busy}
            className="lux-btn lux-btn-ghost mt-4 w-full !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-60"
            style={{ borderRadius: 16 }}
          >
            {busy ? t("code.sending") : expired ? t("code.again") : t("code.ask")}
          </button>
        </>
      )}
    </section>
  );
}

// --- Réception --------------------------------------------------------------

function ReceiptCard({ order, onDone }: { order: OrderDetail; onDone: () => Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmOrderReceipt(order.id);
      await onDone();
    } catch (err) {
      setError(errorMessage(err, t("receipt.failed")));
      setBusy(false);
    }
  }

  return (
    <section className="dash-card border-[rgba(255,106,50,0.28)] p-5">
      <h2 className="text-[15px] font-semibold text-white">{t("receipt.title")}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-stone-400">
        {t("receipt.lead", { until: order.autoConfirmAt ? t("receipt.until", { date: fmtDate(t.intl, order.autoConfirmAt) }) : "" })}
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
          {busy ? t("receipt.confirming") : t("receipt.yes")}
        </button>
        <a
          href="#signaler"
          className="lux-btn lux-btn-ghost !min-h-[44px] flex-1 text-[12px] uppercase tracking-[0.14em]"
          style={{ borderRadius: 16 }}
        >
          {t("receipt.no")}
        </a>
      </div>
    </section>
  );
}

// --- Avis après réception -----------------------------------------------------

function ReviewCard({ order, onDone }: { order: OrderDetail; onDone: () => Promise<void> }) {
  const t = useT();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (rating < 1) return setError(t("review.pick"));
    setBusy(true);
    setError(null);
    try {
      await submitOrderReview(order.id, { rating, comment: comment.trim() || undefined });
      await onDone();
    } catch (err) {
      setError(errorMessage(err, t("review.failed")));
    } finally {
      setBusy(false);
    }
  }

  if (order.review) {
    return (
      <section className="dash-card p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("review.title")}</h2>
        <p className="mt-2 text-[18px] text-[var(--lux-gold)]" aria-label={t("review.star", { n: order.review.rating })}>
          {"★".repeat(order.review.rating)}
          <span className="text-stone-600">{"★".repeat(5 - order.review.rating)}</span>
        </p>
        {order.review.comment && <p className="mt-2 text-[13.5px] text-stone-300">« {order.review.comment} »</p>}
        <p className="mt-2 text-[12px] text-[#6ee7b7]">{t("review.thanks")}</p>
      </section>
    );
  }

  return (
    <section className="dash-card p-5">
      <h2 className="text-[15px] font-semibold text-white">{t("review.title")}</h2>
      <p className="mt-1 text-[13px] text-stone-400">{t("review.lead")}</p>
      <form onSubmit={(e) => void send(e)} className="mt-4 space-y-3">
        <div className="flex gap-1" role="radiogroup" aria-label={t("review.title")}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={t("review.star", { n })}
              onClick={() => setRating(n)}
              className={`text-[28px] leading-none transition ${n <= rating ? "text-[var(--lux-gold)]" : "text-stone-600 hover:text-stone-400"}`}
            >
              ★
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-stone-500">{t("review.comment")}</span>
          <textarea
            maxLength={500}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("review.placeholder")}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-[14px] text-stone-100 placeholder:text-stone-600 focus:border-[rgba(255,106,50,0.6)] focus:outline-none"
          />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <button
          type="submit"
          disabled={busy}
          className="lux-btn lux-btn-gold !min-h-[42px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-50"
          style={{ borderRadius: 16 }}
        >
          {busy ? t("review.sending") : t("review.send")}
        </button>
      </form>
    </section>
  );
}

// --- Mensualités ------------------------------------------------------------

function InstallmentTimeline({ orderId, schedule }: { orderId: string; schedule: Schedule }) {
  const t = useT();
  const reviewing = schedule.reviewing;
  // Les mois en vérification ne se repaient pas : on ne propose que la suite.
  const open = schedule.installments.filter(
    (l) => l.status !== "PAID" && l.status !== "WAIVED" && l.status !== "CANCELLED" && !reviewing?.months.includes(l.index),
  );
  // Apport pas encore payé : il est toujours inclus, et le client peut y
  // ajouter un ou plusieurs mois dans le même paiement.
  const downDue = !schedule.downPaid && !reviewing?.downPayment;
  // Sélection contiguë : choisir un mois inclut tous les mois non payés avant lui.
  const [months, setMonths] = useState(downDue ? 0 : open.length > 0 ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = open.slice(0, months);
  const amount = (downDue ? schedule.downPaymentAmount : 0) + selected.reduce((sum, l) => sum + (l.amountDue - l.amountPaid), 0);
  const pct = schedule.totalAmount > 0 ? Math.min(100, Math.round((schedule.totalPaid / schedule.totalAmount) * 100)) : 0;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await payNextInstallment(orderId, months);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(errorMessage(err, t("plan.failed")));
      setBusy(false);
    }
  }

  return (
    <section className="dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">{t("plan.title")}</h2>
          <p className="mt-1 text-[13px] text-stone-400">
            {t("plan.summary", { paid: schedule.installments.filter((l) => l.status === "PAID").length, total: schedule.monthCount, remaining: formatXof(schedule.remainingAmount) })}
          </p>
        </div>
        <span className="text-[13px] tabular-nums text-stone-400">{pct} %</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-[linear-gradient(90deg,#ffa070,#ff6a32)]" style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-5 space-y-2">
        <li
          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13px] ${
            downDue ? "border-[rgba(255,106,50,0.55)] bg-[rgba(232,71,36,0.12)]" : "border-white/[0.06] bg-white/[0.02]"
          }`}
        >
          <span className="flex items-center gap-3">
            <MonthDot state={schedule.downPaid ? "paid" : reviewing?.downPayment ? "review" : "due"} selected={downDue} />
            <span className="text-stone-200">{t("plan.downPayment")}</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="tabular-nums text-stone-100">{formatXof(schedule.downPaymentAmount)}</span>
            <MonthTag state={schedule.downPaid ? "paid" : reviewing?.downPayment ? "review" : "due"} />
          </span>
        </li>
        {schedule.installments.map((line) => {
          const openIndex = open.findIndex((o) => o.index === line.index);
          const isOpen = openIndex >= 0;
          const isSelected = isOpen && openIndex < months;
          const state: MonthState =
            line.status === "PAID" || line.status === "WAIVED"
              ? "paid"
              : reviewing?.months.includes(line.index)
                ? "review"
                : line.status === "OVERDUE"
                  ? "late"
                  : "due";
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
                    <span className="block capitalize text-stone-200">{fmtMonth(t.intl, line.dueDate)}</span>
                    <span className="block text-[11.5px] text-stone-500">
                      {line.paidAt
                        ? t("plan.paidOn", { label: t("plan.label", { n: line.index, total: schedule.monthCount }), date: fmtDate(t.intl, line.paidAt) })
                        : t("plan.dueBy", { label: t("plan.label", { n: line.index, total: schedule.monthCount }), date: fmtDate(t.intl, line.dueDate) })}
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

      {reviewing && (
        <p className="mt-4 rounded-xl border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] px-3 py-2.5 text-[12.5px] text-stone-200">
          {t("plan.reviewing", { amount: formatXof(reviewing.amount) })}
        </p>
      )}

      {(downDue || open.length > 0) && !reviewing && (
        <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-stone-400">
            {downDue
              ? months === 0
                ? t("plan.downOnly")
                : t("plan.downPlus", { n: months })
              : months === 0
                ? t("plan.pick")
                : months > 1
                  ? t("plan.selectedMany", { n: months })
                  : t("plan.selectedOne")}
            {amount > 0 && <span className="font-semibold tabular-nums text-white">{formatXof(amount)}</span>}
            {downDue && open.length > 0 && <span className="mt-1 block text-[12px] text-stone-500">{t("plan.addMonths")}</span>}
          </p>
          <button
            type="button"
            onClick={() => void pay()}
            disabled={busy || amount === 0}
            className="lux-btn lux-btn-gold !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-50 sm:w-auto"
            style={{ borderRadius: 16 }}
          >
            {busy
              ? t("plan.opening")
              : downDue
                ? months === 0
                  ? t("plan.payDown")
                  : t("plan.payDownPlus", { n: months })
                : months > 1
                  ? t("plan.payMany", { n: months })
                  : t("plan.payOne")}
          </button>
        </div>
      )}
      {schedule.fullyPaid && <p className="mt-4 text-[13px] text-[#6ee7b7]">{t("plan.done")}</p>}
    </section>
  );
}

type MonthState = "paid" | "due" | "late" | "review";

function MonthDot({ state, selected = false }: { state: MonthState; selected?: boolean }) {
  const cls =
    state === "paid"
      ? "border-[#10b981] bg-[#10b981]"
      : state === "review"
        ? "border-[#fbbf24] bg-[#fbbf24]/40"
        : selected
        ? "border-[#ff6a32] bg-[#ff6a32]"
        : state === "late"
          ? "border-[#ef4444] bg-transparent"
          : "border-white/30 bg-transparent";
  return <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full border-2 ${cls}`} />;
}

function MonthTag({ state }: { state: MonthState }) {
  const t = useT();
  const map = {
    paid: { label: "plan.tagPaid" as MessageKey, cls: "text-[#6ee7b7]" },
    due: { label: "plan.tagDue" as MessageKey, cls: "text-stone-400" },
    late: { label: "plan.tagLate" as MessageKey, cls: "text-[#fca5a5]" },
    review: { label: "plan.tagReview" as MessageKey, cls: "text-[#fbbf24]" },
  } as const;
  return <span className={`w-16 text-right text-[11px] font-semibold uppercase tracking-[0.08em] ${map[state].cls}`}>{t(map[state].label)}</span>;
}

// --- Signalement ------------------------------------------------------------

const REASONS: Array<{ value: ReportReason; label: MessageKey; subject: MessageKey }> = [
  { value: "SELLER_REPORT", label: "report.sellerLabel", subject: "report.sellerSubject" },
  { value: "DELIVERY", label: "report.deliveryLabel", subject: "report.deliverySubject" },
  { value: "VERIFICATION_CODE", label: "report.codeLabel", subject: "report.codeSubject" },
  { value: "OTHER", label: "report.otherLabel", subject: "report.otherSubject" },
];

function ReportCard({ order, onDone }: { order: OrderDetail; onDone: () => Promise<void> }) {
  const t = useT();
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
        subject: `${t(picked.subject)} — ${order.orderNumber}`,
        description: message,
      });
      setSent(ticket.code);
      setOpen(false);
      setMessage("");
      await onDone();
    } catch (err) {
      setError(errorMessage(err, t("report.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="signaler" className="dash-card scroll-mt-28 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">{t("report.title")}</h2>
          <p className="mt-1 text-[13px] text-stone-400">
            {t("report.lead")}
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-[rgba(239,68,68,0.4)] px-4 py-2 text-[12.5px] font-medium text-[#fca5a5] hover:bg-[rgba(239,68,68,0.08)]"
          >
            {t("report.open")}
          </button>
        )}
      </div>

      {sent && (
        <div className="mt-4">
          <Alert tone="success" title={t("report.sentTitle")}>
            {t("report.sentBody", { code: sent })}
          </Alert>
        </div>
      )}

      {open && (
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-[12px] uppercase tracking-[0.14em] text-stone-500">{t("report.reason")}</legend>
            {REASONS.map((r) => (
              <label
                key={r.value}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-[13.5px] ${
                  reason === r.value ? "border-[rgba(255,106,50,0.5)] bg-[rgba(232,71,36,0.08)] text-white" : "border-white/[0.08] text-stone-300"
                }`}
              >
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[#ff6a32]" />
                {t(r.label)}
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="text-[12px] uppercase tracking-[0.14em] text-stone-500">{t("report.describe")}</span>
            <textarea
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("report.placeholder")}
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
              {busy ? t("report.sending") : t("report.send")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-4 text-[13px] text-stone-400 hover:text-white">
              {t("report.cancel")}
            </button>
          </div>
          <WhatsappUrgentLine orderNumber={order.orderNumber} />
        </form>
      )}

      {order.reports.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
          {order.reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-stone-300">{r.subject}</span>
              <span className="shrink-0 text-[12px] text-stone-500">
                {fmtDate(t.intl, r.createdAt)} · {r.status === "RESOLVED" || r.status === "CLOSED" ? t("report.done") : t("report.reviewing")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
