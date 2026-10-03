"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Field, ListPager, SelectInput, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { LuxPageHead, LuxShell, LuxTopBar } from "@/components/lux/lux-shell";
import { SupportContactChoices } from "@/components/support/support-contacts";
import { LuxFooter } from "@/components/lux/lux-footer";
import { errorMessage, isPermissionError, type PageMeta } from "@/lib/api";
import { resolveSession, isAuthError, type SessionUser } from "@/lib/session";
import { fetchMyOrders, type OrderSummary } from "@/lib/orders";
import {
  SUPPORT_CATEGORY_OPTIONS,
  createTicket,
  fetchMyTickets,
  fetchTicket,
  isTicketClosed,
  personLabel,
  updateMyTicket,
  type SupportTicket,
} from "@/lib/support";
import { formatDateTime } from "@/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Aide & support — GET /support/tickets/mine (liste), GET /support/tickets/:id
// (détail), POST /support/tickets (création), PATCH /support/tickets/:id
// { status: RESOLVED | CLOSED }. Sélecteur d’ordre alimenté par
// GET /orders/mine (s’il échoue, le champ est simplement masqué).
// ---------------------------------------------------------------------------

const PER_PAGE = 10;

export default function SupportPage() {
  const t = useT();
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);

  const [tab, setTab] = useState<"mine" | "new">("mine");
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, perPage: PER_PAGE, total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportTicket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [created, setCreated] = useState<SupportTicket | null>(null);

  // Garde de session.
  useEffect(() => {
    let active = true;
    void resolveSession().then((resolved) => {
      if (!active) return;
      if (!resolved) {
        router.replace("/login");
        return;
      }
      setSession(resolved.user);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  const loadList = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const result = await fetchMyTickets({ page: targetPage, perPage: PER_PAGE });
        setItems(result.items);
        setMeta(result.meta);
        setError(null);
      } catch (err) {
        if (isAuthError(err)) {
          router.replace("/login");
          return;
        }
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!session) return;
    void loadList(page);
  }, [session, page, loadList]);

  // Commandes du compte (sélecteur optionnel de la demande).
  useEffect(() => {
    if (!session || orders !== null) return;
    let active = true;
    fetchMyOrders()
      .then((list) => {
        if (active) setOrders(list);
      })
      .catch(() => {
        if (active) setOrders([]);
      });
    return () => {
      active = false;
    };
  }, [session, orders]);

  // Détail de la demande sélectionnée.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetchTicket(selectedId)
      .then((ticket) => {
        if (active) setDetail(ticket);
      })
      .catch((err) => {
        if (active) setDetailError(err);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function changeStatus(ticket: SupportTicket, status: "RESOLVED" | "CLOSED") {
    if (actionBusy) return;
    setActionBusy(true);
    setDetailError(null);
    setNotice(null);
    try {
      await updateMyTicket(ticket.id, status);
      setNotice(
        status === "RESOLVED"
          ? t("sup.resolved")
          : t("sup.closed"),
      );
      setDetail((prev) => (prev ? { ...prev, status } : prev));
      await loadList(page);
    } catch (err) {
      setDetailError(err);
    } finally {
      setActionBusy(false);
    }
  }

  if (checking) {
    return (
      <LuxShell>
        <div className="relative z-10 grid min-h-[70vh] place-items-center text-sm text-stone-400">
          <span className="flex items-center gap-3">
            <Spinner /> {t("sup.opening")}
          </span>
        </div>
      </LuxShell>
    );
  }

  return (
    <LuxShell>
      <div className="relative z-10">
        <LuxTopBar
          label={t("notif.memberArea")}
          links={[
            { href: "/account", label: t("notif.myAccount") },
            { href: "/messages", label: t("notif.messaging") },
            { href: "/offres", label: t("notif.catalogue") },
          ]}
        />

        <main className="mx-auto max-w-5xl px-5 py-10 md:px-8">
          <LuxPageHead
            kicker={t("sup.kicker")}
            title={t("sup.title")}
            meta={t("sup.meta")}
            action={
              <>
                <Button variant="outline" onClick={() => router.push("/messages")}>
                  {t("sup.preferChat")}
                </Button>
                <Button onClick={() => setTab("new")}>{t("sup.newRequest")}</Button>
              </>
            }
          />

          <SupportContactChoices onMessage={() => setTab("new")} />

          {notice && (
            <div className="mt-5">
              <Alert tone="success">{notice}</Alert>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-1.5" role="tablist" aria-label={t("sup.tabs")}>
            {([
              { value: "mine", label: t("sup.myRequests") },
              { value: "new", label: t("sup.newRequest") },
            ] as const).map((option) => {
              const active = option.value === tab;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(option.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
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

          {tab === "mine" ? (
            <>
              {error !== null && (
                <div className="mt-5">
                  <Alert tone={isPermissionError(error) ? "warning" : "danger"}>
                    {errorMessage(error)}
                  </Alert>
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
                <section className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#101825]/80">
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
                    <p className="lux-kicker">{t("sup.myRequests")}</p>
                    <Button
                      variant="ghost"
                      loading={loading}
                      onClick={() => void loadList(page)}
                      className="!min-h-[32px] !px-3 !text-[10px]"
                    >
                      {t("sup.refresh")}
                    </Button>
                  </div>

                  {loading && items.length === 0 ? (
                    <p className="flex items-center gap-3 p-6 text-sm text-stone-400">
                      <Spinner /> {t("sup.loading")}
                    </p>
                  ) : items.length === 0 ? (
                    <div className="p-6">
                      <p className="text-sm text-stone-400">
                        {t("sup.empty")}
                      </p>
                      <Button className="mt-4" onClick={() => setTab("new")}>
                        {t("sup.create")}
                      </Button>
                    </div>
                  ) : (
                    <ul className="divide-y divide-white/[0.06]">
                      {items.map((ticket) => {
                        const active = ticket.id === selectedId;
                        return (
                          <li key={ticket.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(ticket.id)}
                              aria-current={active ? "true" : undefined}
                              className={`flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 text-left transition ${
                                active ? "bg-white/[0.05]" : "hover:bg-white/[0.04]"
                              }`}
                            >
                              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-[var(--lux-gold-light)]">
                                {ticket.code}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
                                {ticket.subject}
                              </span>
                              <Badge cls="border-white/15 bg-white/5 text-stone-300">
                                {t(`supcat.${ticket.category}` as MessageKey)}
                              </Badge>
                              <StatusBadge status={ticket.status} />
                              <span className="w-full text-[11px] tabular-nums text-stone-500 sm:w-auto">
                                {formatDateTime(ticket.createdAt)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="px-4 pb-4">
                    <ListPager
                      meta={meta}
                      hidden={loading || items.length === 0}
                      onPage={(next) => {
                        setPage(next);
                        setSelectedId(null);
                      }}
                    />
                  </div>
                </section>

                <section
                  aria-label={t("sup.detail")}
                  className="lux-glass h-fit rounded-[18px] p-5 lg:sticky lg:top-6"
                >
                  {selectedId === null ? (
                    <p className="text-sm text-stone-400">
                      {t("sup.pick")}
                    </p>
                  ) : detailLoading ? (
                    <p className="flex items-center gap-3 text-sm text-stone-400">
                      <Spinner /> {t("sup.loadingOne")}
                    </p>
                  ) : detailError !== null ? (
                    <Alert tone="danger">{errorMessage(detailError)}</Alert>
                  ) : detail ? (
                    <TicketDetail
                      ticket={detail}
                      busy={actionBusy}
                      onStatusChange={(status) => void changeStatus(detail, status)}
                    />
                  ) : null}
                </section>
              </div>
            </>
          ) : (
            <NewTicketPanel
              orders={orders}
              created={created}
              onCreated={async (ticket) => {
                setCreated(ticket);
                if (page === 1) await loadList(1);
                else setPage(1);
              }}
              onReset={() => setCreated(null)}
              onShowList={() => setTab("mine")}
            />
          )}
        </main>

        <div className="relative z-10 mt-16">
          <LuxFooter />
        </div>
      </div>
    </LuxShell>
  );
}

// ---------------------------------------------------------------------------

function TicketDetail({
  ticket,
  busy,
  onStatusChange,
}: {
  ticket: SupportTicket;
  busy: boolean;
  onStatusChange: (status: "RESOLVED" | "CLOSED") => void;
}) {
  const t = useT();
  const closable = !isTicketClosed(ticket.status);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="lux-kicker">{t("sup.request")}</p>
        <StatusBadge status={ticket.status} />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold tracking-[0.08em] text-[var(--lux-gold-light)]">
          {ticket.code}
        </span>
        <CopyButton value={ticket.code} />
      </p>

      <h2 className="lux-serif mt-2 text-[20px] font-semibold leading-snug text-stone-50">
        {ticket.subject}
      </h2>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-stone-400">{t("sup.category")}</dt>
          <dd className="text-right text-stone-200">{t(`supcat.${ticket.category}` as MessageKey)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-stone-400">{t("sup.createdOn")}</dt>
          <dd className="text-right tabular-nums text-stone-200">
            {formatDateTime(ticket.createdAt)}
          </dd>
        </div>
        {ticket.updatedAt && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-stone-400">{t("sup.updated")}</dt>
            <dd className="text-right tabular-nums text-stone-200">
              {formatDateTime(ticket.updatedAt)}
            </dd>
          </div>
        )}
        {ticket.orderNumber && (
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-stone-400">{t("sup.linkedOrder")}</dt>
            <dd className="text-right">
              <Link
                href={ticket.orderId ? `/account/orders/${ticket.orderId}` : "/account/orders"}
                className="font-mono text-[var(--lux-gold-light)] hover:underline"
              >
                {ticket.orderNumber}
              </Link>
            </dd>
          </div>
        )}
        {ticket.assignedTo && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-stone-400">{t("sup.assigned")}</dt>
            <dd className="text-right text-stone-200">{personLabel(ticket.assignedTo)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 rounded-[14px] border border-white/10 bg-black/15 p-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">{t("sup.description")}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-300">
          {ticket.description}
        </p>
      </div>

      {closable ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="outline"
            loading={busy}
            onClick={() => onStatusChange("RESOLVED")}
          >
            {t("sup.markResolved")}
          </Button>
          <Button variant="ghost" loading={busy} onClick={() => onStatusChange("CLOSED")}>
            {t("sup.close")}
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-xs text-stone-500">
          {ticket.status === "CLOSED" ? t("sup.isClosed") : t("sup.isResolved")}
        </p>
      )}
    </div>
  );
}

function NewTicketPanel({
  orders,
  created,
  onCreated,
  onReset,
  onShowList,
}: {
  orders: OrderSummary[] | null;
  created: SupportTicket | null;
  onCreated: (ticket: SupportTicket) => Promise<void>;
  onReset: () => void;
  onShowList: () => void;
}) {
  const t = useT();
  const [category, setCategory] = useState("OTHER");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();
    if (trimmedSubject.length < 3) {
      setFormError(t("sup.subjectShort"));
      return;
    }
    if (trimmedDescription.length < 10) {
      setFormError(t("sup.descShort"));
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const ticket = await createTicket({
        category,
        subject: trimmedSubject,
        description: trimmedDescription,
        ...(orderId ? { orderId } : {}),
      });
      setSubject("");
      setDescription("");
      setOrderId("");
      await onCreated(ticket);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <section aria-live="polite" className="lux-glass mt-4 rounded-[24px] p-7">
        <p className="lux-kicker">{t("sup.savedKicker")}</p>
        <h2 className="lux-serif mt-2 text-[24px] font-semibold text-stone-50">
          {t("sup.savedTitle")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-300">
          {t("sup.keepCode")}
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-[rgba(255,106,50,0.3)] bg-[rgba(232,71,36,0.08)] px-4 py-3">
          <span className="font-mono text-lg font-bold tracking-[0.12em] text-[var(--lux-gold-light)]">
            {created.code}
          </span>
          <CopyButton value={created.code} />
        </p>
        <p className="mt-4 text-xs text-stone-400">
          {t("sup.createdLine", { category: t(`supcat.${created.category}` as MessageKey), date: formatDateTime(created.createdAt) })}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" onClick={onShowList}>
            {t("sup.seeMine")}
          </Button>
          <Button variant="ghost" onClick={onReset}>
            {t("sup.newRequest")}
          </Button>
          <Link
            href="/messages"
            className="lux-btn lux-btn-ghost text-[11.5px] uppercase tracking-[0.14em]"
            style={{ borderRadius: 16 }}
          >
            {t("sup.preferChat")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="lux-glass mt-4 rounded-[24px] p-7">
      <p className="lux-kicker">{t("sup.newRequest")}</p>
      <h2 className="lux-serif mt-2 text-[24px] font-semibold text-stone-50">{t("sup.describeNeed")}</h2>

      <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-5">
        <Field label={t("sup.category")} required>
          <SelectInput value={category} onChange={(event) => setCategory(event.target.value)}>
            {SUPPORT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(`supcat.${option.value}` as MessageKey)}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label={t("sup.subject")} required hint={t("sup.subjectHint")}>
          <TextInput
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={160}
            placeholder={t("sup.subjectPlaceholder")}
          />
        </Field>

        <Field
          label={t("sup.description")}
          required
          hint={t("sup.descHint")}
        >
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder={t("sup.descPlaceholder")}
            className="glass w-full rounded-[14px] border-[rgba(255,255,255,0.12)] px-3.5 py-2.5 text-sm text-stone-100 outline-none transition-colors focus:border-[rgba(232,71,36,0.6)] placeholder:text-stone-400"
          />
        </Field>

        {orders && orders.length > 0 && (
          <Field label={t("sup.orderField")}>
            <SelectInput value={orderId} onChange={(event) => setOrderId(event.target.value)}>
              <option value="">{t("sup.noOrder")}</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber}
                  {order.firstItem ? ` — ${order.firstItem.title}` : ""}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}

        {formError && <Alert tone="danger">{formError}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/messages" className="text-xs text-stone-400 hover:text-stone-200">
            {t("sup.chatLink")}
          </Link>
          <Button type="submit" loading={submitting}>
            {t("sup.send")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopied(false));
      }}
      className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-300 transition hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold-light)]"
    >
      {copied ? t("sup.copied") : (label ?? t("sup.copy"))}
    </button>
  );
}
