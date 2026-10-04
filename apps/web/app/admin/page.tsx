"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatXof, request } from "@/lib/api";
import { StatusBadge } from "@/components/ui";
import { AreaChart, DashHeading, KpiCard, Panel, Segmented } from "@/components/dash/dash-ui";
import {
  IconAlert,
  IconCalendar,
  IconChevron,
  IconCoins,
  IconRefresh,
  IconSearch,
  IconWallet,
} from "@/components/dash/dash-icons";
import { buildQuery, errorMessage } from "./_lib/api";
import { useAdminList } from "./_lib/hooks";
import { AdminModal, ErrorAlert } from "./_lib/ui";

// ---------------------------------------------------------------------------
// Vue d'ensemble — GET /admin/finance (STATS) + GET /admin/receivables
// (PAYMENTS). Aucun montant n'est calculé ici : tout vient de l'API.
// ---------------------------------------------------------------------------

type Finance = {
  revenueTotal: number;
  collectedThisMonth: number;
  collectedLastMonth: number;
  receivable: { amount: number; plans: number };
  dueThisMonth: { amount: number; count: number };
  overdue: { amount: number; count: number; plans: number };
  monthly: Array<{ month: string; collected: number; expected: number }>;
};

type MonthState = "OVERDUE" | "DUE" | "PAID" | "NONE";
type Filter = "all" | MonthState;

type ScheduleItem = {
  id: string;
  index: number;
  amountDue: number;
  amountPaid: number;
  dueDate: string;
  paidAt: string | null;
  status: "PENDING" | "PAID" | "OVERDUE" | "WAIVED" | "CANCELLED";
};

type Receivable = {
  planId: string;
  orderNumber: string;
  product: string | null;
  client: { id: string; email: string; firstName: string | null; lastName: string | null };
  totalAmount: number;
  totalPaid: number;
  remaining: number;
  monthCount: number;
  monthsRemaining: number;
  overdueCount: number;
  overdueAmount: number;
  monthState: MonthState;
  nextDue: { installmentId: string; dueDate: string; amount: number } | null;
  schedule: ScheduleItem[];
};

type ReceivablePage = {
  items: Receivable[];
  counts: Record<Filter, number>;
  total: number;
  page: number;
  perPage: number;
};

type PaymentRow = {
  id: string;
  paymentNumber: string;
  type: string;
  amount: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  user: { email: string; firstName: string | null; lastName: string | null } | null;
};

const PER_PAGE = 10;

const STATE_LABEL: Record<MonthState, string> = {
  OVERDUE: "En retard",
  DUE: "À payer ce mois",
  PAID: "Payé ce mois",
  NONE: "Rien ce mois",
};
const STATE_PILL: Record<MonthState, string> = {
  OVERDUE: "dash-pill-late",
  DUE: "dash-pill-due",
  PAID: "dash-pill-paid",
  NONE: "dash-pill-none",
};

const PAYMENT_TYPE: Record<string, string> = {
  ORDER_PAYMENT: "Achat",
  INITIAL_INSTALLMENT: "Apport",
  INSTALLMENT: "Mensualité",
  SELLER_REGISTRATION: "Frais vendeur",
  FEATURED: "Mise en avant",
};

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" }).replace(".", "");
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
}

function personName(p: { firstName: string | null; lastName: string | null; email: string }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;
}

