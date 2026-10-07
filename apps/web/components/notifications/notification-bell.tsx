"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { resolveSession, isAuthError } from "@/lib/session";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import {
  deleteNotifications,
  fetchNotifications,
  hideNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTypeLabel,
  type NotificationItem,
  type NotificationSelection,
} from "@/lib/notifications";
import { useT } from "@/lib/i18n";
import { useAccount } from "@/lib/account";

// ---------------------------------------------------------------------------
// Cloche de notifications (en-tête du site).
// • visible uniquement si une session existe (/auth/me puis /auth/admin/me) ;
// • sondage toutes les 30 s, mis en pause quand l’onglet est masqué ;
// • panneau : 5 dernières, « Tout marquer comme lu », « Voir toutes » ;
// • « Sélectionner » : cocher, ou « Toutes (N) », puis Masquer (membres,
//   équipe) ou Supprimer définitivement (administrateur, après confirmation) ;
// • accessibilité : aria-label / aria-expanded, fermeture Échap + clic extérieur.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30000;

// Mémoire d'une page à l'autre : l'en-tête est recréé à chaque navigation. Sans
// elle, la cloche disparaissait le temps de revérifier la session, puis revenait
// avec un compteur reparti de zéro.
const memory: {
  state: "checking" | "hidden" | "visible";
  kind: "member" | "admin" | null;
  role: string | null;
  items: NotificationItem[];
  unread: number;
  total: number;
} = { state: "checking", kind: null, role: null, items: [], unread: 0, total: 0 };

