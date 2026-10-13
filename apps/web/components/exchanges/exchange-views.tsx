"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { errorMessage, formatXof } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { IconCheck, IconSwap } from "@/components/dash/dash-icons";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  OPEN_STATUSES,
  exchangesApi,
  statusTone,
  type ClientAccount,
  type Exchange,
  type ExchangeStatus,
  type ExchangeSummary,
} from "@/lib/exchanges";

// ---------------------------------------------------------------------------
// Écrans d'un échange, partagés : le client (Mes échanges), le vendeur (Espace
// vendeur → Échanges) et l'équipe (console). Le serveur dit ce que chacun peut
// faire (actions) ; l'écran n'affiche que cela.
// ---------------------------------------------------------------------------

type Side = Exchange["side"];

const fmtDate = (locale: string, iso: string) =>
  new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ExchangeStatusPill({ status }: { status: ExchangeStatus }) {
  const t = useT();
  return (
    <span className={`dash-pill ${statusTone(status)}`}>
      {t(`xch.status.${status}` as MessageKey)}
    </span>
  );
}

function Thumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- bucket public R2
    <img
      src={url}
      alt=""
      className="h-12 w-16 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <span className="grid h-12 w-16 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-[#ff8a5c]">
      <IconSwap />
    </span>
  );
}

