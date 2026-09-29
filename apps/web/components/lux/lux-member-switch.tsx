"use client";

import type { ReactNode } from "react";
import { useAccount } from "@/lib/account";

// Affiche `guest` à un visiteur et `member` à un membre connecté (rien tant
// que la session n'est pas connue, pour ne pas montrer « Créer mon compte »
// une fraction de seconde à un membre).
export function MemberSwitch({ guest, member }: { guest: ReactNode; member: ReactNode }) {
  const account = useAccount();
  if (account.status === "loading") return null;
  return <>{account.status === "member" ? member : guest}</>;
}
