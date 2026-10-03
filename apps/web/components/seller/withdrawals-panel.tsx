"use client";

import { useState, type FormEvent } from "react";
import { ApiClientError, formatXof, request } from "@/lib/api";
import { Alert } from "@/components/ui";
import { useT, type MessageKey } from "@/lib/i18n";

export type SellerWithdrawal = {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
  processingStartedAt: string | null;
  etaMinutes: number | null;
  processedAt: string | null;
  rejectionReason: string | null;
  paymentReference: string | null;
  hasProof: boolean;
  sellerConfirmedAt: string | null;
  sellerDisputedAt: string | null;
};

const ETA_KEYS: Record<number, MessageKey> = { 30: "wd.eta30", 60: "wd.eta60", 720: "wd.eta720" };

const STATUS_TONE: Record<string, string> = {
  PENDING: "dash-pill-due",
  PROCESSING: "dash-pill-due",
  APPROVED: "dash-pill-paid",
  COMPLETED: "dash-pill-paid",
  REJECTED: "dash-pill-none",
  CANCELLED: "dash-pill-none",
};

// ---------------------------------------------------------------------------
// Retrait du solde disponible : le vendeur demande, l'équipe envoie l'argent à
// la main (« en traitement » avec un délai annoncé, puis envoyé avec la capture
// de l'envoi) et le vendeur confirme la réception. Le solde est bloqué dès la
// demande côté serveur.
// ---------------------------------------------------------------------------

export function WithdrawalsPanel({
  available,
  minAmount,
  withdrawals,
  onDone,
}: {
  available: number;
  minAmount: number;
  withdrawals: SellerWithdrawal[];
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const value = Number.parseInt(amount, 10) || 0;
  const date = (iso: string) => new Date(iso).toLocaleDateString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (value < minAmount) return setMessage({ tone: "danger", text: t("wd.tooSmall", { min: formatXof(minAmount) }) });
    if (value > available) return setMessage({ tone: "danger", text: t("wd.tooBig") });
    setBusy(true);
    try {
      await request("/api/v1/seller/withdrawals", {
        method: "POST",
        body: JSON.stringify({ amount: value, method: "WAVE", phoneNumber: phone.trim() }),
      });
      setAmount("");
      setMessage({ tone: "success", text: t("wd.sent") });
      await onDone();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiClientError ? err.message : t("wd.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="retraits" className="dash-card mt-4 scroll-mt-24 p-5">
      <h2 className="text-[15px] font-semibold text-stone-100">{t("wd.title")}</h2>
      <p className="mt-0.5 text-[12px] text-[#8f7d77]">{t("wd.lead")}</p>

      <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-[#b8a6a1]">{t("wd.amount")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={minAmount}
            max={available}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="dash-input !pl-4"
          />
          <span className="mt-1 flex justify-between gap-2 text-[11px] text-[#8f7d77]">
            {t("wd.min", { min: formatXof(minAmount) })}
            {available >= minAmount && (
              <button type="button" onClick={() => setAmount(String(available))} className="text-[#ff8a5c] hover:underline">
                {t("wd.all")}
              </button>
            )}
          </span>
        </label>
        <div className="block">
          <span className="mb-1.5 block text-[12px] text-[#b8a6a1]">{t("wd.method")}</span>
          <span className="dash-input !pl-4 flex items-center text-stone-200">Wave</span>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-[#b8a6a1]">{t("wd.phone")}</span>
          <input
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("wd.phonePlaceholder")}
            className="dash-input !pl-4"
            dir="ltr"
          />
        </label>
        <button type="submit" disabled={busy || available < minAmount} className="dash-btn dash-btn-primary">
          {busy ? t("wd.sending") : t("wd.submit")}
        </button>
      </form>

      {message && (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      <h3 className="mt-6 text-[13px] font-semibold text-stone-200">{t("wd.history")}</h3>
      {withdrawals.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[#8f7d77]">{t("wd.none")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {withdrawals.map((w) => (
            <li key={w.id} className="rounded-xl border border-white/[0.07] px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-semibold tabular-nums text-white">{formatXof(w.amount)}</span>
                <span className={`dash-pill ${STATUS_TONE[w.status] ?? "dash-pill-none"}`}>
                  {t(`wd.status${w.status}` as MessageKey)}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-[#8f7d77]">
                {t("wd.requested", { date: date(w.requestedAt) })}
                {w.status === "PROCESSING" && w.etaMinutes && ETA_KEYS[w.etaMinutes]
                  ? ` · ${t("wd.eta", { eta: t(ETA_KEYS[w.etaMinutes]!) })}`
                  : ""}
                {w.paymentReference ? ` · ${t("wd.reference", { ref: w.paymentReference })}` : ""}
              </p>
              {w.rejectionReason && <p className="mt-1 text-[11.5px] text-[#fca5a5]">{t("wd.reason", { reason: w.rejectionReason })}</p>}
              {w.hasProof && (
                <a
                  href={`/api/v1/seller/withdrawals/${w.id}/proof`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-[12px] text-[#ff8a5c] hover:underline"
                >
                  {t("wd.seeProof")}
                </a>
              )}
              {w.status === "APPROVED" && <ReceiptButtons withdrawal={w} onDone={onDone} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Après l'envoi : « Je l'ai reçu » clôt le retrait, « Pas reçu » alerte l'équipe. */
function ReceiptButtons({ withdrawal, onDone }: { withdrawal: SellerWithdrawal; onDone: () => Promise<void> }) {
  const t = useT();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(received: boolean) {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/seller/withdrawals/${withdrawal.id}/receipt`, {
        method: "POST",
        body: JSON.stringify(received ? { received } : { received, note: note.trim() }),
      });
      setDisputing(false);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("wd.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2.5">
      {withdrawal.sellerDisputedAt && <p className="mb-2 text-[11.5px] text-[#fbbf24]">{t("wd.disputed")}</p>}
      {disputing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void answer(false);
          }}
          className="space-y-2"
        >
          <textarea
            required
            minLength={5}
            maxLength={500}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("wd.notReceivedPlaceholder")}
            className="dash-input !h-auto !pl-4 py-2"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || note.trim().length < 5} className="dash-btn dash-btn-primary">
              {t("wd.sendDispute")}
            </button>
            <button type="button" onClick={() => setDisputing(false)} className="px-3 text-[12px] text-[#b8a6a1] hover:text-white">
              {t("wd.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void answer(true)} className="dash-btn dash-btn-primary">
            {busy ? t("wd.confirming") : t("wd.gotIt")}
          </button>
          {!withdrawal.sellerDisputedAt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDisputing(true)}
              className="rounded-full border border-[rgba(239,68,68,0.4)] px-3.5 py-1.5 text-[12px] text-[#fca5a5] hover:bg-[rgba(239,68,68,0.08)]"
            >
              {t("wd.notReceived")}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-[11.5px] text-[#fca5a5]">{error}</p>}
    </div>
  );
}
