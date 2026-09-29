"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorMessage, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useT } from "@/lib/i18n";
import type { T } from "@/lib/i18n";

type CodeRequestRow = {
  id: string;
  status: "PENDING" | "PROVIDED" | "EXPIRED";
  orderId: string;
  orderNumber: string;
  productTitle: string;
  buyerName: string;
  requestedAt: string;
  providedAt: string | null;
  expiresAt: string | null;
  providedBy: string | null;
};

const timeFr = (iso: string, locale: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function waitingFor(iso: string, t: T) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return minutes < 1 ? t("codes.justNow") : minutes < 60 ? t("codes.minutesAgo", { n: minutes }) : t("codes.hoursAgo", { h: Math.floor(minutes / 60), m: minutes % 60 });
}

// ---------------------------------------------------------------------------
// File des demandes de code de vérification. L'API filtre selon la personne :
// l'équipe (admin, managers ORDERS) voit tout, un vendeur ses seuls comptes.
// Premier qui répond, les autres voient la demande traitée.
// ---------------------------------------------------------------------------

export function CodeQueue({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<CodeRequestRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await request<{ items: CodeRequestRow[] }>(`/api/v1/verification-codes?status=${showAll ? "ALL" : "PENDING"}`);
      setRows(data.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t("codes.unavailable")));
    }
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(load, 15_000);

  const pending = rows?.filter((r) => r.status === "PENDING") ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-stone-400">
          {rows === null ? t("codes.loading") : pending.length === 0 ? t("codes.none") : pending.length > 1 ? t("codes.waitingMany", { n: pending.length }) : t("codes.waitingOne")}
        </p>
        <label className="flex items-center gap-2 text-[12.5px] text-stone-400">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-[#ff6a32]" />
          {t("codes.showAll")}
        </label>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {rows === null && !error && (
        <p className="flex items-center gap-2 text-[13px] text-stone-400">
          <Spinner className="h-4 w-4" /> {t("codes.loadingList")}
        </p>
      )}
      <ul className={compact ? "space-y-2" : "space-y-3"}>
        {rows?.map((row) => <CodeRow key={row.id} row={row} onDone={load} />)}
      </ul>
    </div>
  );
}

function CodeRow({ row, onDone }: { row: CodeRequestRow; onDone: () => Promise<void> }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/verification-codes/${row.id}/provide`, { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      setCode("");
      await onDone();
    } catch (err) {
      setError(errorMessage(err, t("codes.sendFailed")));
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-2xl border p-4 ${
        row.status === "PENDING" ? "border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.05)]" : "border-white/[0.07] bg-white/[0.02]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-stone-100">{row.productTitle}</p>
          <p className="mt-0.5 text-[12px] text-stone-400">
            {row.orderNumber} · {row.buyerName} · {t("codes.requested", { ago: waitingFor(row.requestedAt, t) })}
          </p>
        </div>
        {row.status !== "PENDING" && (
          <p className="text-right text-[12px] text-stone-400">
            {row.status === "PROVIDED" ? t("codes.active") : t("codes.expired")}
            {row.providedAt && t("codes.providedAt", { date: timeFr(row.providedAt, t.intl) })}
            {row.providedBy && <span className="block text-stone-500">{t("codes.by", { name: row.providedBy === "Vous" ? t("chat.you") : row.providedBy === "Équipe MISTERDOU" ? t("chat.team") : row.providedBy })}</span>}
          </p>
        )}
      </div>
      {row.status === "PENDING" && (
        <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="text"
            autoComplete="one-time-code"
            placeholder={t("codes.placeholder")}
            aria-label={t("codes.inputLabel", { order: row.orderNumber })}
            maxLength={32}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-[15px] tracking-[0.15em] text-stone-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-stone-600 focus:border-[rgba(255,106,50,0.6)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || code.trim().length < 3}
            className="lux-btn lux-btn-gold !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-50"
            style={{ borderRadius: 14 }}
          >
            {busy ? t("codes.sending") : t("codes.send")}
          </button>
        </form>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </li>
  );
}