function deltaOf(current: number, previous: number) {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const text = `${pct >= 0 ? "+" : "−"} ${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  return { value: text, positive: pct >= 0 };
}

export default function AdminOverviewPage() {
  const [finance, setFinance] = useState<Finance | null>(null);
  const [financeError, setFinanceError] = useState<unknown>(null);
  const [recv, setRecv] = useState<ReceivablePage | null>(null);
  const [recvError, setRecvError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<{ row: Receivable; item: ScheduleItem } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const payments = useAdminList<PaymentRow>(`/api/v1/admin/payments${buildQuery({ page: 1, perPage: 6 })}`);

  const loadFinance = useCallback(async () => {
    try {
      setFinance(await request<Finance>("/api/v1/admin/finance"));
      setFinanceError(null);
    } catch (err) {
      setFinanceError(err);
    }
  }, []);

  const loadReceivables = useCallback(async () => {
    try {
      const data = await request<ReceivablePage>(
        `/api/v1/admin/receivables${buildQuery({ status: filter, q: search || undefined, page, perPage: PER_PAGE })}`,
      );
      setRecv(data);
      setRecvError(null);
    } catch (err) {
      setRecvError(err);
    }
  }, [filter, search, page]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  useEffect(() => {
    void loadReceivables();
  }, [loadReceivables]);

  async function refreshAll() {
    setRefreshing(true);
    setNotice(null);
    await Promise.all([loadFinance(), loadReceivables(), payments.refresh()]);
    setRefreshing(false);
  }

  const today = useMemo(
    () => new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    [],
  );
  const chart = useMemo(
    () => (finance?.monthly ?? []).map((m) => ({ label: monthLabel(m.month), primary: m.collected, secondary: m.expected })),
    [finance],
  );
  const counts = recv?.counts;
  const totalPages = Math.max(1, Math.ceil((recv?.total ?? 0) / PER_PAGE));
  const loadingFinance = !finance && !financeError;

  return (
    <>
      <DashHeading
        greeting={today.charAt(0).toUpperCase() + today.slice(1)}
        title="Vue d’ensemble"
        actions={
          <>
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={refreshing}
              aria-label="Actualiser les données"
              className="dash-btn dash-btn-ghost dash-btn-round"
            >
              <IconRefresh size={16} className={refreshing ? "animate-spin" : undefined} />
            </button>
            <a href="#a-recevoir" className="dash-btn dash-btn-primary">
              Voir les comptes à recevoir
            </a>
          </>
        }
      />

      <ErrorAlert error={financeError} />
      {notice && <p className="mt-4 text-[13px] text-[#86efac]" role="status">{notice}</p>}

      <section aria-label="Indicateurs financiers" className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          hero
          icon={IconCoins}
          label="Chiffre d’affaires"
          value={formatXof(finance?.revenueTotal ?? 0)}
          hint="Tous les paiements confirmés"
          loading={loadingFinance}
        />
        <KpiCard
          icon={IconWallet}
          label="Encaissé ce mois"
          value={formatXof(finance?.collectedThisMonth ?? 0)}
          delta={finance ? deltaOf(finance.collectedThisMonth, finance.collectedLastMonth) : null}
          hint={finance ? `Mois dernier : ${formatXof(finance.collectedLastMonth)}` : undefined}
          loading={loadingFinance}
        />
        <KpiCard
          icon={IconCalendar}
          label="Montant à recevoir"
          value={formatXof(finance?.receivable.amount ?? 0)}
          hint={
            finance
              ? `${finance.receivable.plans} compte${finance.receivable.plans > 1 ? "s" : ""} en cours de paiement`
              : undefined
          }
          href="#a-recevoir"
          loading={loadingFinance}
        />
        <KpiCard
          icon={IconAlert}
          label="En retard"
          value={formatXof(finance?.overdue.amount ?? 0)}
          hint={
            finance
              ? finance.overdue.count === 0
                ? "Aucune échéance en retard"
                : `${finance.overdue.count} échéance${finance.overdue.count > 1 ? "s" : ""} · ${finance.overdue.plans} compte${finance.overdue.plans > 1 ? "s" : ""}`
              : undefined
          }
          loading={loadingFinance}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Panel title="Encaissements sur 12 mois">
          {finance ? (
            <AreaChart data={chart} primaryLabel="Encaissé" secondaryLabel="Échéances attendues" format={formatXof} />
          ) : (
            <div className="lux-skeleton h-[240px] w-full" aria-label="Chargement du graphique" />
          )}
        </Panel>

        <Panel title="Ce mois-ci">
          {finance && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[rgba(255,236,229,0.07)] p-3.5">
                <p className="text-[12px] text-[#b8a6a1]">Reste à encaisser</p>
                <p className="mt-1 text-[18px] font-semibold tabular-nums text-white">{formatXof(finance.dueThisMonth.amount)}</p>
                <p className="mt-0.5 text-[11px] text-[#8f7d77]">
                  {finance.dueThisMonth.count} échéance{finance.dueThisMonth.count > 1 ? "s" : ""}
                </p>
              </div>
              <div className="rounded-2xl border border-[rgba(255,236,229,0.07)] p-3.5">
                <p className="text-[12px] text-[#b8a6a1]">Déjà encaissé</p>
                <p className="mt-1 text-[18px] font-semibold tabular-nums text-white">{formatXof(finance.collectedThisMonth)}</p>
                <p className="mt-0.5 text-[11px] text-[#8f7d77]">tous paiements</p>
              </div>
            </div>
          )}

          {counts && counts.all > 0 && (
            <div className="mt-5">
              <p className="text-[12px] text-[#b8a6a1]">État des {counts.all} comptes en cours de paiement</p>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                {(["PAID", "DUE", "OVERDUE", "NONE"] as MonthState[]).map((state) =>
                  counts[state] > 0 ? (
                    <span
                      key={state}
                      style={{ width: `${(counts[state] / counts.all) * 100}%` }}
                      className={
                        state === "PAID"
                          ? "bg-[#4ade80]"
                          : state === "DUE"
                            ? "bg-[#fbbf24]"
                            : state === "OVERDUE"
                              ? "bg-[#ef4444]"
                              : "bg-white/20"
                      }
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {(["PAID", "DUE", "OVERDUE", "NONE"] as MonthState[]).map((state) => (
                  <li key={state}>
                    <button
                      type="button"
                      onClick={() => {
                        setFilter(state);
                        setPage(1);
                        document.getElementById("a-recevoir")?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[12px] transition hover:bg-white/[0.04]"
                    >
                      <span className={`dash-pill ${STATE_PILL[state]}`}>{STATE_LABEL[state]}</span>
                      <span className="font-semibold tabular-nums text-white">{counts[state]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {counts && counts.all === 0 && (
            <p className="mt-5 text-[13px] text-[#8f7d77]">Aucun compte n’est actuellement payé en plusieurs fois.</p>
          )}
        </Panel>
      </section>

      <section id="a-recevoir" className="dash-card mt-4 scroll-mt-24 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-stone-100">Comptes en cours de paiement</h2>
            <p className="mt-0.5 text-[12px] text-[#8f7d77]">
              Montant restant, mois restants et état de la mensualité du mois. Dépliez une ligne pour voir chaque mois.
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
              setPage(1);
            }}
            className="relative w-full sm:w-72"
            role="search"
          >
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a7771]" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Client, compte ou n° de commande"
              aria-label="Rechercher un compte"
              className="dash-input"
            />
          </form>
        </div>

        <div className="mt-4">
          <Segmented<Filter>
            label="Filtrer par état du mois"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: "Tous", count: counts?.all },
              { value: "OVERDUE", label: "En retard", count: counts?.OVERDUE },
              { value: "DUE", label: "À payer", count: counts?.DUE },
              { value: "PAID", label: "Payé ce mois", count: counts?.PAID },
              { value: "NONE", label: "Rien ce mois", count: counts?.NONE },
            ]}
          />
        </div>

        <ErrorAlert error={recvError} />

        <div className="dash-scroll -mx-5 mt-4 overflow-x-auto">
          <table className="dash-table w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className="pl-5">Client</th>
                <th>Compte</th>
                <th>Payé</th>
                <th>Reste à recevoir</th>
                <th>Mois restants</th>
                <th>Prochaine échéance</th>
                <th>Ce mois</th>
                <th className="pr-5"><span className="sr-only">Détail</span></th>
              </tr>
            </thead>
            <tbody>
              {!recv && !recvError && (
                <tr>
                  <td colSpan={8} className="pl-5 text-[#8f7d77]">Chargement des comptes…</td>
                </tr>
              )}
              {recv && recv.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="pl-5 text-[#8f7d77]">
                    {search ? "Aucun compte ne correspond à cette recherche." : "Aucun compte dans cette catégorie."}
                  </td>
                </tr>
              )}
              {recv?.items.map((row) => {
                const expanded = open === row.planId;
                const paidPct = row.totalAmount > 0 ? Math.min(100, (row.totalPaid / row.totalAmount) * 100) : 0;
                return (
                  <Fragment key={row.planId}>
                    <tr className={expanded ? "bg-white/[0.02]" : undefined}>
                      <td className="pl-5">
                        <p className="font-medium text-white">{personName(row.client)}</p>
                        <p className="max-w-[200px] truncate text-[11px] text-[#8f7d77]">{row.client.email}</p>
                      </td>
                      <td>
                        <p className="max-w-[190px] truncate">{row.product ?? "Compte eFootball"}</p>
                        <p className="text-[11px] text-[#8f7d77]">{row.orderNumber}</p>
                      </td>
                      <td className="min-w-[150px]">
                        <p className="tabular-nums">
                          {formatXof(row.totalPaid)} <span className="text-[#8f7d77]">/ {formatXof(row.totalAmount)}</span>
                        </p>
                        <div className="dash-progress mt-1.5" aria-hidden>
                          <span style={{ width: `${paidPct}%` }} />
                        </div>
                      </td>
                      <td className="font-semibold tabular-nums text-white">{formatXof(row.remaining)}</td>
                      <td className="tabular-nums">
                        {row.monthsRemaining} <span className="text-[#8f7d77]">/ {row.monthCount}</span>
                      </td>
                      <td>
                        {row.nextDue ? (
                          <>
                            <p className="tabular-nums">{formatXof(row.nextDue.amount)}</p>
                            <p className="text-[11px] text-[#8f7d77]">{shortDate(row.nextDue.dueDate)}</p>
                          </>
                        ) : (
                          <span className="text-[#8f7d77]">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`dash-pill ${STATE_PILL[row.monthState]}`}>
                          {row.monthState === "OVERDUE" && row.overdueCount > 1
                            ? `${row.overdueCount} mois en retard`
                            : STATE_LABEL[row.monthState]}
                        </span>
                      </td>
                      <td className="pr-5 text-right">
                        <button
                          type="button"
                          onClick={() => setOpen(expanded ? null : row.planId)}
                          aria-expanded={expanded}
                          aria-label={expanded ? "Masquer l’échéancier" : "Voir l’échéancier"}
                          className="dash-btn dash-btn-ghost dash-btn-round !min-h-[34px] !w-[34px]"
                        >
                          <IconChevron size={16} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8} className="px-5 pb-5 pt-1">
                          <MonthStrip row={row} onCollect={(item) => setCollecting({ row, item })} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {recv && recv.total > PER_PAGE && (
          <div className="mt-4 flex items-center justify-between text-[12px] text-[#b8a6a1]">
            <span className="tabular-nums">
              {(page - 1) * PER_PAGE + 1}–{Math.min(recv.total, page * PER_PAGE)} sur {recv.total}
            </span>
            <div className="flex gap-2">
              <button type="button" className="dash-btn dash-btn-ghost !min-h-[34px]" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Précédent
              </button>
              <button type="button" className="dash-btn dash-btn-ghost !min-h-[34px]" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Suivant
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="dash-card mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-stone-100">Derniers paiements</h2>
          <Link href="/admin/payments" className="text-[12px] text-[#ff8a5c] hover:underline">
            Tout voir
          </Link>
        </div>
        <ErrorAlert error={payments.error} />
        <div className="dash-scroll -mx-5 mt-3 overflow-x-auto">
          <table className="dash-table w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className="pl-5">Date</th>
                <th>Transaction</th>
                <th>Type</th>
                <th>Montant</th>
                <th className="pr-5">État</th>
              </tr>
            </thead>
            <tbody>
              {payments.loading && (
                <tr>
                  <td colSpan={5} className="pl-5 text-[#8f7d77]">Chargement…</td>
                </tr>
              )}
              {!payments.loading && payments.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="pl-5 text-[#8f7d77]">Aucun paiement enregistré.</td>
                </tr>
              )}
              {payments.items.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap pl-5 tabular-nums">{new Date(p.paidAt ?? p.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td>
                    <p>{p.user ? personName({ ...p.user }) : "—"}</p>
                    <p className="text-[11px] text-[#8f7d77]">{p.paymentNumber}</p>
                  </td>
                  <td>{PAYMENT_TYPE[p.type] ?? p.type}</td>
                  <td className="whitespace-nowrap font-semibold tabular-nums text-white">{formatXof(p.amount)}</td>
                  <td className="pr-5">
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {collecting && (
        <CollectModal
          row={collecting.row}
          item={collecting.item}
          onClose={() => setCollecting(null)}
          onDone={async () => {
            setCollecting(null);
            setNotice(`Mensualité ${collecting.item.index} de ${personName(collecting.row.client)} marquée comme payée.`);
            await Promise.all([loadFinance(), loadReceivables(), payments.refresh()]);
          }}
        />
      )}
    </>
  );
}

// Échéancier mois par mois d'un compte.
function MonthStrip({ row, onCollect }: { row: Receivable; onCollect: (item: ScheduleItem) => void }) {
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
  return (
    <div className="rounded-2xl border border-[rgba(255,236,229,0.07)] bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#b8a6a1]">
        <span>
          {row.monthCount} mensualités · {row.monthsRemaining} restante{row.monthsRemaining > 1 ? "s" : ""}
        </span>
        {row.overdueAmount > 0 && <span className="text-[#fca5a5]">Retard cumulé : {formatXof(row.overdueAmount)}</span>}
      </div>
      <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {row.schedule.map((item) => {
          const due = new Date(item.dueDate);
          const isThisMonth = `${due.getUTCFullYear()}-${due.getUTCMonth()}` === thisMonth;
          const open = item.status === "PENDING" || item.status === "OVERDUE";
          const state = item.status === "PAID" || item.status === "WAIVED" ? "PAID" : item.status === "OVERDUE" ? "OVERDUE" : isThisMonth ? "CURRENT" : "UPCOMING";
          return (
            <li key={item.id} className="dash-month" data-state={state}>
              <span className="text-[#8f7d77]">
                Mois {item.index} · {due.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" })}
              </span>
              <span className="font-semibold tabular-nums text-white">{formatXof(item.amountDue)}</span>
              <span
                className={
                  state === "PAID" ? "text-[#86efac]" : state === "OVERDUE" ? "text-[#fca5a5]" : state === "CURRENT" ? "text-[#ff8a5c]" : "text-[#8f7d77]"
                }
              >
                {state === "PAID"
                  ? item.paidAt
                    ? `Payé le ${shortDate(item.paidAt)}`
                    : item.status === "WAIVED"
                      ? "Annulée"
                      : "Payé"
                  : state === "OVERDUE"
                    ? "En retard"
                    : state === "CURRENT"
                      ? "À payer ce mois"
                      : `Le ${shortDate(item.dueDate)}`}
              </span>
              {open && (state === "OVERDUE" || state === "CURRENT") && (
                <button type="button" onClick={() => onCollect(item)} className="mt-1 rounded-full border border-[rgba(255,106,50,0.45)] px-2 py-1 text-[11px] font-medium text-[#ffb08a] transition hover:bg-[rgba(232,71,36,0.15)]">
                  Marquer payé
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Paiements reçus uniquement par Wave.
const METHODS = [{ value: "MOBILE_MONEY", label: "Wave" }] as const;

function CollectModal({
  row,
  item,
  onClose,
  onDone,
}: {
  row: Receivable;
  item: ScheduleItem;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("MOBILE_MONEY");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request("/api/v1/admin/plans/collect", {
        method: "POST",
        body: JSON.stringify({ installmentId: item.id, method, reference: reference.trim() || undefined }),
      });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Marquer la mensualité comme payée" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="rounded-2xl border border-[rgba(255,236,229,0.08)] p-3.5 text-[13px]">
          <p className="text-white">{personName(row.client)}</p>
          <p className="mt-0.5 text-[#8f7d77]">
            {row.product ?? "Compte eFootball"} · mois {item.index} · échéance du {shortDate(item.dueDate)}
          </p>
          <p className="mt-2 text-[20px] font-semibold tabular-nums text-white">{formatXof(item.amountDue - item.amountPaid)}</p>
        </div>

        <fieldset>
          <legend className="text-[12px] text-[#b8a6a1]">Moyen de paiement reçu</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <label key={m.value} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] transition ${method === m.value ? "border-[rgba(255,106,50,0.6)] bg-[rgba(232,71,36,0.15)] text-white" : "border-[rgba(255,236,229,0.1)] text-[#b8a6a1]"}`}>
                <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="sr-only" />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-[12px] text-[#b8a6a1]">Référence (facultative)</span>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={120}
            placeholder="N° de transaction Wave, reçu…"
            className="dash-input mt-1.5 !pl-4"
          />
        </label>

        {error && <p className="text-[13px] text-[#fca5a5]" role="alert">{error}</p>}

        <p className="text-[12px] text-[#8f7d77]">L’opération est inscrite au journal d’audit et le client est notifié.</p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="dash-btn dash-btn-ghost">
            Annuler
          </button>
          <button type="submit" disabled={busy} className="dash-btn dash-btn-primary">
            {busy ? "Enregistrement…" : "Confirmer le paiement"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
