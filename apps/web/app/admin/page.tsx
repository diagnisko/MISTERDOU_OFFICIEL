"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatXof, request } from "@/lib/api";
import { Button, Spinner, StatusBadge } from "@/components/ui";
import { buildQuery } from "./_lib/api";
import { useAdminList } from "./_lib/hooks";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
  NoticeAlert,
  TableCard,
  TableEmpty,
  TableLoading,
} from "./_lib/ui";

// ---------------------------------------------------------------------------
// Tableau de bord — GET /admin/overview (forme exacte : admin-console/routes.ts)
// + dernières commandes / paiements et liens rapides vers les modules.
// ---------------------------------------------------------------------------

type Overview = {
  users: number;
  clients: number;
  products: number;
  orders: number;
  payments: number;
  pendingKyc: number;
  activeSellers: number;
  settledRevenue: number;
};

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: string;
  totalAmount: number;
  createdAt: string;
  buyer: { id: string; email: string; firstName: string | null; lastName: string | null };
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

const QUICK_LINKS: { href: string; label: string; hint: string }[] = [
  { href: "/admin/clients", label: "Clients", hint: "02" },
  { href: "/admin/sellers", label: "Vendeurs", hint: "03" },
  { href: "/admin/verifications", label: "Vérifications", hint: "04" },
  { href: "/admin/orders", label: "Commandes", hint: "05" },
  { href: "/admin/payments", label: "Paiements", hint: "06" },
  { href: "/admin/plans", label: "Tranches", hint: "07" },
  { href: "/admin/withdrawals", label: "Retraits", hint: "08" },
  { href: "/admin/offers", label: "Offres", hint: "09" },
  { href: "/admin/promotions", label: "Promotions", hint: "10" },
  { href: "/admin/team", label: "Équipe", hint: "11" },
  { href: "/admin/settings", label: "Paramètres", hint: "12" },
  { href: "/admin/audit", label: "Journal", hint: "13" },
];

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const latestOrders = useAdminList<OrderRow>(
    `/api/v1/admin/orders${buildQuery({ page: 1, perPage: 10 })}`,
  );
  const latestPayments = useAdminList<PaymentRow>(
    `/api/v1/admin/payments${buildQuery({ page: 1, perPage: 10 })}`,
  );

  const loadOverview = useCallback(async () => {
    try {
      const stats = await request<Overview>("/api/v1/admin/overview");
      setOverview(stats);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadOverview().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadOverview]);

  async function refresh() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const stats = await request<Overview>("/api/v1/admin/overview");
      setOverview(stats);
      await Promise.all([latestOrders.refresh(), latestPayments.refresh()]);
      setNotice("Données actualisées.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Tableau de bord"
        title="Vue d’ensemble"
        meta="Indicateurs chargés depuis l’API — aucun montant calculé côté client."
        action={
          <Button variant="outline" loading={busy} onClick={() => void refresh()}>
            Actualiser
          </Button>
        }
      />

      <ErrorAlert error={error} />
      <NoticeAlert notice={notice} />

      {loading && !overview ? (
        <p className="mt-8 flex items-center gap-3 text-sm text-stone-400">
          <Spinner /> Chargement des indicateurs…
        </p>
      ) : overview ? (
        <>
          <section
            aria-label="Indicateurs de la plateforme"
            className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <Metric
              label="Revenus encaissés"
              value={formatXof(Number(overview.settledRevenue))}
              detail="Paiements confirmés"
              tone="gold"
            />
            <Metric
              label="Membres"
              value={Number(overview.users).toLocaleString("fr-FR")}
              detail={`${Number(overview.clients).toLocaleString("fr-FR")} clients`}
            />
            <Metric
              label="Vendeurs actifs"
              value={Number(overview.activeSellers).toLocaleString("fr-FR")}
              detail="Comptes marchands"
              tone="green"
            />
            <Metric
              label="Vérifications à traiter"
              value={Number(overview.pendingKyc).toLocaleString("fr-FR")}
              detail="Dossiers en attente"
              tone="amber"
              href="/admin/verifications"
            />
          </section>

          <section className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="lux-glass rounded-[20px] p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="lux-kicker">Activité plateforme</p>
                  <h2 className="mt-2 text-xl text-stone-100">Volume de gestion</h2>
                </div>
                <span className="text-[10px] uppercase tracking-[0.14em] text-stone-500">
                  Total actuel
                </span>
              </div>
              <div className="mt-7 grid grid-cols-3 gap-3">
                {[
                  ["Offres", overview.products],
                  ["Commandes", overview.orders],
                  ["Paiements", overview.payments],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-white/[0.07] bg-black/10 p-4">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-stone-500">{label}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-stone-100">
                      {Number(value).toLocaleString("fr-FR")}
                    </p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5">
                      <span
                        className="block h-full rounded-full bg-[linear-gradient(90deg,#d39f42,#f2d796)]"
                        style={{ width: `${Math.max(8, Math.min(100, Number(value) * 4))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lux-glass rounded-[20px] p-5 sm:p-6">
              <p className="lux-kicker">À traiter</p>
              <h2 className="mt-2 text-xl text-stone-100">Priorités opérationnelles</h2>
              <ul className="mt-5 divide-y divide-white/[0.07]">
                {[
                  ["Dossiers d’identité", overview.pendingKyc, "/admin/verifications"],
                  ["Offres au catalogue", overview.products, "/admin/offers"],
                  ["Comptes clients", overview.clients, "/admin/clients"],
                ].map(([label, count, href]) => (
                  <li key={String(label)} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                    <div>
                      <p className="text-sm text-stone-200">{label}</p>
                      <p className="mt-1 text-xs text-stone-500">Accès direct au module</p>
                    </div>
                    <Link
                      href={String(href)}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs tabular-nums text-[var(--lux-gold-light)] transition hover:bg-white/[0.04]"
                    >
                      {Number(count).toLocaleString("fr-FR")} →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <div>
              <p className="lux-kicker">Dernières commandes</p>
              <TableCard>
                {latestOrders.loading ? (
                  <TableLoading />
                ) : latestOrders.items.length === 0 ? (
                  <TableEmpty label="Aucune commande enregistrée." />
                ) : (
                  <DataTable
                    columns={["Commande", "Client", "Montant", "État", "Créée"]}
                    actionLabel={null}
                    minWidth={520}
                  >
                    {latestOrders.items.map((order) => (
                      <tr key={order.id} className="transition hover:bg-white/[0.025]">
                        <td className="px-4 py-3.5 text-stone-300">{order.orderNumber}</td>
                        <td className="max-w-[180px] truncate px-4 py-3.5 text-stone-300">
                          {order.buyer.email}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                          {formatXof(Number(order.totalAmount))}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                          {new Date(order.createdAt).toLocaleDateString("fr-FR")}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </TableCard>
              <ErrorAlert error={latestOrders.error} />
            </div>

            <div>
              <p className="lux-kicker">Derniers paiements</p>
              <TableCard>
                {latestPayments.loading ? (
                  <TableLoading />
                ) : latestPayments.items.length === 0 ? (
                  <TableEmpty label="Aucun paiement enregistré." />
                ) : (
                  <DataTable
                    columns={["Transaction", "Compte", "Montant", "État", "Date"]}
                    actionLabel={null}
                    minWidth={520}
                  >
                    {latestPayments.items.map((payment) => (
                      <tr key={payment.id} className="transition hover:bg-white/[0.025]">
                        <td className="px-4 py-3.5 text-stone-300">{payment.paymentNumber}</td>
                        <td className="max-w-[180px] truncate px-4 py-3.5 text-stone-300">
                          {payment.user?.email ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                          {formatXof(Number(payment.amount))}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={payment.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                          {new Date(payment.paidAt ?? payment.createdAt).toLocaleDateString("fr-FR")}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </TableCard>
              <ErrorAlert error={latestPayments.error} />
            </div>
          </section>
        </>
      ) : null}

      <section className="mt-8">
        <p className="lux-kicker">Accès rapide</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="lux-glass flex items-center justify-between gap-3 rounded-[16px] px-4 py-4 transition hover:-translate-y-0.5"
            >
              <span className="text-sm text-stone-200">{link.label}</span>
              <span className="font-mono text-[10px] text-[var(--lux-gold)]">{link.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-[18px] border border-white/[0.08] bg-[#111927]/65 p-4 text-xs leading-relaxed text-stone-400">
        Les montants et états sont chargés depuis l’API. Les opérations sensibles nécessitent une
        justification et sont inscrites au journal d’audit.
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "gold" | "green" | "amber";
  href?: string;
}) {
  const color =
    tone === "gold"
      ? "text-[var(--lux-gold-light)]"
      : tone === "green"
        ? "text-emerald-300"
        : tone === "amber"
          ? "text-amber-200"
          : "text-stone-100";
  const content = (
    <div className="lux-glass min-h-[128px] rounded-[18px] p-4 sm:p-5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</p>
      <p className={`mt-3 break-words text-xl font-semibold tabular-nums sm:text-2xl ${color}`}>{value}</p>
      <p className="mt-2 text-[10px] text-stone-500">{detail}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:-translate-y-0.5">
      {content}
    </Link>
  ) : (
    content
  );
}