export function NotificationBell() {
  const t = useT();
  const router = useRouter();
  const account = useAccount();
  const [state, setState] = useState(memory.state);
  const [items, setItems] = useState<NotificationItem[]>(memory.items);
  const [unread, setUnread] = useState(memory.unread);
  const [total, setTotal] = useState(memory.total);

  useEffect(() => {
    memory.state = state;
    memory.items = items;
    memory.unread = unread;
    memory.total = total;
  }, [state, items, unread, total]);

  // Sélection (masquer / supprimer) dans le menu.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allAcross, setAllAcross] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const isAdmin = memory.role === "ADMIN";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await fetchNotifications({ page: 1, perPage: 5 });
      setItems(page.items);
      setTotal(Number(page.meta.total ?? page.items.length));
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

  // Session : déjà connue (page précédente) → simple rafraîchissement ; sinon une
  // seule résolution, aucune boucle de reconnexion.
  useEffect(() => {
    if (memory.state === "visible") {
      void load();
      return;
    }
    let active = true;
    void resolveSession().then((session) => {
      if (!active) return;
      memory.kind = session?.kind ?? null;
      memory.role = session?.user.role ?? null;
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

  // Déconnexion d'un membre : la cloche part tout de suite (sans attendre l'erreur du serveur).
  useEffect(() => {
    if (account.status === "guest" && memory.kind === "member" && state === "visible") {
      memory.kind = null;
      setItems([]);
      setUnread(0);
      setState("hidden");
    }
  }, [account.status, state]);

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

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setAllAcross(false);
    setConfirmDelete(false);
  }

  function toggleItem(id: string) {
    setAllAcross(false);
    setConfirmDelete(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applySelection(kind: "hide" | "delete") {
    if (busy) return;
    const selection: NotificationSelection = allAcross ? { all: true, unreadOnly: false } : { ids: [...selected] };
    setBusy(true);
    setError(null);
    try {
      const count = kind === "delete" ? (await deleteNotifications(selection)).deleted : (await hideNotifications(selection)).hidden;
      stopSelecting();
      setDone(t(kind === "delete" ? "notif.deletedDone" : "notif.hiddenDone", { count: count.toLocaleString(t.intl) }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openItem(item: NotificationItem) {
    if (selecting) {
      toggleItem(item.id);
      return;
    }
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
        onClick={() => {
          setOpen((value) => !value);
          stopSelecting();
          setDone(null);
        }}
        className="relative grid h-9 w-9 place-items-center rounded-xl border sm:h-10 sm:w-10 border-[rgba(255,255,255,0.1)] bg-white/[0.03] text-stone-300 transition-colors hover:border-[rgba(232,71,36,0.45)] hover:text-[var(--lux-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lux-gold)]/60"
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
          className="fixed inset-x-3 top-[68px] z-[70] overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[360px] rounded-[18px] border border-white/10 bg-[#050303]/97 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <p className="lux-kicker">{t("bell.title")}</p>
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={busy || unread === 0 || selecting}
              className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lux-gold-light)] transition hover:opacity-80 disabled:opacity-40"
            >
              Tout marquer comme lu
            </button>
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {error && <p className="px-4 py-4 text-xs leading-relaxed text-[#fca5a5]">{error}</p>}
            {done && !selecting && <p className="border-b border-white/[0.05] px-4 py-2.5 text-[12px] text-[#6ee7b7]">{done}</p>}
            {!error && items.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-stone-400">
                {t("bell.empty")}
              </p>
            )}
            <ul>
              {items.map((item) => {
                const checked = allAcross || selected.has(item.id);
                return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(item)}
                    aria-pressed={selecting ? checked : undefined}
                    className={`flex w-full gap-3 border-b border-white/[0.05] px-4 py-3 text-left transition ${
                      selecting && checked ? "bg-[rgba(232,71,36,0.08)]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    {selecting && <BellCheck checked={checked} />}
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
                );
              })}
            </ul>
          </div>

          {selecting ? (
            <div className="border-t border-white/[0.08] px-4 py-3">
              {confirmDelete ? (
                <div className="space-y-2.5">
                  <p className="text-[12px] leading-snug text-[#fca5a5]">
                    {t("notif.deleteConfirm", { count: (allAcross ? total : selected.size).toLocaleString(t.intl) })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="rounded-full px-3 py-1.5 text-[12px] text-stone-300 hover:text-white">
                      {t("notif.cancelSelect")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void applySelection("delete")}
                      disabled={busy}
                      className="rounded-full bg-[#b91c1c] px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#dc2626] disabled:opacity-60"
                    >
                      {t("bell.confirmYes")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAllAcross((value) => !value);
                      setSelected(new Set());
                    }}
                    className="flex items-center gap-2 text-[12px] font-medium text-stone-100"
                  >
                    <BellCheck checked={allAcross} />
                    {t("bell.allCount", { total: total.toLocaleString(t.intl) })}
                  </button>
                  <span className="flex items-center gap-1.5">
                    <button type="button" onClick={stopSelecting} disabled={busy} className="rounded-full px-2.5 py-1.5 text-[12px] text-stone-300 hover:text-white">
                      {t("notif.cancelSelect")}
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        disabled={busy || (!allAcross && selected.size === 0)}
                        className="rounded-full border border-[rgba(239,68,68,0.45)] px-3 py-1.5 text-[12px] font-semibold text-[#fca5a5] transition hover:bg-[rgba(239,68,68,0.12)] disabled:opacity-40"
                      >
                        {t("notif.delete")}
                        {!allAcross && selected.size > 0 ? ` (${selected.size})` : ""}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void applySelection("hide")}
                        disabled={busy || (!allAcross && selected.size === 0)}
                        className="rounded-full bg-[linear-gradient(120deg,#ff8a5c,#e84724)] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                      >
                        {t("notif.hide")}
                        {!allAcross && selected.size > 0 ? ` (${selected.size})` : ""}
                      </button>
                    )}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelecting(true);
                    setDone(null);
                  }}
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-300 transition hover:text-white"
                >
                  {t("notif.select")}
                </button>
              ) : (
                <span />
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lux-gold-light)] hover:underline"
              >
                {t("bell.seeAll")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BellCheck({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition ${
        checked ? "border-[#ff8a5c] bg-[linear-gradient(135deg,#ff8a5c,#e84724)] text-white" : "border-white/25 bg-black/30"
      }`}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      )}
    </span>
  );
}
