"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, request, formatXof } from "@/lib/api";
import { Alert, Button, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { LuxShell } from "@/components/lux/lux-shell";

type View = "overview" | "clients" | "sellers" | "offerings" | "orders" | "payments";
type AdminUser = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type Overview = { users: number; clients: number; products: number; orders: number; payments: number; pendingKyc: number; activeSellers: number; settledRevenue: number };
type Row = Record<string, unknown>;

const NAV: { id: View | "kyc"; label: string; hint: string }[] = [
  { id: "overview", label: "Vue d’ensemble", hint: "01" },
  { id: "clients", label: "Clients", hint: "02" },
  { id: "sellers", label: "Vendeurs", hint: "03" },
  { id: "kyc", label: "Vérifications", hint: "04" },
  { id: "offerings", label: "Offres", hint: "05" },
  { id: "orders", label: "Commandes", hint: "06" },
  { id: "payments", label: "Paiements", hint: "07" },
];

const ENDPOINTS: Record<Exclude<View, "overview">, string> = {
  clients: "/api/v1/admin/clients",
  sellers: "/api/v1/admin/sellers",
  offerings: "/api/v1/admin/offerings",
  orders: "/api/v1/admin/orders",
  payments: "/api/v1/admin/payments",
};

export default function ConsolePage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [view, setView] = useState<View>("overview");
  const [rows, setRows] = useState<Row[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const data = await request<Overview>("/api/v1/admin/overview");
    setOverview(data);
  }, []);

  const loadRows = useCallback(async (target: Exclude<View, "overview">, query: string) => {
    const params = new URLSearchParams({ page: "1", perPage: "50" });
    if (query) params.set("q", query);
    const data = await request<Row[]>(`${ENDPOINTS[target]}?${params.toString()}`);
    setRows(data);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      request<{ user: AdminUser }>("/api/v1/auth/admin/me"),
      request<Overview>("/api/v1/admin/overview"),
    ]).then(([session, stats]) => {
      if (!active) return;
      setAdmin(session.user);
      setOverview(stats);
      setError(null);
    }).catch(() => router.replace("/console/sign-in")).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (view === "overview") return;
    let active = true;
    setLoading(true);
    void loadRows(view, search).then(() => { if (active) setError(null); })
      .catch((err) => { if (active) setError(err instanceof ApiClientError ? err.message : "Impossible de charger les données."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view, search, loadRows]);

  async function refresh() {
    setBusy("refresh"); setError(null);
    try {
      if (view === "overview") await loadOverview();
      else await loadRows(view, search);
      setNotice("Données actualisées.");
    } catch (err) { setError(err instanceof Error ? err.message : "Actualisation impossible."); }
    finally { setBusy(null); }
  }

  async function logout() {
    try { await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({}) }); }
    finally { router.replace("/console/sign-in"); }
  }

  async function changeStatus(row: Row, target: View, nextStatus: string) {
    const id = String(row.id ?? "");
    if (!id) return;
    const description = window.prompt("Motif de cette action (minimum 5 caractères)");
    if (!description || description.trim().length < 5) return;
    setBusy(id); setError(null); setNotice(null);
    try {
      const path = target === "clients" ? `/api/v1/admin/clients/${id}/status` : target === "sellers" ? `/api/v1/admin/sellers/${id}/status` : `/api/v1/admin/offerings/${id}/status`;
      await request(path, { method: "PATCH", body: JSON.stringify({ status: nextStatus, reason: description.trim() }) });
      setNotice("Modification enregistrée et journalisée.");
      await loadRows(target as Exclude<View, "overview">, search);
      await loadOverview();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Modification refusée."); }
    finally { setBusy(null); }
  }

  const fullName = [admin?.firstName, admin?.lastName].filter(Boolean).join(" ") || "Administrateur";
  const title = view === "overview" ? "Vue d’ensemble" : view === "offerings" ? "Offres" : view[0]!.toUpperCase() + view.slice(1);

  if (loading && !admin) return <LuxShell><div className="relative z-10 grid min-h-screen place-items-center text-sm text-stone-400"><span className="flex items-center gap-3"><Spinner /> Ouverture de la console sécurisée…</span></div></LuxShell>;

  return <LuxShell>
    <div className="relative z-10 min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#080e19]/75 px-4 py-4 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <Link href="/" className="lux-serif text-xl font-bold text-stone-50">MISTERDOU<span className="text-[var(--lux-gold)]">.</span></Link>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-stone-500">Console de gestion</p>
        <nav aria-label="Navigation console" className="mt-6 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {NAV.map((item) => item.id === "kyc" ? <Link key={item.id} href="/identity-verification/review" className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-stone-400 transition hover:bg-white/[0.06] hover:text-stone-100 lg:w-full"><span className="font-mono text-[10px] text-[var(--lux-gold)]">{item.hint}</span>{item.label}{overview?.pendingKyc ? <span className="ml-auto rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-200">{overview.pendingKyc}</span> : null}</Link> : <button key={item.id} type="button" onClick={() => setView(item.id as View)} aria-current={view === item.id ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition lg:w-full ${view === item.id ? "border border-amber-200/15 bg-amber-300/[0.09] text-[var(--lux-gold-light)]" : "text-stone-400 hover:bg-white/[0.06] hover:text-stone-100"}`}><span className="font-mono text-[10px] text-[var(--lux-gold)]">{item.hint}</span>{item.label}</button>)}
        </nav>
        <div className="mt-6 hidden border-t border-white/10 pt-4 lg:block"><p className="text-[10px] uppercase tracking-[0.15em] text-stone-500">Session protégée</p><p className="mt-1 truncate text-xs text-stone-300">{admin?.email}</p><p className="mt-1 text-[10px] text-emerald-300">MFA activée · session courte</p><button onClick={() => void logout()} className="mt-4 text-xs text-stone-400 transition hover:text-red-200">Déconnexion</button></div>
      </aside>

      <main className="min-w-0 px-4 pb-12 pt-6 sm:px-6 lg:px-9 lg:pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div><p className="lux-kicker">Espace administration</p><h1 className="mt-2 text-3xl sm:text-4xl">{title}</h1><p className="mt-2 text-xs text-stone-500">Connecté : {fullName} · {admin?.email}</p></div>
          <div className="flex items-center gap-2"><Button variant="outline" loading={busy === "refresh"} onClick={() => void refresh()}>Actualiser</Button><button onClick={() => void logout()} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-stone-400 hover:border-red-300/30 hover:text-red-200 lg:hidden">Sortir</button></div>
        </header>

        {error && <div className="mt-5"><Alert tone="danger">{error}</Alert></div>}
        {notice && <div className="mt-5"><Alert tone="success">{notice}</Alert></div>}

        {view === "overview" && overview && <>
          <section aria-label="Indicateurs de la plateforme" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Revenus encaissés" value={formatXof(overview.settledRevenue)} detail="Paiements confirmés" tone="gold" />
            <Metric label="Membres" value={overview.users.toLocaleString("fr-FR")} detail={`${overview.clients} clients`} />
            <Metric label="Vendeurs actifs" value={overview.activeSellers.toLocaleString("fr-FR")} detail="Comptes marchands" tone="green" />
            <Metric label="Vérifications à traiter" value={overview.pendingKyc.toLocaleString("fr-FR")} detail="Dossiers en attente" tone="amber" href="/identity-verification/review" />
          </section>
          <section className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="lux-glass rounded-[20px] p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="lux-kicker">Activité plateforme</p><h2 className="mt-2 text-xl text-stone-100">Volume de gestion</h2></div><span className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Total actuel</span></div><div className="mt-7 grid grid-cols-3 gap-3">{[["Offres", overview.products], ["Commandes", overview.orders], ["Paiements", overview.payments]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><p className="text-[10px] uppercase tracking-[0.12em] text-stone-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-stone-100">{Number(value).toLocaleString("fr-FR")}</p><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-[linear-gradient(90deg,#d39f42,#f2d796)]" style={{ width: `${Math.max(8, Math.min(100, Number(value) * 4))}%` }} /></div></div>)}</div></div>
            <div className="lux-glass rounded-[20px] p-5 sm:p-6"><p className="lux-kicker">À traiter</p><h2 className="mt-2 text-xl text-stone-100">Priorités opérationnelles</h2><ul className="mt-5 divide-y divide-white/[0.07]">{[["Dossiers d’identité", overview.pendingKyc, "/identity-verification/review"], ["Offres à modérer", overview.products, "#offerings"]].map(([label, count, href]) => <li key={String(label)} className="flex items-center justify-between gap-4 py-3 first:pt-0"><div><p className="text-sm text-stone-200">{label}</p><p className="mt-1 text-xs text-stone-500">En attente de traitement</p></div><Link href={String(href)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs tabular-nums text-[var(--lux-gold-light)] hover:bg-white/[0.04]">{Number(count).toLocaleString("fr-FR")} →</Link></li>)}</ul></div>
          </section>
          <section className="mt-6 rounded-[18px] border border-white/[0.08] bg-[#111927]/65 p-4 text-xs leading-relaxed text-stone-400">Les montants et états sont chargés depuis l’API. Les opérations sensibles nécessitent une justification et sont inscrites au journal d’audit.</section>
        </>}

        {view !== "overview" && <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="lux-kicker">Gestion de la plateforme</p><p className="mt-2 text-sm text-stone-400">{view === "clients" ? "Comptes clients et accès" : view === "sellers" ? "Comptes vendeurs et soldes" : view === "offerings" ? "Catalogue et modération des offres" : view === "orders" ? "Suivi des commandes" : "Transactions enregistrées"}</p></div>
            <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }} className="flex w-full gap-2 sm:w-auto"><TextInput value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={view === "clients" || view === "sellers" ? "Nom ou e-mail" : "Référence ou nom"} className="min-w-0 sm:w-64" /><Button type="submit">Rechercher</Button></form>
          </div>
          <div className="mt-5 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#101825]/80">
            {loading ? <p className="flex items-center gap-3 p-6 text-sm text-stone-400"><Spinner /> Chargement des données…</p> : rows.length === 0 ? <p className="p-6 text-sm text-stone-400">Aucun résultat pour cette recherche.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead className="bg-white/[0.035] text-[9px] uppercase tracking-[0.14em] text-stone-500"><tr>{columnsFor(view).map((column) => <th key={column.key} className="px-4 py-3 font-semibold">{column.label}</th>)}<th className="px-4 py-3 font-semibold">Action</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{rows.map((row) => <tr key={String(row.id)} className="transition hover:bg-white/[0.025]">{columnsFor(view).map((column) => <td key={column.key} className="px-4 py-3.5 text-stone-300">{formatCell(row[column.key], column.key)}</td>)}<td className="px-4 py-3.5">{renderActions(view, row, busy, changeStatus)}</td></tr>)}</tbody></table></div>}
          </div>
        </section>}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4 text-[10px] uppercase tracking-[0.14em] text-stone-600"><span>MISTERDOU · Opérations</span><span>Session à privilèges · MFA</span></footer>
      </main>
    </div>
  </LuxShell>;
}

function Metric({ label, value, detail, tone = "default", href }: { label: string; value: string; detail: string; tone?: "default" | "gold" | "green" | "amber"; href?: string }) {
  const color = tone === "gold" ? "text-[var(--lux-gold-light)]" : tone === "green" ? "text-emerald-300" : tone === "amber" ? "text-amber-200" : "text-stone-100";
  const content = <div className="lux-glass min-h-[128px] rounded-[18px] p-4 sm:p-5"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</p><p className={`mt-3 break-words text-xl font-semibold tabular-nums sm:text-2xl ${color}`}>{value}</p><p className="mt-2 text-[10px] text-stone-500">{detail}</p></div>;
  return href ? <Link href={href} className="block transition hover:-translate-y-0.5">{content}</Link> : content;
}

function columnsFor(view: View) {
  if (view === "clients") return [{ key: "firstName", label: "Client" }, { key: "email", label: "E-mail" }, { key: "phoneNumber", label: "Téléphone" }, { key: "kycStatus", label: "Identité" }, { key: "status", label: "Compte" }, { key: "_count", label: "Commandes" }];
  if (view === "sellers") return [{ key: "firstName", label: "Vendeur" }, { key: "email", label: "E-mail" }, { key: "status", label: "Statut" }, { key: "balanceAvailable", label: "Disponible" }, { key: "balancePending", label: "En attente" }, { key: "kycStatus", label: "Identité" }];
  if (view === "offerings") return [{ key: "title", label: "Offre" }, { key: "ownerType", label: "Origine" }, { key: "basePrice", label: "Prix" }, { key: "paymentMode", label: "Paiement" }, { key: "status", label: "Statut" }, { key: "slug", label: "Identifiant" }];
  if (view === "orders") return [{ key: "orderNumber", label: "Commande" }, { key: "buyer", label: "Client" }, { key: "totalAmount", label: "Montant" }, { key: "paymentMode", label: "Mode" }, { key: "status", label: "État" }, { key: "createdAt", label: "Créée" }];
  return [{ key: "paymentNumber", label: "Transaction" }, { key: "providerReference", label: "Référence PayTech" }, { key: "user", label: "Compte" }, { key: "amount", label: "Montant" }, { key: "type", label: "Type" }, { key: "status", label: "État" }];
}

function formatCell(value: unknown, key: string): React.ReactNode {
  if (key === "status" || key === "kycStatus") return <StatusBadge status={String(value ?? "—")} />;
  if (value === null || value === undefined || value === "") return <span className="text-stone-600">—</span>;
  if (key === "basePrice" || key === "totalAmount" || key === "amount" || key === "balanceAvailable" || key === "balancePending") return <span className="whitespace-nowrap tabular-nums">{formatXof(Number(value))}</span>;
  if (key === "createdAt" || key === "paidAt") return <span className="whitespace-nowrap">{new Date(String(value)).toLocaleDateString("fr-FR")}</span>;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (key === "_count") return <span>{String(item.orders ?? 0)}</span>;
    return <span>{String(item.email ?? item.orderNumber ?? [item.firstName, item.lastName].filter(Boolean).join(" ") ?? "—")}</span>;
  }
  return <span className="max-w-[220px] truncate">{String(value)}</span>;
}

function renderActions(view: View, row: Row, busy: string | null, changeStatus: (row: Row, target: View, status: string) => Promise<void>) {
  const status = String(row.status ?? "");
  const id = String(row.id ?? "");
  if (view === "clients") return <button disabled={busy === id} onClick={() => void changeStatus(row, view, status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")} className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--lux-gold-light)] disabled:opacity-50">{status === "ACTIVE" ? "Suspendre" : "Réactiver"}</button>;
  if (view === "sellers") return <button disabled={busy === id} onClick={() => void changeStatus(row, view, status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")} className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--lux-gold-light)] disabled:opacity-50">{status === "ACTIVE" ? "Suspendre" : "Activer"}</button>;
  if (view === "offerings") return <button disabled={busy === id} onClick={() => void changeStatus(row, view, status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")} className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--lux-gold-light)] disabled:opacity-50">{status === "ACTIVE" ? "Désactiver" : "Publier"}</button>;
  return <span className="text-stone-600">Lecture</span>;
}
