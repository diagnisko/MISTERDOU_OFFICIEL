"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { request } from "@/lib/api";
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
  { href: "/admin/audit", label: "Journal d’audit", icon: IconList, group: "Plateforme" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [sessionKind, setSessionKind] = useState<"admin" | "staff">("admin");
  const [resolved, setResolved] = useState(false);
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

      // Modules visibles (un manager sans accès lisible ne voit que la vue d'ensemble).
      let rights: AdminAccess | null = null;
      if (session) {
        rights = await request<AdminAccess>("/api/v1/admin/me/access").catch(() => ({ role: kind === "staff" ? "STAFF" : "ADMIN", permissions: [] }) as AdminAccess);
      }

      if (!active) return;
      setResolved(true);
      if (session) {
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
