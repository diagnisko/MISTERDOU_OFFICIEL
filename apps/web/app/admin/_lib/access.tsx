"use client";

import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// Ce que la personne connectée peut voir dans la console. L'administrateur voit
// tout ; un manager ne voit QUE les modules qui lui ont été attribués (menu,
// vue d'ensemble, recherche). Le serveur contrôle de toute façon chaque appel.
// ---------------------------------------------------------------------------

export type Permission = "KYC" | "PAYMENTS" | "WITHDRAWALS" | "SELLERS" | "PRODUCTS" | "ORDERS" | "STATS" | "SETTINGS" | "SUPPORT";

/** "ADMIN" : réservé à l'administrateur ; null : visible par toute l'équipe. */
export type Requirement = Permission | "ADMIN" | null;

export type AdminAccess = { role: "ADMIN" | "STAFF"; permissions: Permission[]; title?: string | null };

const AccessContext = createContext<AdminAccess | null>(null);

export const AdminAccessProvider = AccessContext.Provider;

export function allows(access: AdminAccess | null, need: Requirement): boolean {
  if (!access) return false;
  if (access.role === "ADMIN") return true;
  if (need === "ADMIN") return false;
  return need === null || access.permissions.includes(need);
}

export function useAdminAccess() {
  const access = useContext(AccessContext);
  return {
    access,
    isAdmin: access?.role === "ADMIN",
    can: (need: Requirement) => allows(access, need),
  };
}

/** Module requis par chaque page de la console (préfixe d'adresse). */
export const PAGE_REQUIREMENTS: Array<{ prefix: string; need: Requirement }> = [
  { prefix: "/admin/plans", need: "PAYMENTS" },
  { prefix: "/admin/payments", need: "PAYMENTS" },
  { prefix: "/admin/orders", need: "ORDERS" },
  { prefix: "/admin/codes", need: "ORDERS" },
  { prefix: "/admin/withdrawals", need: "WITHDRAWALS" },
  { prefix: "/admin/clients", need: "SUPPORT" },
  { prefix: "/admin/sellers", need: "SELLERS" },
  { prefix: "/admin/verifications", need: "KYC" },
  { prefix: "/admin/offers", need: "PRODUCTS" },
  { prefix: "/admin/promotions", need: "PRODUCTS" },
  { prefix: "/admin/discussions", need: "SUPPORT" },
  { prefix: "/admin/messages", need: "SUPPORT" },
  { prefix: "/admin/support", need: "SUPPORT" },
  { prefix: "/admin/team", need: "SETTINGS" },
  { prefix: "/admin/settings", need: "SETTINGS" },
  { prefix: "/admin/audit", need: "SETTINGS" },
];

export function requirementFor(pathname: string): Requirement {
  const hit = PAGE_REQUIREMENTS.find((p) => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`));
  return hit ? hit.need : null;
}
