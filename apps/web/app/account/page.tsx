"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, request, formatXof } from "@/lib/api";
import { Alert, Badge, Button, Spinner, StatusBadge } from "@/components/ui";
import { LuxProvider } from "@/components/lux/lux-data";
import { LuxFooter } from "@/components/lux/lux-footer";
import { IconArrowRight, IconShield } from "@/components/lux/lux-icons";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { fetchMyOrders, revealOrderCredentials, type OrderSummary, type RevealedCredentials } from "@/lib/orders";
import { fetchSchedule, payNextInstallment, type Schedule } from "@/lib/installments";

type Me = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  status: string;
  twoFactorEnabled: boolean;
  phoneVerified: boolean;
  kycStatus?: string;
  createdAt: string;
};

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const u = await request<{ user: Me }>("/api/v1/auth/me");
      setMe(u.user);
      setPhoneVerified(Boolean(u.user.phoneVerified));
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")) {
        router.replace("/login");
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function logout() {
    setLoggingOut(true);
    try {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } finally {
      router.replace("/");
    }
  }

  if (loading) {
    return (
      <LuxProvider>
        <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
          <div className="lux-bg" aria-hidden />
          <p className="relative z-10 grid min-h-[70vh] place-items-center text-[12px] uppercase tracking-[0.24em] text-stone-400">
            <span className="flex items-center gap-3">
              <Spinner className="h-4 w-4 text-[var(--lux-gold)]" /> Chargement de votre espace
            </span>
          </p>
        </div>
      </LuxProvider>
    );
  }

  if (!me) {
    return (
      <LuxProvider>
        <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
          <div className="lux-bg" aria-hidden />
          <main className="relative z-10 mx-auto max-w-3xl px-5 pt-40 md:px-8">
            <Alert tone="warning">
              Session expirée. <Link href="/login" className="text-[var(--lux-gold-light)] hover:underline">Se connecter</Link>
            </Alert>
          </main>
        </div>
      </LuxProvider>
    );
  }

  const fullName = [me.firstName, me.lastName].filter(Boolean).join(" ") || "Compte sans profil";
  return (
    <LuxProvider>
      <div data-lux className="relative min-h-screen overflow-x-clip text-stone-100">
        <div className="lux-bg" aria-hidden />

        <header className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.08)] bg-[#0f172a]/82 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 md:px-8">
            <Link href="/" className="lux-serif text-[22px] font-bold tracking-[0.02em] text-stone-50">
              MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
            </Link>
            <nav aria-label="Navigation de l'espace membre" className="flex items-center gap-1 sm:gap-2">
              <NotificationBell />
              <NavLink href="/catalogue">Catalogue</NavLink>
              <button
                type="button"
                onClick={logout}
                disabled={loggingOut}
                className="rounded-2xl border border-[rgba(255,255,255,0.12)] px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-300 transition-colors hover:border-[rgba(245,215,142,0.45)] hover:text-[var(--lux-gold-light)] disabled:opacity-50 sm:px-4"
              >
                {loggingOut ? "…" : "Déconnexion"}
              </button>
            </nav>
          </div>
        </header>

        <main className="relative z-10 px-5 pt-14 md:px-8 md:pt-16">
          <div className="mx-auto max-w-5xl">
            {/* Identité */}
            <div className="flex flex-wrap items-center gap-5">
              <span className="grid h-16 w-16 place-items-center rounded-2xl border border-[rgba(245,215,142,0.28)] bg-[rgba(245,158,11,0.12)] font-serif text-2xl font-bold text-[var(--lux-gold-light)]">
                {fullName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="lux-kicker">Espace membre</p>
                <h1 className="lux-serif mt-2 text-[32px] font-semibold leading-tight text-stone-50 md:text-[40px]">
                  Bonjour, {fullName.split(" ")[0]}
                </h1>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-stone-400">
                  <span className="tabular-nums">
                    {me.countryCode} {me.phoneNumber}
                  </span>
                  <span aria-hidden className="text-stone-400">·</span>
                </p>
              </div>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2">
              <Card kicker="Achats" title="Mes achats" action={<Link href="/catalogue" className="text-[12px] text-[var(--lux-gold-light)] hover:underline">Voir le catalogue</Link>}>
                <OrdersPanel />
              </Card>
              <Card kicker="Compte" title="Sécurité">
                <ul className="space-y-3 text-sm">
                  <Row label="Statut">
                    <Badge cls="border-[#10b981]/40 bg-[#10b981]/10 text-[#10b981]">Actif</Badge>
                  </Row>
                  <Row label="Téléphone">
                    <span className="flex items-center justify-end gap-2">
                      <StatusBadge status={phoneVerified ? "VERIFIED_PHONE" : "UNVERIFIED"} />
                      {!phoneVerified && (
                        <Link href="/verify-phone" className="text-[var(--lux-gold-light)] hover:underline">Vérifier</Link>
                      )}
                    </span>
                  </Row>
                  <Row label="Identité">
                    <span className="flex items-center justify-end gap-2">
                      <StatusBadge status={me.kycStatus ?? "NOT_SUBMITTED"} />
                      <Link href="/identity-verification" className="text-[var(--lux-gold-light)] hover:underline">
                        {me.kycStatus === "VERIFIED" ? "Consulter" : "Vérifier"}
                      </Link>
                    </span>
                  </Row>
                  <Row label="E-mail">{me.email ?? "Non renseigné"}</Row>
                  <Row label="Inscrit le">
                    {new Date(me.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                  </Row>
                  <Row label="Double authentification">
                    <span className="text-stone-400">{me.twoFactorEnabled ? "Activée" : "—"}</span>
                  </Row>
                </ul>
              </Card>

            </div>

            {/* Raccourcis */}
            <section className="mt-6 lux-glass rounded-[24px] p-7">
              <p className="lux-kicker">Raccourcis</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                <QuickLink href="/messages" label="Messagerie" />
                <QuickLink href="/notifications" label="Notifications" />
                <QuickLink href="/support" label="Aide & support" />
                <QuickLink href="/catalogue" label="Parcourir le catalogue" />
                <QuickLink href="/verify-phone" label="Vérifier le téléphone" />
                <QuickLink href="/identity-verification" label="Dossier d’identité" />
              </ul>
            </section>

            <p className="mt-10 flex items-center gap-2 text-[11px] text-stone-400">
              <IconShield className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
              Vos accès sont chiffrés et ne sont affichés que dans « Mes achats », après confirmation du paiement.
            </p>
          </div>
        </main>

        <div className="relative z-10 mt-20">
          <LuxFooter />
        </div>
      </div>
    </LuxProvider>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-2xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-stone-100 sm:px-3.5"
    >
      {children}
    </Link>
  );
}

function OrdersPanel() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, RevealedCredentials>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await fetchMyOrders());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commandes indisponibles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reveal(id: string) {
    setBusy(id);
    setError(null);
    try {
      const creds = await revealOrderCredentials(id);
      setRevealed((prev) => ({ ...prev, [id]: creds }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accès indisponible");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-stone-400">
        <Spinner className="h-4 w-4 text-[var(--lux-gold)]" /> Chargement de vos commandes…
      </p>
    );
  }

  if (error && orders.length === 0) return <Alert tone="danger">{error}</Alert>;
  if (orders.length === 0) {
    return (
      <div>
        <p className="text-[14px] leading-relaxed text-stone-400">
          Aucune commande pour le moment — vos achats apparaîtront ici.
        </p>
        <Link
          href="/catalogue"
          className="lux-btn lux-btn-ghost mt-5 text-[12px] uppercase tracking-[0.14em]"
          style={{ borderRadius: 18 }}
        >
          Découvrir le catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="warning">{error}</Alert>}
      <ul className="space-y-3">
        {orders.map((order) => {
          const creds = revealed[order.id];
          return (
            <li key={order.id} className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400">{order.orderNumber}</p>
                  <p className="mt-1 truncate font-semibold text-stone-100">{order.firstItem?.title ?? "Commande"}</p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {order.itemCount} article{order.itemCount > 1 ? "s" : ""} ·{" "}
                    <span className="tabular-nums text-stone-200">{formatXof(order.totalAmount)}</span>
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              {order.status === "PENDING_PAYMENT" && (
                <p className="mt-3 text-xs text-[#fbbf24]">Paiement en attente — finalisez votre règlement.</p>
              )}

              {order.paymentMode === "INSTALLMENTS" &&
                order.status !== "CANCELLED" &&
                order.status !== "REFUNDED" && <SchedulePanel orderId={order.id} />}

              {order.canReveal && !creds && (
                <button
                  type="button"
                  onClick={() => reveal(order.id)}
                  disabled={busy === order.id}
                  className="lux-btn lux-btn-gold mt-3 w-full !min-h-[44px] text-[12px] uppercase tracking-[0.14em] disabled:opacity-60"
                  style={{ borderRadius: 18 }}
                >
                  {busy === order.id ? "Ouverture…" : "Voir mes identifiants"}
                </button>
              )}

              {creds && (
                <div className="mt-3 rounded-xl border border-[rgba(245,215,142,0.3)] bg-[rgba(245,158,11,0.1)] p-4">
                  <p className="lux-kicker">Accès livré — conservez-le en lieu sûr</p>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div className="grid gap-1">
                      <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Identifiant</dt>
                      <dd className="break-all font-mono text-stone-100">{creds.email}</dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Mot de passe</dt>
                      <dd className="break-all font-mono text-stone-100">{creds.password}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {order.status === "REFUNDED" && (
                <p className="mt-3 text-xs text-stone-400">
                  Remboursée — l&apos;accès correspondant a été révoqué.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SchedulePanel({ orderId }: { orderId: string }) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSchedule(orderId)
      .then((s) => {
        if (active) setSchedule(s);
      })
      .catch(() => {
        if (active) setLoadError("Échéancier indisponible");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (loading) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-stone-400">
        <Spinner className="h-3.5 w-3.5 text-[var(--lux-gold)]" /> Chargement de l’échéancier…
      </p>
    );
  }
  if (loadError) return <p className="mt-3 text-xs text-[#fca5a5]">{loadError}</p>;
  if (!schedule) return null;

  const pct =
    schedule.totalAmount > 0
      ? Math.min(100, Math.round((schedule.totalPaid / schedule.totalAmount) * 100))
      : 0;

  async function payNext() {
    setBusy(true);
    setPayError(null);
    try {
      const res = await payNextInstallment(orderId);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Règlement impossible");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[rgba(245,215,142,0.22)] bg-[rgba(245,158,11,0.06)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--lux-gold-light)]">
          Échéancier · {schedule.monthCount} mensualités
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] uppercase tracking-[0.14em] text-stone-400 transition-colors hover:text-stone-100"
        >
          {open ? "Masquer" : "Voir le détail"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-stone-400">Total</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-stone-100">{formatXof(schedule.totalAmount)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-stone-400">Payé</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-[#6ee7b7]">{formatXof(schedule.totalPaid)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-stone-400">Restant</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-[#fbbf24]">{formatXof(schedule.remainingAmount)}</p>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-[linear-gradient(90deg,#f5d78e,#f59e0b)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {payError && <p className="mt-3 text-xs text-[#fca5a5]">{payError}</p>}

      {!schedule.fullyPaid && schedule.nextDueDate && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-300">
            Prochaine échéance :{" "}
            <span className="font-semibold text-stone-100 tabular-nums">
              {formatXof(schedule.nextAmount ?? 0)}
            </span>{" "}
            <span className="text-stone-400">
              avant le {new Date(schedule.nextDueDate).toLocaleDateString("fr-FR")}
            </span>
          </p>
          <button
            type="button"
            onClick={() => void payNext()}
            disabled={busy}
            className="lux-btn lux-btn-gold !min-h-[40px] w-full text-[11.5px] uppercase tracking-[0.14em] disabled:opacity-60 sm:w-auto"
            style={{ borderRadius: 16 }}
          >
            {busy ? "Ouverture…" : "Régler la mensualité"}
          </button>
        </div>
      )}

      {schedule.fullyPaid && (
        <p className="mt-3 text-xs text-[#6ee7b7]">
          Échéancier soldé — votre accès est disponible dans « Mes achats ».
        </p>
      )}

      {open && (
        <ul className="mt-4 space-y-2">
          {schedule.installments.map((line) => (
            <li
              key={line.index}
              className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs"
            >
              <span className="text-stone-300">{line.label}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-stone-400">
                  {new Date(line.dueDate).toLocaleDateString("fr-FR")}
                </span>
                <span className="tabular-nums text-stone-100">{formatXof(line.amountDue)}</span>
                <StatusBadge status={line.status === "PAID" ? "PAID" : line.status === "OVERDUE" ? "FAILED" : line.status === "WAIVED" ? "REFUNDED" : "PENDING_PAYMENT"} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({
  kicker,
  title,
  action,
  children,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="lux-glass rounded-[24px] p-7">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="lux-kicker">{kicker}</p>
          <h2 className="lux-serif mt-2 text-[22px] font-semibold text-stone-50">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-stone-400">{label}</span>
      <span className="text-right text-stone-100">{children}</span>
    </li>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-sm text-stone-300 transition-colors hover:border-[rgba(245,215,142,0.35)] hover:text-stone-50"
      >
        {label}
        <IconArrowRight className="h-4 w-4 text-[var(--lux-gold)]" aria-hidden />
      </Link>
    </li>
  );
}

