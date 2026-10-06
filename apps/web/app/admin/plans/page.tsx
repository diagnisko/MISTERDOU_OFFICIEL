"use client";

import { Fragment, useState } from "react";
import { PLAN_STATUSES } from "@misterdou/shared";
import { formatXof, request } from "@/lib/api";
import { Alert, Button, SelectInput, StatusBadge, TextInput } from "@/components/ui";
import { buildQuery, isErrorCode } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import { CredentialKeyButton } from "../_lib/credential-key";
import {
  AdminModal,
  AdminPageHead,
  DataTable,
  ErrorAlert,
  FilterTabs,
  NoticeAlert,
  Pagination,
  RowAction,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Tranches (échéanciers) — GET /admin/plans { page, perPage, status, q }
// POST /admin/plans/collect { installmentId, method, reference? }
// POST /admin/plans/settle  { reference? }
// ---------------------------------------------------------------------------

type Installment = {
  id: string;
  index: number;
  amountDue: number;
  amountPaid: number;
  dueDate: string;
  paidAt: string | null;
  status: string;
};

type PlanRow = {
  id: string;
  status: string;
  totalAmount: number;
  downPaymentAmount: number;
  remainingAmount: number;
  monthCount: number;
  monthlyAmount: number;
  lastMonthAmount: number;
  totalPaid: number;
  paidCount: number;
  order: {
    orderNumber: string;
    status: string;
    totalAmount: number;
    paymentMode: string;
    buyer: { id: string; email: string; firstName: string | null; lastName: string | null };
    items?: Array<{ productId: string; title: string; hasCredentials?: boolean }>;
  };
  installments: Installment[];
};

// Paiements reçus uniquement par Wave.
const METHODS = [{ value: "MOBILE_MONEY", label: "Wave" }];

const STATUS_TABS = [
  { value: "", label: "Tous" },
  ...PLAN_STATUSES.map((status) => ({
    value: status,
    label:
      status === "ACTIVE"
        ? "En cours"
        : status === "COMPLETED"
          ? "Soldé"
          : status === "DEFAULTED"
            ? "Impayé"
            : "Annulé",
  })),
];

const REFRESH_CODES = ["INSTALLMENT_ALREADY_PAID", "PLAN_NOTHING_TO_SETTLE"];

export default function PlansPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collectTarget, setCollectTarget] = useState<{ plan: PlanRow; installment: Installment } | null>(null);
  const [settleTarget, setSettleTarget] = useState<PlanRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PlanRow | null>(null);

  const list = useAdminList<PlanRow>(
    `/api/v1/admin/plans${buildQuery({
      page,
      perPage,
      status: status || undefined,
      q: search || undefined,
    })}`,
  );

  async function runAction(action: () => Promise<void>, successMessage?: string) {
    list.setError(null);
    list.setNotice(null);
    try {
      await action();
      if (successMessage) await list.refresh(successMessage);
      return true;
    } catch (err) {
      list.setError(err);
      if (REFRESH_CODES.some((code) => isErrorCode(err, code))) await list.refresh();
      throw err;
    }
  }

  async function collect(payload: { installmentId: string; method: string; reference?: string }) {
    const ok = await runAction(async () => {
      await request("/api/v1/admin/plans/collect", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }, "Tranche encaissée et journalisée.");
    if (ok) setCollectTarget(null);
  }

  async function settle(row: PlanRow, reference: string | undefined, password: string) {
    const ok = await runAction(async () => {
      await request("/api/v1/admin/plans/settle", {
        method: "POST",
        body: JSON.stringify({ planId: row.id, password, ...(reference ? { reference } : {}) }),
      });
    }, "Plan soldé et journalisé.");
    if (ok) setSettleTarget(null);
  }

  async function cancelContract(row: PlanRow, reason: string, password: string) {
    const ok = await runAction(async () => {
      await request(`/api/v1/admin/plans/${row.id}/cancel`, { method: "POST", body: JSON.stringify({ reason, password }) });
    }, `Contrat ${row.order.orderNumber} annulé : accès du client fermé, offre désactivée.`);
    if (ok) setCancelTarget(null);
  }

  function canCollect(plan: PlanRow, installment: Installment): boolean {
    if (plan.status !== "ACTIVE" && plan.status !== "DEFAULTED") return false;
    return installment.status === "PENDING" || installment.status === "OVERDUE";
  }

  return (
    <>
      <AdminPageHead
        kicker="Trésorerie"
        title="Tranches"
        meta="Échéanciers des commandes en paiement fractionné."
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Plans de paiement</p>
          <div className="mt-3">
            <FilterTabs
              value={status}
              options={STATUS_TABS}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <SearchBar
          placeholder="Numéro de commande ou e-mail"
          onSearch={(query) => {
            setSearch(query);
            setPage(1);
          }}
        />
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading label="Chargement des plans…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label="Aucun plan pour ce filtre." />
        ) : (
          <DataTable
            columns={["Commande", "Acheteur", "Statut", "Montant", "Payé", "Reste", "Tranches"]}
            minWidth={980}
          >
            {list.items.map((plan) => {
              const open = expanded === plan.id;
              const active = plan.status === "ACTIVE" || plan.status === "DEFAULTED";
              return (
                <Fragment key={plan.id}>
                  <tr
                    className="cursor-pointer transition hover:bg-white/[0.025]"
                    onClick={() => setExpanded(open ? null : plan.id)}
                  >
                    <td className="px-4 py-3.5 text-stone-200">
                      {plan.order.orderNumber}
                      {plan.order.items?.[0] && (
                        <span className="mt-0.5 block text-[12px] font-normal text-stone-500">{plan.order.items[0].title}</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3.5 text-stone-300">
                      {plan.order.buyer.email}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={plan.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                      {formatXof(Number(plan.totalAmount))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                      {formatXof(Number(plan.totalPaid))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                      {formatXof(Number(plan.remainingAmount))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-400">
                      {plan.paidCount}/{plan.monthCount}
                    </td>
                    <td className="px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                      <span className="flex flex-wrap gap-3">
                        <RowAction
                          label={open ? "Masquer" : "Échéances"}
                          onClick={() => setExpanded(open ? null : plan.id)}
                        />
                        {plan.order.items?.[0] && (
                          <CredentialKeyButton productId={plan.order.items[0].productId} missing={plan.order.items[0].hasCredentials === false} />
                        )}
                        {active && (
                          <RowAction label="Solder le plan" tone="danger" onClick={() => setSettleTarget(plan)} />
                        )}
                        {active && <RowAction label="Annuler le contrat" tone="danger" onClick={() => setCancelTarget(plan)} />}
                      </span>
                    </td>
                  </tr>

                  {open && (
                    <tr>
                      <td colSpan={8} className="bg-black/25 px-4 py-4">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">
                          Échéancier — {plan.order.orderNumber} · {plan.order.paymentMode}
                        </p>
                        <div className="dash-scroll mt-3 overflow-x-auto">
                          <table className="dash-table w-full min-w-[640px] border-collapse text-left text-xs">
                            <thead className="text-[9px] uppercase tracking-[0.14em] text-stone-500">
                              <tr>
                                <th className="px-3 py-2 font-semibold">#</th>
                                <th className="px-3 py-2 font-semibold">Échéance</th>
                                <th className="px-3 py-2 font-semibold">Montant</th>
                                <th className="px-3 py-2 font-semibold">Payé</th>
                                <th className="px-3 py-2 font-semibold">Statut</th>
                                <th className="px-3 py-2 font-semibold">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.06]">
                              {plan.installments.map((installment) => (
                                <tr key={installment.id}>
                                  <td className="px-3 py-2.5 tabular-nums text-stone-400">
                                    {installment.index}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2.5 text-stone-300">
                                    {new Date(installment.dueDate).toLocaleDateString("fr-FR")}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-stone-300">
                                    {formatXof(Number(installment.amountDue))}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-stone-400">
                                    {formatXof(Number(installment.amountPaid ?? 0))}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <StatusBadge status={installment.status} />
                                  </td>
                                  <td className="px-3 py-2.5">
                                    {canCollect(plan, installment) ? (
                                      <RowAction
                                        label="Encaisser"
                                        onClick={() => setCollectTarget({ plan, installment })}
                                      />
                                    ) : (
                                      <span className="text-stone-600">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </DataTable>
        )}
      </TableCard>

      <Pagination
        meta={list.meta}
        onPage={setPage}
        onPerPage={(size) => {
          setPerPage(size);
          setPage(1);
        }}
      />

      {collectTarget && (
        <CollectModal
          plan={collectTarget.plan}
          installment={collectTarget.installment}
          onClose={() => setCollectTarget(null)}
          onSubmit={collect}
        />
      )}

      {settleTarget && <SettleModal plan={settleTarget} onClose={() => setSettleTarget(null)} onSubmit={settle} />}
      {cancelTarget && <CancelModal plan={cancelTarget} onClose={() => setCancelTarget(null)} onSubmit={cancelContract} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function CollectModal({
  plan,
  installment,
  onClose,
  onSubmit,
}: {
  plan: PlanRow;
  installment: Installment;
  onClose: () => void;
  onSubmit: (payload: { installmentId: string; method: string; reference?: string }) => Promise<void>;
}) {
  const [method, setMethod] = useState("MOBILE_MONEY");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit({
        installmentId: installment.id,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal title="Encaisser une tranche" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-xs text-stone-400">
          <p className="text-stone-200">{plan.order.orderNumber}</p>
          <p className="mt-1">
            Échéance n°{installment.index} · {new Date(installment.dueDate).toLocaleDateString("fr-FR")} ·{" "}
            <span className="tabular-nums text-stone-200">
              {formatXof(Number(installment.amountDue))}
            </span>
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Méthode d’encaissement
          </span>
          <SelectInput value={method} onChange={(event) => setMethod(event.target.value)}>
            {METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Référence (optionnel)
          </span>
          <TextInput
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="ex. reçu, transaction…"
            maxLength={120}
          />
        </label>

        {error ? <ErrorAlert error={error} /> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button type="submit" loading={pending}>
            Encaisser
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}

function SettleModal({
  plan,
  onClose,
  onSubmit,
}: {
  plan: PlanRow;
  onClose: () => void;
  onSubmit: (plan: PlanRow, reference: string | undefined, password: string) => Promise<void>;
}) {
  const [reference, setReference] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(plan, reference.trim() || undefined, password);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal title="Solder le plan" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Alert tone="warning">
          Cette action enregistre <strong>toutes les tranches restantes</strong> du plan{" "}
          {plan.order.orderNumber} comme encaissées ({formatXof(Number(plan.remainingAmount))} restants).
          Elle est définitive et journalisée.
        </Alert>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Référence (optionnel)
          </span>
          <TextInput
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="ex. règlement hors application"
            maxLength={120}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Votre mot de passe (confirmation)
          </span>
          <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>

        {error ? <ErrorAlert error={error} /> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button variant="danger" type="submit" loading={pending}>
            Solder le plan
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}

/** Annulation d'un contrat de mensualités : motif + mot de passe de la personne connectée. */
function CancelModal({
  plan,
  onClose,
  onSubmit,
}: {
  plan: PlanRow;
  onClose: () => void;
  onSubmit: (plan: PlanRow, reason: string, password: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(plan, reason.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal title="Annuler le contrat de mensualités" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Alert tone="warning">
          Contrat {plan.order.orderNumber} : l’échéancier et la commande sont annulés, l’accès du client au compte est fermé
          et il est prévenu. L’offre est désactivée : <strong>changez le mot de passe du compte</strong> avant de la remettre en
          vente. Déjà versé par le client : <strong>{formatXof(Number(plan.totalPaid))}</strong> (non remboursé automatiquement).
        </Alert>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">Motif (envoyé au client)</span>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="ex. mensualités impayées depuis 2 mois" required minLength={5} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Votre mot de passe (confirmation)
          </span>
          <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        {error ? <ErrorAlert error={error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Retour
          </Button>
          <Button variant="danger" type="submit" loading={pending} disabled={reason.trim().length < 5 || !password}>
            Annuler le contrat
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}
