"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { formatDateTime } from "@/lib/format";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useT } from "@/lib/i18n";
import { ChatAvatar } from "./product-chat";

// ---------------------------------------------------------------------------
// Icône « messages » de l'en-tête, à côté de la cloche et sur le même modèle :
// pastille des non-lus, et un clic ouvre une petite fenêtre avec les dernières
// discussions (comptes achetés ou vendus, support). Un clic sur une discussion
// ouvre directement cette discussion.
// ---------------------------------------------------------------------------

type RecentItem = {
  key: string;
  kind: "product" | "support";
  title: string;
  counterpart: string;
  preview: string | null;
  at: string;
  unread: number;
  href: string;
  /** Photo de l'interlocuteur (vendeur ou client) ; sinon initiale, ou monogramme MISTERDOU. */
  imageUrl: string | null;
  counterpartKind?: "seller" | "client" | "platform";
};
type Recent = { total: number; href: string; items: RecentItem[] };

// Dernières discussions gardées d'une page à l'autre : la pastille ne repart pas de zéro.
let lastRecent: Recent | null = null;

export function MessagesButton() {
  const account = useAccount();
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<Recent>(() => lastRecent ?? { total: 0, href: "/account/messages", items: [] });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // Tout membre connecté : clients et vendeurs (leurs discussions), équipe (discussions à suivre),
  // dans la boutique comme dans la console.
  const member = account.status === "member";

  const load = useCallback(async () => {
    try {
      const recent = await request<Recent>("/api/v1/threads/recent");
      lastRecent = recent;
      setData(recent);
    } catch {
      /* sans conséquence : l'icône reste accessible */
    }
  }, []);
  useVisiblePoll(load, 30_000, { enabled: member, immediate: true });

  // Fermeture : clic extérieur + Échap (focus rendu au bouton).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!member) {
    lastRecent = null;
    return null;
  }
  const badge = data.total > 9 ? "9+" : String(data.total);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={data.total > 0 ? t("msgIcon.unread", { count: data.total }) : t("msgIcon.label")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
        className="relative grid h-9 w-9 place-items-center rounded-xl border sm:h-10 sm:w-10 border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lux-gold)]/60"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 12.5a7.5 7.5 0 0 1-11.1 6.6L4 20l1-4.3A7.5 7.5 0 1 1 20 12.5Z" />
        </svg>
        {data.total > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-1 text-[10px] font-bold leading-[18px] text-[#1a0503]">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("msgIcon.recent")}
          className="fixed inset-x-3 top-[68px] z-[70] overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[360px] rounded-[18px] border border-white/10 bg-[#050303]/97 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <div className="border-b border-white/[0.08] px-4 py-3">
            <p className="lux-kicker">{t("msgIcon.label")}</p>
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {data.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-stone-400">{t("msgIcon.empty")}</p>
            ) : (
              <ul>
                {data.items.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push(item.href);
                      }}
                      className="flex w-full items-start gap-3 border-b border-white/[0.05] px-4 py-3 text-left transition hover:bg-white/[0.04]"
                    >
                      <ChatAvatar
                        name={item.counterpart}
                        url={item.imageUrl}
                        kind={item.counterpartKind ?? (item.kind === "support" ? "platform" : "client")}
                        size={36}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-[13px] ${item.unread > 0 ? "font-semibold text-stone-50" : "text-stone-300"}`}>
                            {item.counterpart}
                          </span>
                          {item.unread > 0 && (
                            <span className="shrink-0 rounded-full bg-[var(--lux-gold)] px-1.5 text-[10px] font-bold leading-[16px] text-[#1a0503]">
                              {item.unread > 9 ? "9+" : item.unread}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[11.5px] text-stone-500">{item.title}</span>
                        {item.preview && <span className="mt-0.5 block truncate text-[12px] text-stone-400">{item.preview}</span>}
                        <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-stone-500">{formatDateTime(item.at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-white/[0.08] px-4 py-3 text-center">
            <Link
              href={data.href}
              onClick={() => setOpen(false)}
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lux-gold-light)] hover:underline"
            >
              {t("msgIcon.seeAll")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
