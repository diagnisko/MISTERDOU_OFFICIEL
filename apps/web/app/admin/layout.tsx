"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { request } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { LuxShell } from "@/components/lux/lux-shell";

// ---------------------------------------------------------------------------
// Coquille de l'espace /admin : garde d'authentification + sidebar + header.
// Session attendue : session d'administration (2FA) via /auth/admin/me ; à défaut
// un compte STAFF via /auth/me est accepté. Toute autre session → /console/sign-in.
// ---------------------------------------------------------------------------

type SessionUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role?: string | null;
};

const NAV: { href: string; label: string; hint: string }[] = [
  { href: "/admin", label: "Tableau de bord", hint: "01" },
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
  { href: "/admin/support", label: "Support", hint: "14" },
  { href: "/admin/messages", label: "Messages", hint: "15" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionKind, setSessionKind] = useState<"admin" | "staff">("admin");
  const [resolved, setResolved] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Les deux requêtes sont exécutées AVANT toute redirection : aucune boucle.
  useEffect(() => {
    let active = true;

    async function resolve() {
      let session: SessionUser | null = null;
      let kind: "admin" | "staff" = "admin";

      try {
        const admin = await request<{ user: SessionUser }>("/api/v1/auth/admin/me");
        if (admin.user) session = admin.user;
      } catch {
        /* pas de session d'administration → repli sur /auth/me */
      }

      if (!session) {
        try {
          const current = await request<{ user: SessionUser }>("/api/v1/auth/me");
          if (current.user && current.user.role === "STAFF") {
            session = current.user;
            kind = "staff";
          }
        } catch {
          /* aucune session exploitable */
        }
      }

      if (!active) return;
      setResolved(true);
      if (session) {
        setUser(session);
        setSessionKind(kind);
      } else {
        router.replace("/console/sign-in");
      }
    }

    void resolve();
    return () => {
      active = false;
    };
  }, [router]);

  async function logout() {
    setLoggingOut(true);
    try {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } finally {
      router.replace("/console/sign-in");
    }
  }

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  const firstName = user?.firstName || "Utilisateur";

  if (!resolved || !user) {
    return (
      <LuxShell>
        <div className="relative z-10 grid min-h-screen place-items-center text-sm text-stone-400">
          <span className="flex items-center gap-3">
            <Spinner /> Ouverture de l’espace administration…
          </span>
        </div>
      </LuxShell>
    );
  }

  return (
    <LuxShell>
      <div className="relative z-10 min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-[#080e19]/75 px-4 py-4 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href="/" className="lux-serif text-xl font-bold text-stone-50">
                MISTERDOU<span className="text-[var(--lux-gold)]">.</span>
              </Link>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                Espace administration
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNavOpen((open) => !open)}
              aria-expanded={navOpen}
              aria-controls="admin-nav"
              className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 transition hover:text-stone-100 lg:hidden"
            >
              {navOpen ? "Fermer" : "Menu"}
            </button>
          </div>

          <nav
            id="admin-nav"
            aria-label="Navigation administration"
            className={`${navOpen ? "mt-5 flex" : "hidden"} gap-1 overflow-x-auto pb-1 lg:mt-6 lg:flex lg:flex-col lg:overflow-visible`}
          >
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setNavOpen(false)}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition lg:w-full ${
                    active
                      ? "border border-amber-200/15 bg-amber-300/[0.09] text-[var(--lux-gold-light)]"
                      : "text-stone-400 hover:bg-white/[0.06] hover:text-stone-100"
                  }`}
                >
                  <span className="font-mono text-[10px] text-[var(--lux-gold)]">{item.hint}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 hidden border-t border-white/10 pt-4 lg:block">
            <p className="text-[10px] uppercase tracking-[0.15em] text-stone-500">Session protégée</p>
            <p className="mt-1 truncate text-xs text-stone-300">{user.email}</p>
            <p className="mt-1 text-[10px] text-emerald-300">
              {sessionKind === "admin" ? "MFA activée · session courte" : "Session équipe"}
            </p>
            <button
              onClick={() => void logout()}
              className="mt-4 text-xs text-stone-400 transition hover:text-red-200"
            >
              Déconnexion
            </button>
          </div>
        </aside>

        <main className="min-w-0 px-4 pb-12 pt-6 sm:px-6 lg:px-9 lg:pt-8">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div>
              <p className="lux-kicker">Espace administration</p>
              <p className="lux-serif mt-2 text-2xl font-semibold text-stone-50 sm:text-3xl">MISTERDOU</p>
              <p className="mt-2 text-xs text-stone-500">
                Connecté : {firstName} · {user.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[var(--lux-gold-light)] sm:inline-block">
                {sessionKind === "admin" ? "Session MFA" : "Session équipe"}
              </span>
              <button
                onClick={() => void logout()}
                disabled={loggingOut}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-stone-400 transition hover:border-red-300/30 hover:text-red-200 disabled:opacity-60"
              >
                {loggingOut ? "Déconnexion…" : "Déconnexion"}
              </button>
            </div>
          </header>

          {children}

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4 text-[10px] uppercase tracking-[0.14em] text-stone-600">
            <span>MISTERDOU · Opérations</span>
            <span>Session à privilèges</span>
          </footer>
        </main>
      </div>
    </LuxShell>
  );
}
