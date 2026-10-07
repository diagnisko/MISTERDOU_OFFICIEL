"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ApiClientError, OUTSIDE_SHIFT_EVENT, request, shiftClosed, type ShiftClosed } from "@/lib/api";
import { logoutAccount, refreshAccount } from "@/lib/account";
import { Spinner } from "@/components/ui";
import { DashShell, type DashNavItem } from "@/components/dash/dash-ui";
import {
  IconBadgeCheck,
  IconCalendar,
  IconCard,
  IconCart,
  IconChat,
  IconClock,
  IconGear,
  IconHome,
  IconLifebuoy,
  IconList,
  IconPercent,
  IconStore,
  IconTag,
  IconUsers,
  IconWallet,
  IconSpark,
} from "@/components/dash/dash-icons";
import { AdminAccessProvider, allows, requirementFor, type AdminAccess } from "./_lib/access";

// ---------------------------------------------------------------------------
// Coquille de l'espace /admin : garde d'authentification + sidebar + header.
// Session attendue : session d'administration (2FA) via /auth/admin/me ; à défaut
// un compte STAFF via /auth/me est accepté. Toute autre session → /console/sign-in.
// Un manager ne voit que les modules attribués (GET /admin/me/access).
// ---------------------------------------------------------------------------

type SessionUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role?: string | null;
};

const NAV: DashNavItem[] = [
  { href: "/admin", label: "Vue d’ensemble", icon: IconHome },
  { href: "/offres", label: "Voir la boutique", icon: IconStore },
  { href: "/admin/plans", label: "Paiements échelonnés", icon: IconCalendar, group: "Argent" },
  { href: "/admin/payments", label: "Paiements", icon: IconCard, group: "Argent" },
  { href: "/admin/orders", label: "Commandes", icon: IconCart, group: "Argent" },
  { href: "/admin/codes", label: "Codes de vérification", icon: IconClock, group: "Argent" },
  { href: "/admin/withdrawals", label: "Retraits vendeurs", icon: IconWallet, group: "Argent" },
  { href: "/admin/clients", label: "Clients", icon: IconUsers, group: "Membres" },
  { href: "/admin/sellers", label: "Vendeurs", icon: IconStore, group: "Membres" },
  { href: "/admin/verifications", label: "Vérifications", icon: IconBadgeCheck, group: "Membres" },
  { href: "/admin/offers", label: "Offres", icon: IconTag, group: "Catalogue" },
  { href: "/admin/promotions", label: "Promotions", icon: IconPercent, group: "Catalogue" },
  { href: "/admin/discussions", label: "Discussions comptes", icon: IconChat, group: "Relation" },
  { href: "/admin/messages", label: "Messages", icon: IconChat, group: "Relation" },
  { href: "/admin/support", label: "Support", icon: IconLifebuoy, group: "Relation" },
  { href: "/admin/team", label: "Équipe", icon: IconSpark, group: "Plateforme" },
  { href: "/admin/settings", label: "Paramètres", icon: IconGear, group: "Plateforme" },
  { href: "/admin/audit", label: "Journal d’activité", icon: IconList, group: "Plateforme" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [sessionKind, setSessionKind] = useState<"admin" | "staff">("admin");
  const [resolved, setResolved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Manager hors de ses créneaux : message du serveur (avec ses horaires).
  const [closed, setClosed] = useState<ShiftClosed | null>(null);

  useEffect(() => {
    const onClosed = (event: Event) => setClosed((event as CustomEvent<ShiftClosed>).detail);
    window.addEventListener(OUTSIDE_SHIFT_EVENT, onClosed);
    return () => window.removeEventListener(OUTSIDE_SHIFT_EVENT, onClosed);
  }, []);

  // Espace fermé : nouvel essai chaque minute, la console s'ouvre au début du créneau.
  useEffect(() => {
    if (!closed) return;
    const timer = setInterval(() => {
      request("/api/v1/admin/me/access")
        .then(() => window.location.reload())
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(timer);
  }, [closed]);

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

      // Modules visibles (un manager sans accès lisible ne voit que la vue d'ensemble).
      let rights: AdminAccess | null = null;
      let closedNotice: ShiftClosed | null = null;
      if (session) {
        rights = await request<AdminAccess>("/api/v1/admin/me/access").catch((err) => {
          if (err instanceof ApiClientError && err.code === "OUTSIDE_SHIFT") {
            closedNotice = shiftClosed(err.message, err.details);
            return null;
          }
          return { role: kind === "staff" ? "STAFF" : "ADMIN", permissions: [] } as AdminAccess;
        });
      }

      if (!active) return;
      setResolved(true);
      if (session && closedNotice) {
        setUser(session);
        setClosed(closedNotice);
      } else if (session) {
        setAccess(rights);
        setUser(session);
        setSessionKind(kind);
        void refreshAccount();
      } else {
        router.replace("/login");
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
      await logoutAccount();
    } finally {
      router.replace("/login");
    }
  }

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Administrateur";

  if (closed) {
    return (
      <div data-lux className="dash-root grid min-h-dvh place-items-center px-4 py-10">
        <div className="dash-card w-full max-w-md p-7 text-center sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[rgba(255,138,92,0.35)] bg-[rgba(232,71,36,0.08)] text-[#ff8a5c]">
            <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          {user?.firstName && <p className="mt-5 text-[13px] text-[#b8a6a1]">Bonjour {user.firstName},</p>}
          <h1 className="mt-1 text-[19px] font-semibold leading-snug text-stone-50">{closed.title}</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[#cdbab3]">{closed.message}</p>
          {closed.schedule && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8f7d77]">Vos heures de travail</p>
              <p className="mt-1 text-[13.5px] text-stone-200">{closed.schedule}</p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href="/" className="dash-btn dash-btn-ghost">
              Aller sur le site
            </Link>
            <button type="button" onClick={() => void logout()} disabled={loggingOut} className="dash-btn dash-btn-primary disabled:opacity-60">
              {loggingOut && <Spinner />} Se déconnecter
            </button>
          </div>
          <p className="mt-5 text-[11.5px] text-[#8f7d77]">Cette page se rouvre d’elle-même au début de votre créneau.</p>
        </div>
      </div>
    );
  }

  if (!resolved || !user || !access) {
    return (
      <div data-lux className="dash-root grid place-items-center text-sm text-[#b8a6a1]">
        <span className="flex items-center gap-3">
          <Spinner /> Ouverture de l’espace administration…
        </span>
      </div>
    );
  }

  const nav = NAV.filter((item) => allows(access, requirementFor(item.href)));
  const allowed = allows(access, requirementFor(pathname));

  return (
    <AdminAccessProvider value={access}>
      <DashShell
        nav={nav}
        areaLabel={access.role === "ADMIN" ? "Espace administration" : access.title ? `Espace manager · ${access.title}` : "Espace manager"}
        user={{ name, email: user.email }}
        onLogout={() => void logout()}
        loggingOut={loggingOut}
        memberSearch={allows(access, "SUPPORT")}
      >
        {allowed ? (
          children
        ) : (
          <div className="dash-card mx-auto mt-10 max-w-md p-7 text-center">
            <p className="text-[17px] font-semibold text-stone-50">Cette section ne fait pas partie de votre espace</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[#b8a6a1]">
              Elle n’a pas été attribuée à votre compte. Si vous en avez besoin, demandez-la à un administrateur.
            </p>
            <Link href="/admin" className="dash-btn dash-btn-primary mt-5 inline-flex">
              Retour à mon espace
            </Link>
          </div>
        )}
      </DashShell>
    </AdminAccessProvider>
  );
}
