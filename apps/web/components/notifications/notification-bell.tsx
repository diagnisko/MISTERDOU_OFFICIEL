"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { resolveSession, isAuthError } from "@/lib/session";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTypeLabel,
  type NotificationItem,
} from "@/lib/notifications";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Cloche de notifications (en-tête du site).
// • visible uniquement si une session existe (/auth/me puis /auth/admin/me) ;
// • sondage toutes les 30 s, mis en pause quand l’onglet est masqué ;
// • panneau : 5 dernières, « Tout marquer comme lu », « Voir toutes » ;
// • accessibilité : aria-label / aria-expanded, fermeture Échap + clic extérieur.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30000;

export function NotificationBell() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "hidden" | "visible">("checking");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await fetchNotifications({ page: 1, perPage: 5 });
      setItems(page.items);
      const unreadMeta = Number(page.meta.unread ?? 0);
      setUnread(
        Number.isFinite(unreadMeta) && unreadMeta >= 0
          ? unreadMeta
          : page.items.filter((item) => !item.readAt).length,
      );
      setError(null);
    } catch (err) {
      setItems([]);
      setUnread(0);
      // Session expirée : la cloche disparaît (plus de session à sontrer).
      if (isAuthError(err)) {
        setState("hidden");
        return;
      }
      setError(errorMessage(err, "Notifications indisponibles."));
    }
  }, []);

  // Session : une seule résolution, aucune boucle de reconnexion.
  useEffect(() => {
    let active = true;
    void resolveSession().then((session) => {
      if (!active) return;
      if (!session) {
        setState("hidden");
        return;
      }
      setState("visible");
      void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  // Sondage 30 s : mise en pause hors premier plan, rafraîchi au retour.
  useVisiblePoll(load, POLL_INTERVAL_MS, { enabled: state === "visible" });

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

  async function markAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await markAllNotificationsRead();
      setItems((prev) =>
        prev.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      );
      setUnread(0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openItem(item: NotificationItem) {
    if (busy) return;
    setBusy(true);
    const wasUnread = !item.readAt;
    if (wasUnread) {
      try {
        await markNotificationRead(item.id);
      } catch {
        /* on navigue malgré l’échec du marquage */
      }
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row,
        ),
      );
      setUnread((count) => Math.max(0, count - 1));
    }
    setBusy(false);
    setOpen(false);
    const raw = (item.actionUrl ?? "").trim();
    router.push(raw.startsWith("/") ? raw : "/notifications");
  }

  if (state !== "visible") return null;

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread > 0 ? `Notifications — ${unread} non lues` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lux-gold)]/60"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-1 text-[10px] font-bold leading-[18px] text-[#1a0503]">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("bell.recent")}
          className="absolute right-0 z-[70] mt-2 w-[min(92vw,360px)] overflow-hidden rounded-[18px] border border-white/10 bg-[#050303]/97 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <p className="lux-kicker">{t("bell.title")}</p>
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={busy || unread === 0}
              className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lux-gold-light)] transition hover:opacity-80 disabled:opacity-40"
            >
              Tout marquer comme lu
            </button>
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {error && <p className="px-4 py-4 text-xs leading-relaxed text-[#fca5a5]">{error}</p>}
            {!error && items.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-stone-400">
                {t("bell.empty")}
              </p>
            )}
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(item)}
                    className="flex w-full gap-3 border-b border-white/[0.05] px-4 py-3 text-left transition hover:bg-white/[0.04]"
                  >
                    <span className="mt-1.5 shrink-0" aria-hidden>
                      {item.priority === "CRITICAL" ? (
                        <span className="block h-2 w-2 rounded-full bg-[var(--lux-gold)] shadow-[0_0_0_3px_rgba(232,71,36,0.18)]" />
                      ) : (
                        <span className="block h-2 w-2 rounded-full bg-white/25" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[13px] ${
                          item.readAt ? "text-stone-300" : "font-semibold text-stone-50"
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-stone-400">
                        {item.message}
                      </span>
                      <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-stone-500">
                        {notificationTypeLabel(item.type)} · {formatDateTime(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-white/[0.08] px-4 py-3 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lux-gold-light)] hover:underline"
            >
              {t("bell.seeAll")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
