"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useT } from "@/lib/i18n";

// Icône « messages » de l'en-tête, à côté de la cloche : même style, pastille
// des messages non lus (achats et ventes), ouvre la bonne boîte de réception.

type Unread = { total: number; href: string };

export function MessagesButton() {
  const account = useAccount();
  const t = useT();
  const [unread, setUnread] = useState<Unread>({ total: 0, href: "/account/messages" });
  const member = account.status === "member";

  const load = useCallback(async () => {
    try {
      setUnread(await request<Unread>("/api/v1/threads/unread"));
    } catch {
      /* sans conséquence : l'icône reste accessible */
    }
  }, []);
  useVisiblePoll(load, 30_000, { enabled: member, immediate: true });

  if (!member) return null;
  const badge = unread.total > 9 ? "9+" : String(unread.total);

  return (
    <Link
      href={unread.href}
      aria-label={unread.total > 0 ? t("msgIcon.unread", { count: unread.total }) : t("msgIcon.label")}
      className="relative grid h-10 w-10 place-items-center rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lux-gold)]/60"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 12.5a7.5 7.5 0 0 1-11.1 6.6L4 20l1-4.3A7.5 7.5 0 1 1 20 12.5Z" />
      </svg>
      {unread.total > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-1 text-[10px] font-bold leading-[18px] text-[#1a0503]">
          {badge}
        </span>
      )}
    </Link>
  );
}