/** Liste des demandes (client, vendeur ou équipe). */
export function ExchangeList({
  items,
  loading,
  error,
  base,
  side,
  empty,
}: {
  items: ExchangeSummary[];
  loading: boolean;
  error: string | null;
  base: string;
  side: Side;
  empty: ReactNode;
}) {
  const t = useT();
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[#b8a6a1]">
        <Spinner /> {t("account.loading")}
      </p>
    );
  }
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (items.length === 0)
    return (
      <div className="text-[13px] leading-relaxed text-[#b8a6a1]">{empty}</div>
    );
  return (
    <ul className="divide-y divide-white/[0.06]">
      {items.map((e) => (
        <li key={e.id}>
          <Link
            href={`${base}?id=${e.id}`}
            className="flex items-start gap-3 py-3 transition hover:bg-white/[0.02]"
          >
            <Thumb url={e.product.imageUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-white">
                {e.product.title}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[#8f7d77]">
                {e.number} · {e.counterpart}
                {side === "team" && e.sellerName ? ` → ${e.sellerName}` : ""}
                {e.topUpAmount !== null &&
                  ` · ${e.topUpAmount > 0 ? t("xch.topUp", { amount: formatXof(e.topUpAmount) }) : t("xch.topUpZero")}`}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                <ExchangeStatusPill status={e.status} />
                {e.waitingFor === side && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ff8a5c]">
                    {t("xch.waitingYou")}
                  </span>
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Étapes ------------------------------------------------------------------

const STEPS: Array<{ key: MessageKey; reached: ExchangeStatus[] }> = [
  {
    key: "xch.stepSent",
    reached: ["PENDING", "QUOTED", "ACCEPTED", "AWAITING_PAYMENT", "COMPLETED"],
  },
  {
    key: "xch.stepReply",
    reached: ["QUOTED", "ACCEPTED", "AWAITING_PAYMENT", "COMPLETED"],
  },
  { key: "xch.stepCustody", reached: ["AWAITING_PAYMENT", "COMPLETED"] },
  { key: "xch.stepPayment", reached: ["COMPLETED"] },
  { key: "xch.stepDone", reached: ["COMPLETED"] },
];

function Steps({ status }: { status: ExchangeStatus }) {
  const t = useT();
  if (!OPEN_STATUSES.includes(status) && status !== "COMPLETED") return null;
  // Étape en cours : la première pas encore atteinte (sur téléphone, seul son libellé s'affiche).
  const current = STEPS.findIndex((s) => !s.reached.includes(status));
  return (
    <div>
      <ol className="flex items-center gap-1.5 sm:grid sm:grid-cols-5 sm:gap-2">
        {STEPS.map((step, i) => {
          const done = step.reached.includes(status);
          const now = i === current;
          return (
            <li
              key={step.key}
              aria-current={now ? "step" : undefined}
              className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-[11.5px] sm:px-3 sm:py-2 ${
                done
                  ? "border-[rgba(134,239,172,0.3)] bg-[rgba(34,197,94,0.07)] text-[#d9f5e2]"
                  : now
                    ? "border-[rgba(255,106,50,0.4)] text-[#ffd8c4]"
                    : "border-white/[0.07] text-[#8f7d77]"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${done ? "bg-[#22c55e] text-[#05210f]" : "bg-white/[0.06]"}`}
              >
                {done ? <IconCheck size={12} /> : i + 1}
              </span>
              <span className="sr-only sm:not-sr-only">{t(step.key)}</span>
            </li>
          );
        })}
      </ol>
      {current >= 0 && (
        <p className="mt-2 text-[12px] text-[#ffd8c4] sm:hidden">
          {t("xch.stepOf", {
            n: current + 1,
            total: STEPS.length,
            label: t(STEPS[current]!.key),
          })}
        </p>
      )}
    </div>
  );
}

// --- Détail ------------------------------------------------------------------

function Card({
  title,
  children,
  tone,
}: {
  title?: string;
  children: ReactNode;
  tone?: "accent";
}) {
  return (
    <section
      className={`dash-card space-y-3 p-5 ${tone === "accent" ? "border-[rgba(255,106,50,0.35)]" : ""}`}
    >
      {title && (
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      )}
      {children}
    </section>
  );
}

const inputCls = "dash-input !pl-4";

export function ExchangeDetail({
  id,
  backHref,
}: {
  id: string;
  backHref: string;
}) {
  const t = useT();
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setExchange(await exchangesApi.get(id));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Échange en cours : la page suit les réponses de l'autre côté.
  useVisiblePoll(load, 15_000, {
    enabled: Boolean(exchange && OPEN_STATUSES.includes(exchange.status)),
  });

  async function act(run: () => Promise<Exchange | unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await run();
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        "side" in result
      )
        setExchange(result as Exchange);
      else await load();
      if (done) setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!exchange) {
    return error ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <p className="flex items-center gap-2 text-[13px] text-[#b8a6a1]">
        <Spinner /> {t("account.loading")}
      </p>
    );
  }

  const e = exchange;
  const topUp = e.topUpAmount ?? 0;
  const locale = t.intl;

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="text-[12.5px] text-[#ff8a5c] hover:underline"
      >
        ← {t("xch.back")}
      </Link>

      <section className="dash-card flex items-start gap-4 p-5">
        <Thumb url={e.product.imageUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#8f7d77]">
            {e.number} · {fmtDate(locale, e.createdAt)}
          </p>
          {e.product.available ? (
            <Link
              href={`/catalogue/${e.product.slug}`}
              className="mt-1 block truncate text-[17px] font-semibold text-white hover:underline"
            >
              {e.product.title}
            </Link>
          ) : (
            <p className="mt-1 truncate text-[17px] font-semibold text-white">
              {e.product.title}
            </p>
          )}
          <p className="mt-0.5 text-[12.5px] text-[#b8a6a1]">
            {e.side === "client" ? e.seller : e.client?.name}
            {e.side === "team" && e.client?.email ? ` · ${e.client.email}` : ""}
            {e.side === "team" ? ` → ${e.seller}` : ""}
          </p>
          <div className="mt-2">
            <ExchangeStatusPill status={e.status} />
          </div>
        </div>
      </section>

      <Steps status={e.status} />

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <SidePanel exchange={e} busy={busy} act={act} />

      {/* Le compte proposé par le client : ID, code attendu, vidéo, message. */}
      <Card
        title={e.side === "client" ? t("xch.yourAccount") : t("xch.yourVideo")}
      >
        <p className="text-[13px] text-[#e9dad3]">
          {t("xch.clientGameId", { id: e.gameAccountId })}
        </p>
        {e.side === "client" ? (
          <p className="text-[12.5px] text-[#b8a6a1]">
            {t("xch.proofShown", { code: e.proofCode })}
          </p>
        ) : (
          <p className="text-[12.5px] font-medium text-[#fcd9a5]">
            {t("xch.checkCode", { code: e.proofCode })}
          </p>
        )}
        {e.message && (
          <p className="text-[12.5px] italic text-[#b8a6a1]">
            {t("xch.clientMessage", { message: e.message })}
          </p>
        )}
        {e.video ? (
          <video
            src={e.video.url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[60vh] w-full rounded-xl bg-black"
          />
        ) : (
          e.videoPurged && (
            <p className="text-[12px] text-[#8f7d77]">{t("xch.videoGone")}</p>
          )
        )}
      </Card>

      {e.closeReason &&
        !OPEN_STATUSES.includes(e.status) &&
        e.status !== "COMPLETED" && (
          <Alert tone="warning">
            {t("xch.closed", { reason: e.closeReason })}
          </Alert>
        )}

      {e.side === "client" && OPEN_STATUSES.includes(e.status) && (
        <p className="text-[11.5px] leading-relaxed text-[#f5d9a8]">
          {t("xch.offsite")}
        </p>
      )}
      {topUp > 0 && e.side !== "client" && e.status === "COMPLETED" && (
        <p className="text-[12px] text-[#8f7d77]">
          {t("xch.topUp", { amount: formatXof(topUp) })}
        </p>
      )}
    </div>
  );
}

type Act = (run: () => Promise<unknown>, done?: string) => Promise<void>;

function SidePanel({
  exchange: e,
  busy,
  act,
}: {
  exchange: Exchange;
  busy: boolean;
  act: Act;
}) {
  if (e.side === "client")
    return <ClientPanel exchange={e} busy={busy} act={act} />;
  return (
    <>
      {e.actions.reply && <ReplyPanel exchange={e} busy={busy} act={act} />}
      {e.side === "seller" ? (
        <SellerPanel exchange={e} busy={busy} act={act} />
      ) : (
        <TeamPanel exchange={e} busy={busy} act={act} />
      )}
    </>
  );
}

function Busy({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      {busy && <Spinner />} {children}
    </>
  );
}

// --- Client --------------------------------------------------------------------

function ClientPanel({
  exchange: e,
  busy,
  act,
}: {
  exchange: Exchange;
  busy: boolean;
  act: Act;
}) {
  const t = useT();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [code, setCode] = useState("");
  const topUp = e.topUpAmount ?? 0;

  const cancel = e.actions.cancel && (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        window.confirm(t("xch.cancelConfirm")) &&
        void act(() => exchangesApi.cancel(e.id))
      }
      className="text-[12px] text-[#b8a6a1] underline-offset-2 hover:underline disabled:opacity-60"
    >
      {t("xch.cancel")}
    </button>
  );

  if (e.status === "PENDING") {
    return (
      <Card>
        <p className="text-[13px] text-[#e9dad3]">
          {t("xch.waitSeller", { date: fmtDate(t.intl, e.replyDeadline) })}
        </p>
        {cancel}
      </Card>
    );
  }

  if (e.status === "QUOTED") {
    const accept = (event: FormEvent) => {
      event.preventDefault();
      void act(() =>
        exchangesApi.accept(e.id, {
          paymentMode: monthly ? "INSTALLMENTS" : "ONE_TIME",
          login: login.trim(),
          password,
        }),
      );
    };
    return (
      <Card title={t("xch.quoteTitle")} tone="accent">
        <p className="text-[15px] font-semibold text-white">
          {topUp > 0
            ? t("xch.quoteBody", {
                amount: formatXof(topUp),
                title: e.product.title,
              })
            : t("xch.quoteZero", { title: e.product.title })}
        </p>
        {e.replyMessage && (
          <p className="text-[12.5px] italic text-[#b8a6a1]">
            {t("xch.sellerNote", { message: e.replyMessage })}
          </p>
        )}
        {e.quoteExpiresAt && (
          <p className="text-[12px] text-[#fcd9a5]">
            {t("xch.quoteExpires", { date: fmtDate(t.intl, e.quoteExpiresAt) })}
          </p>
        )}
        <form
          onSubmit={accept}
          className="space-y-3 border-t border-white/[0.06] pt-3"
        >
          <h3 className="text-[13.5px] font-semibold text-white">
            {t("xch.acceptTitle")}
          </h3>
          <p className="text-[12px] leading-relaxed text-[#b8a6a1]">
            {t("xch.acceptLead")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] text-[#cdbab3]">
              {t("xch.login")}
              <input
                value={login}
                onChange={(ev) => setLogin(ev.target.value)}
                required
                minLength={3}
                autoComplete="off"
                className={`${inputCls} mt-1.5`}
              />
            </label>
            <label className="block text-[12px] text-[#cdbab3]">
              {t("xch.password")}
              <input
                type="password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                required
                autoComplete="new-password"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </div>
          {topUp > 0 && e.product.canSplit && (
            <fieldset className="space-y-1.5 text-[13px] text-[#e9dad3]">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!monthly}
                  onChange={() => setMonthly(false)}
                  className="accent-[#ff6a32]"
                />{" "}
                {t("xch.payOnce")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={monthly}
                  onChange={() => setMonthly(true)}
                  className="accent-[#ff6a32]"
                />{" "}
                {t("xch.payMonthly")}
              </label>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="dash-btn dash-btn-primary disabled:opacity-60"
            >
              <Busy busy={busy}>{t("xch.accept")}</Busy>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => exchangesApi.decline(e.id))}
              className="dash-btn dash-btn-ghost disabled:opacity-60"
            >
              {t("xch.decline")}
            </button>
          </div>
        </form>
      </Card>
    );
  }

  if (e.status === "ACCEPTED") {
    const send = (event: FormEvent) => {
      event.preventDefault();
      void act(
        () => exchangesApi.provideCode(e.id, code),
        t("xch.codeSent"),
      ).then(() => setCode(""));
    };
    return (
      <Card>
        {e.actions.provideCode && !e.custody.codeProvided ? (
          <form onSubmit={send} className="space-y-3">
            <h3 className="text-[14px] font-semibold text-white">
              {t("xch.codeTitle")}
            </h3>
            <p className="text-[12.5px] text-[#b8a6a1]">{t("xch.codeLead")}</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                required
                minLength={3}
                maxLength={30}
                inputMode="text"
                placeholder={t("xch.codeInput")}
                className={`${inputCls} max-w-[220px]`}
              />
              <button
                type="submit"
                disabled={busy}
                className="dash-btn dash-btn-primary disabled:opacity-60"
              >
                <Busy busy={busy}>{t("xch.codeSend")}</Busy>
              </button>
            </div>
          </form>
        ) : (
          <p className="text-[13px] text-[#e9dad3]">{t("xch.custodyWait")}</p>
        )}
        {cancel}
      </Card>
    );
  }

  if (e.status === "AWAITING_PAYMENT") {
    return (
      <Card title={t("xch.payTitle")} tone="accent">
        <p className="text-[13.5px] text-[#e9dad3]">
          {t("xch.payBody", {
            amount: formatXof(topUp),
            title: e.product.title,
          })}
        </p>
        {e.order?.paymentUnderReview ? (
          <p className="text-[12.5px] text-[#fcd9a5]">{t("xch.payReview")}</p>
        ) : (
          e.order?.checkoutUrl && (
            <Link
              href={e.order.checkoutUrl}
              className="dash-btn dash-btn-primary w-fit"
            >
              {t("xch.pay")}
            </Link>
          )
        )}
        {e.order?.id && (
          <Link
            href={`/account/orders/${e.order.id}`}
            className="block text-[12px] text-[#ff8a5c] hover:underline"
          >
            {t("xch.openOrder")}
          </Link>
        )}
        {cancel}
      </Card>
    );
  }

  if (e.status === "COMPLETED") {
    return (
      <Card tone="accent">
        <p className="text-[13.5px] text-[#e9dad3]">
          {t("xch.doneBody", { title: e.product.title })}
        </p>
        {e.order?.id && (
          <Link
            href={`/account/orders/${e.order.id}`}
            className="dash-btn dash-btn-primary w-fit"
          >
            {t("xch.openOrder")}
          </Link>
        )}
      </Card>
    );
  }

  return e.status === "REJECTED" && e.replyMessage ? (
    <Alert tone="warning">
      {t("xch.sellerNote", { message: e.replyMessage })}
    </Alert>
  ) : null;
}

// --- Réponse (vendeur, ou équipe pour un compte MISTERDOU) ---------------------------

function ReplyPanel({
  exchange: e,
  busy,
  act,
}: {
  exchange: Exchange;
  busy: boolean;
  act: Act;
}) {
  const t = useT();
  const [amount, setAmount] = useState(
    e.topUpAmount !== null ? String(e.topUpAmount) : "",
  );
  const [message, setMessage] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const value = Number(amount.replace(/\s/g, ""));

  const quote = (event: FormEvent) => {
    event.preventDefault();
    void act(() =>
      exchangesApi.reply(e.id, {
        decision: "quote",
        topUpAmount: value,
        message: message.trim() || null,
      }),
    );
  };
  const reject = (event: FormEvent) => {
    event.preventDefault();
    void act(() =>
      exchangesApi.reply(e.id, { decision: "reject", message: reason.trim() }),
    );
  };

  return (
    <Card
      title={e.status === "QUOTED" ? t("xch.requote") : t("xch.replyTitle")}
      tone="accent"
    >
      {e.status === "PENDING" && (
        <p className="text-[12px] text-[#fcd9a5]">
          {t("xch.replyDeadline", { date: fmtDate(t.intl, e.replyDeadline) })}
        </p>
      )}
      {e.status === "QUOTED" && e.quoteExpiresAt && (
        <p className="text-[12px] text-[#b8a6a1]">
          {t("xch.sellerWaitClient", {
            date: fmtDate(t.intl, e.quoteExpiresAt),
          })}
        </p>
      )}
      {!rejecting ? (
        <form onSubmit={quote} className="space-y-3">
          <label className="block text-[12px] text-[#cdbab3]">
            {t("xch.replyAmount")}
            <input
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              required
              inputMode="numeric"
              className={`${inputCls} mt-1.5 max-w-[220px]`}
            />
            <span className="mt-1 block text-[11px] text-[#8f7d77]">
              {Number.isInteger(value) && value > 0
                ? formatXof(value) + " · "
                : ""}
              {t("xch.replyAmountHint")}
            </span>
          </label>
          <label className="block text-[12px] text-[#cdbab3]">
            {t("xch.replyMessage")}
            <input
              value={message}
              onChange={(ev) => setMessage(ev.target.value)}
              maxLength={500}
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy || !Number.isInteger(value) || value < 0}
              className="dash-btn dash-btn-primary disabled:opacity-60"
            >
              <Busy busy={busy}>{t("xch.replyQuote")}</Busy>
            </button>
            {e.status === "PENDING" && (
              <button
                type="button"
                onClick={() => setRejecting(true)}
                className="dash-btn dash-btn-ghost"
              >
                {t("xch.replyReject")}
              </button>
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={reject} className="space-y-3">
          <label className="block text-[12px] text-[#cdbab3]">
            {t("xch.rejectReason")}
            <input
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              required
              minLength={3}
              maxLength={500}
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="dash-btn dash-btn-primary disabled:opacity-60"
            >
              <Busy busy={busy}>{t("xch.replyReject")}</Busy>
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="dash-btn dash-btn-ghost"
            >
              ←
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// --- Vendeur -----------------------------------------------------------------------

function Credentials({ account }: { account: ClientAccount }) {
  const t = useT();
  return (
    <dl className="grid gap-2 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-[13px] sm:grid-cols-2">
      <div>
        <dt className="text-[11px] text-[#8f7d77]">{t("xch.loginLabel")}</dt>
        <dd className="select-all break-all font-mono text-white">
          {account.login}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] text-[#8f7d77]">{t("xch.passwordLabel")}</dt>
        <dd className="select-all break-all font-mono text-white">
          {account.password}
        </dd>
      </div>
      {account.code && (
        <div className="sm:col-span-2">
          <dt className="text-[11px] text-[#8f7d77]">{t("xch.codeInput")}</dt>
          <dd className="select-all font-mono text-[18px] tracking-[0.2em] text-[#86efac]">
            {account.code}
          </dd>
        </div>
      )}
    </dl>
  );
}

function SellerPanel({
  exchange: e,
  busy,
  act,
}: {
  exchange: Exchange;
  busy: boolean;
  act: Act;
}) {
  const t = useT();
  const [account, setAccount] = useState<ClientAccount | null>(null);
  const [report, setReport] = useState("");

  if (e.status === "ACCEPTED")
    return <Alert tone="info">{t("xch.sellerWaitCustody")}</Alert>;
  if (e.status === "AWAITING_PAYMENT")
    return <Alert tone="info">{t("xch.sellerWaitPayment")}</Alert>;
  if (e.status !== "COMPLETED") return null;

  return (
    <>
      {e.actions.revealClientAccount && (
        <Card title={t("xch.clientAccount")} tone="accent">
          <p className="text-[12.5px] text-[#fcd9a5]">{t("xch.revealLead")}</p>
          {account ? (
            <Credentials account={account} />
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () =>
                  setAccount(await exchangesApi.clientAccount(e.id)),
                )
              }
              className="dash-btn dash-btn-primary w-fit disabled:opacity-60"
            >
              <Busy busy={busy}>{t("xch.reveal")}</Busy>
            </button>
          )}
        </Card>
      )}
      {e.actions.report && (
        <Card title={t("xch.report")}>
          <p className="text-[12px] text-[#b8a6a1]">{t("xch.reportLead")}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                () => exchangesApi.report(e.id, report.trim()),
                t("xch.reportSent"),
              ).then(() => setReport(""));
            }}
            className="space-y-2"
          >
            <textarea
              value={report}
              onChange={(ev) => setReport(ev.target.value)}
              required
              minLength={10}
              maxLength={2000}
              rows={3}
              placeholder={t("xch.reportPlaceholder")}
              className={`${inputCls} !h-auto py-3`}
            />
            <button
              type="submit"
              disabled={busy}
              className="dash-btn dash-btn-ghost disabled:opacity-60"
            >
              <Busy busy={busy}>{t("xch.reportSend")}</Busy>
            </button>
          </form>
        </Card>
      )}
    </>
  );
}

// --- Équipe (console, en français) ---------------------------------------------------

function TeamPanel({
  exchange: e,
  busy,
  act,
}: {
  exchange: Exchange;
  busy: boolean;
  act: Act;
}) {
  const [account, setAccount] = useState<ClientAccount | null>(null);
  const [note, setNote] = useState("");
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const reveal = () =>
    act(async () => setAccount(await exchangesApi.clientAccount(e.id)));

  return (
    <>
      {e.actions.revealClientAccount && (
        <Card
          title={
            e.status === "ACCEPTED"
              ? "Compte confié par le client — à vérifier"
              : "Compte du client"
          }
          tone={e.status === "ACCEPTED" ? "accent" : undefined}
        >
          {e.status === "ACCEPTED" && (
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-[#b8a6a1]">
              <li>
                Affichez les identifiants et connectez-vous au compte dans le
                jeu.
              </li>
              <li>
                Si le jeu demande un code, touchez « Demander le code au client
                » : il le saisit sur sa page (valable 10 min).
              </li>
              <li>
                Comparez avec la vidéo (code {e.proofCode}, ID {e.gameAccountId}
                , puissance, joueurs, pièces).
              </li>
              <li>
                Validez, ou refusez avec un motif : le client est prévenu et
                l’offre revient en vente.
              </li>
            </ol>
          )}
          {account ? (
            <Credentials account={account} />
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void reveal()}
              className="dash-btn dash-btn-primary w-fit disabled:opacity-60"
            >
              <Busy busy={busy}>Afficher les identifiants (tracé)</Busy>
            </button>
          )}
          {e.status === "ACCEPTED" && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => exchangesApi.requestCode(e.id),
                    "Le client est prévenu : son code s’affichera ici.",
                  )
                }
                className="dash-btn dash-btn-ghost disabled:opacity-60"
              >
                Demander le code au client
              </button>
              {e.custody.codeRequested && !e.custody.codeProvided && (
                <span className="text-[12px] text-[#fcd9a5]">
                  Code demandé, en attente du client…
                </span>
              )}
              {e.custody.codeProvided && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reveal()}
                  className="text-[12px] text-[#86efac] underline-offset-2 hover:underline"
                >
                  Code reçu : l’afficher
                </button>
              )}
            </div>
          )}
        </Card>
      )}

      {e.actions.custody && (
        <Card title="Décision sur le compte du client">
          {!refusing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(
                  () =>
                    exchangesApi.custody(e.id, {
                      decision: "confirm",
                      note: note.trim() || null,
                    }),
                  "Compte validé : la suite est envoyée au client.",
                );
              }}
              className="space-y-3"
            >
              <input
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                maxLength={500}
                placeholder="Note interne (facultatif)"
                className={inputCls}
              />
              <p className="text-[12px] text-[#8f7d77]">
                {(e.topUpAmount ?? 0) > 0
                  ? `Après validation, le client règle ${formatXof(e.topUpAmount ?? 0)} ; l’échange se conclut au paiement.`
                  : "Échange direct : la validation conclut l’échange tout de suite (remise croisée)."}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="dash-btn dash-btn-primary disabled:opacity-60"
                >
                  <Busy busy={busy}>Compte conforme : valider</Busy>
                </button>
                <button
                  type="button"
                  onClick={() => setRefusing(true)}
                  className="dash-btn dash-btn-ghost"
                >
                  Refuser le compte
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(() =>
                  exchangesApi.custody(e.id, {
                    decision: "refuse",
                    reason: reason.trim(),
                  }),
                );
              }}
              className="space-y-3"
            >
              <input
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                required
                minLength={5}
                maxLength={500}
                placeholder="Motif (envoyé au client)"
                className={inputCls}
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="dash-btn dash-btn-primary disabled:opacity-60"
                >
                  <Busy busy={busy}>Refuser</Busy>
                </button>
                <button
                  type="button"
                  onClick={() => setRefusing(false)}
                  className="dash-btn dash-btn-ghost"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}
        </Card>
      )}

      {e.status === "AWAITING_PAYMENT" && (
        <Alert tone="info">
          Compte vérifié{e.custodyNote ? ` (« ${e.custodyNote} »)` : ""} :
          commande {e.order?.orderNumber} en attente du paiement de{" "}
          {formatXof(e.topUpAmount ?? 0)}.
        </Alert>
      )}
      {e.status === "COMPLETED" && !e.actions.revealClientAccount && (
        <Alert tone="success">
          Échange conclu (commande {e.order?.orderNumber}).
        </Alert>
      )}
    </>
  );
}
