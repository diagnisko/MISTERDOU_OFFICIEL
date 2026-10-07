"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, ListPager, Spinner } from "@/components/ui";
import { LuxPageHead, LuxShell, LuxTopBar } from "@/components/lux/lux-shell";
import { LuxFooter } from "@/components/lux/lux-footer";
import { errorMessage, isPermissionError, type PageMeta } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { resolveSession, isAuthError, type SessionUser } from "@/lib/session";
import {
  deleteNotifications,
  fetchNotificationPreferences,
  fetchNotifications,
  hideNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTypeLabel,
  saveNotificationPreferences,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationSelection,
} from "@/lib/notifications";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Centre de notifications — GET /notifications (filtre unreadOnly, pagination),
// POST /notifications/:id/read, POST /notifications/read-all,
// GET|PATCH /notifications/preferences. Session obligée → /login.
// Mode « Sélectionner » : cocher une à une ou tout (toutes les pages), puis
// Masquer (membres, équipe) ou Supprimer définitivement (administrateur).
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

type Tab = "all" | "unread";

export default function NotificationsPage() {
  const t = useT();
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);

  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [meta, setMeta] = useState<PageMeta & { unread?: number }>({
    page: 1,
    perPage: PER_PAGE,
    total: 0,
    unread: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Sélection : ids cochés de la page, ou « toutes » (toutes les pages de l'onglet).
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allAcross, setAllAcross] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acting, setActing] = useState(false);

  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState<unknown>(null);
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);

  // Garde de session : aucune session → /login (une seule tentative).
  useEffect(() => {
    let active = true;
    void resolveSession().then((resolved) => {
      if (!active) return;
      if (!resolved) {
        router.replace("/login");
        return;
      }
      setSession(resolved.user);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  // Liste paginée.
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setSelected(new Set());
    setAllAcross(false);
    setConfirmDelete(false);
    fetchNotifications({ page, perPage: PER_PAGE, unreadOnly: tab === "unread" })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setMeta(result.meta);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        if (isAuthError(err)) {
          router.replace("/login");
          return;
        }
        setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, tab, page, router]);

  const reload = useCallback((keepNotice = false) => {
    if (!keepNotice) setNotice(null);
    setLoading(true);
    setSelected(new Set());
    setAllAcross(false);
    fetchNotifications({ page, perPage: PER_PAGE, unreadOnly: tab === "unread" })
      .then((result) => {
        setItems(result.items);
        setMeta(result.meta);
        setError(null);
      })
      .catch((err) => {
        if (isAuthError(err)) {
          router.replace("/login");
          return;
        }
        setError(err);
      })
      .finally(() => setLoading(false));
  }, [page, tab, router]);

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

  function togglePage() {
    setAllAcross(false);
    setConfirmDelete(false);
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((item) => item.id))));
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setAllAcross(false);
    setConfirmDelete(false);
  }

  async function applySelection(kind: "hide" | "delete") {
    const selection: NotificationSelection = allAcross ? { all: true, unreadOnly: tab === "unread" } : { ids: [...selected] };
    setActing(true);
    setError(null);
    try {
      const count =
        kind === "delete" ? (await deleteNotifications(selection)).deleted : (await hideNotifications(selection)).hidden;
      stopSelecting();
      setNotice(t(kind === "delete" ? "notif.deletedDone" : "notif.hiddenDone", { count: count.toLocaleString(t.intl) }));
      if (page !== 1) setPage(1);
      else reload(true);
    } catch (err) {
      setError(err);
    } finally {
      setActing(false);
    }
  }

  async function openItem(item: NotificationItem) {
    if (selecting) {
      toggleItem(item.id);
      return;
    }
    if (busyId) return;
    if (!item.readAt) {
      setBusyId(item.id);
      try {
        await markNotificationRead(item.id);
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row,
          ),
        );
        setMeta((prev) => ({ ...prev, unread: Math.max(0, (prev.unread ?? 1) - 1) }));
      } catch (err) {
        setError(err);
      } finally {
        setBusyId(null);
      }
    }
    const raw = (item.actionUrl ?? "").trim();
    if (raw.startsWith("/")) router.push(raw);
  }

  async function markAll() {
    if (markingAll) return;
    setMarkingAll(true);
    setNotice(null);
    setError(null);
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setItems((prev) => prev.map((row) => ({ ...row, readAt: row.readAt ?? now })));
      setMeta((prev) => ({ ...prev, unread: 0 }));
      setNotice(t("notif.allRead"));
    } catch (err) {
      setError(err);
    } finally {
      setMarkingAll(false);
    }
  }

  async function togglePrefs() {
    const next = !prefsOpen;
    setPrefsOpen(next);
    if (!next || prefs) return;
    setPrefsLoading(true);
    setPrefsError(null);
    try {
      setPrefs(await fetchNotificationPreferences());
    } catch (err) {
      setPrefsError(err);
    } finally {
      setPrefsLoading(false);
    }
  }

  async function savePrefs(next: NotificationPreferences) {
    setPrefsSaving(true);
    setPrefsError(null);
    setPrefsNotice(null);
    try {
      const saved = await saveNotificationPreferences({
        inApp: next.inApp,
        push: next.push,
        email: next.email,
        sms: next.sms,
      });
      setPrefs(saved);
      setPrefsNotice(t("notif.prefsSaved"));
    } catch (err) {
      setPrefsError(err);
    } finally {
      setPrefsSaving(false);
    }
  }

  if (checking) {
    return (
      <LuxShell>
        <div className="relative z-10 grid min-h-[70vh] place-items-center text-sm text-stone-400">
          <span className="flex items-center gap-3">
            <Spinner /> {t("notif.loading")}
          </span>
        </div>
      </LuxShell>
    );
  }

  const unread = Number(meta.unread ?? 0);
  // L'administrateur supprime ; l'équipe et les membres masquent.
  const isAdmin = session?.role === "ADMIN";

  return (
    <LuxShell>
      <div className="relative z-10">
        <LuxTopBar
          label={t("notif.memberArea")}
          links={[
            { href: "/account", label: t("notif.myAccount") },
            { href: "/messages", label: t("notif.messaging") },
            { href: "/offres", label: t("notif.catalogue") },
          ]}
        />

        <main className="mx-auto max-w-4xl px-5 py-10 md:px-8">
          <LuxPageHead
            kicker={t("notif.kicker")}
            title={t("notif.title")}
            meta={
              unread > 0
                ? t(unread > 1 ? "notif.unreadMany" : "notif.unreadOne", { unread: unread.toLocaleString(t.intl), total: meta.total.toLocaleString(t.intl) })
                : t(meta.total > 1 ? "notif.countMany" : "notif.countOne", { total: meta.total.toLocaleString(t.intl) })
            }
            action={
              <>
                {unread > 0 && !selecting && (
                  <Button variant="outline" loading={markingAll} onClick={() => void markAll()}>
                    {t("notif.markAll")}
                  </Button>
                )}
                {items.length > 0 && !selecting && (
                  <Button variant="outline" onClick={() => setSelecting(true)}>
                    {t("notif.select")}
                  </Button>
                )}
                {/* Actions secondaires en icônes : une seule ligne, même sur téléphone. */}
                <button
                  type="button"
                  onClick={() => reload()}
                  disabled={loading}
                  aria-label={t("notif.refresh")}
                  title={t("notif.refresh")}
                  className="grid h-[42px] w-[42px] place-items-center rounded-full border border-white/10 text-stone-300 transition-colors hover:border-[rgba(255,106,50,0.5)] hover:text-white disabled:opacity-50"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={loading ? "animate-spin" : undefined}>
                    <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void togglePrefs()}
                  aria-expanded={prefsOpen}
                  aria-label={t("notif.prefs")}
                  title={t("notif.prefs")}
                  className={`grid h-[42px] w-[42px] place-items-center rounded-full border text-stone-300 transition-colors hover:border-[rgba(255,106,50,0.5)] hover:text-white ${prefsOpen ? "border-[rgba(255,106,50,0.6)] text-white" : "border-white/10"}`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
                  </svg>
                </button>
              </>
            }
          />

          {error !== null && (
            <div className="mt-5">
              <Alert tone={isPermissionError(error) ? "warning" : "danger"}>
                {errorMessage(error)}
              </Alert>
            </div>
          )}
          {notice && (
            <div className="mt-5">
              <Alert tone="success">{notice}</Alert>
            </div>
          )}

          {prefsOpen && (
            <PreferencesPanel
              loading={prefsLoading}
              prefs={prefs}
              error={prefsError}
              notice={prefsNotice}
              saving={prefsSaving}
              onSave={savePrefs}
            />
          )}

          <div className="mt-7" role="tablist" aria-label={t("notif.filter")}>
            <div className="flex flex-wrap gap-1.5">
              {([
                { value: "all", label: t("notif.all") },
                { value: "unread", label: t("notif.unread") },
              ] as const).map((option) => {
                const active = option.value === tab;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setTab(option.value);
                      setPage(1);
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                      active
                        ? "border-amber-200/15 bg-amber-300/[0.09] text-[var(--lux-gold-light)]"
                        : "border-white/10 text-stone-400 hover:bg-white/[0.06] hover:text-stone-100"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {selecting && items.length > 0 && (
            <SelectionBar
              isAdmin={isAdmin}
              count={allAcross ? meta.total : selected.size}
              pageCount={items.length}
              total={meta.total}
              pageAllSelected={selected.size === items.length}
              allAcross={allAcross}
              confirmDelete={confirmDelete}
              acting={acting}
              onTogglePage={togglePage}
              onSelectAcross={() => setAllAcross(true)}
              onHide={() => void applySelection("hide")}
              onAskDelete={() => setConfirmDelete(true)}
              onDelete={() => void applySelection("delete")}
              onCancelDelete={() => setConfirmDelete(false)}
              onCancel={stopSelecting}
            />
          )}

          <div className="mt-4 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#101825]/80">
            {loading ? (
              <p className="flex items-center gap-3 p-6 text-sm text-stone-400">
                <Spinner /> {t("notif.loadingList")}
              </p>
            ) : error !== null && items.length === 0 ? (
              <p className="p-6 text-sm text-stone-400">{errorMessage(error)}</p>
            ) : items.length === 0 ? (
              <p className="p-6 text-sm text-stone-400">
                {tab === "unread"
                  ? t("notif.noneUnread")
                  : t("notif.none")}
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {items.map((item) => {
                  const checked = allAcross || selected.has(item.id);
                  return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      disabled={busyId === item.id}
                      aria-pressed={selecting ? checked : undefined}
                      aria-label={selecting ? `${t("notif.selectItem")} : ${item.title}` : undefined}
                      className={`flex w-full gap-3 px-4 py-4 text-left transition disabled:opacity-60 ${
                        selecting && checked ? "bg-[rgba(232,71,36,0.08)]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      {selecting && <CheckMark checked={checked} />}
                      <span className="mt-1.5 shrink-0" aria-hidden>
                        {item.priority === "CRITICAL" ? (
                          <span className="block h-2 w-2 rounded-full bg-[var(--lux-gold)] shadow-[0_0_0_3px_rgba(232,71,36,0.18)]" />
                        ) : (
                          <span className="block h-2 w-2 rounded-full bg-white/25" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge cls="border-white/15 bg-white/5 text-stone-300">
                            {notificationTypeLabel(item.type)}
                          </Badge>
                          {!item.readAt && (
                            <Badge cls="border-[rgba(232,71,36,0.4)] bg-[rgba(232,71,36,0.1)] text-[var(--lux-gold-light)]">
                              Non lue
                            </Badge>
                          )}
                          <span className="ml-auto text-[11px] tabular-nums text-stone-500">
                            {formatDate(item.createdAt)}
                          </span>
                        </span>
                        <span
                          className={`mt-2 block text-[15px] ${
                            item.readAt ? "text-stone-300" : "font-semibold text-stone-50"
                          }`}
                        >
                          {item.title}
                        </span>
                        <span className="mt-1 block text-sm leading-relaxed text-stone-400">
                          {item.message}
                        </span>
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>

          <ListPager
            meta={meta}
            hidden={loading || items.length === 0}
            onPage={(next) => {
              setPage(next);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </main>

        <div className="relative z-10 mt-16">
          <LuxFooter />
        </div>
      </div>
    </LuxShell>
  );
}

// ---------------------------------------------------------------------------

function PreferencesPanel({
  loading,
  prefs,
  error,
  notice,
  saving,
  onSave,
}: {
  loading: boolean;
  prefs: NotificationPreferences | null;
  error: unknown;
  notice: string | null;
  saving: boolean;
  onSave: (prefs: NotificationPreferences) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<NotificationPreferences | null>(prefs);

  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  const value = draft ?? prefs;
  const errorText = error ? errorMessage(error) : null;

  return (
    <section
      aria-label={t("notif.prefsLabel")}
      className="lux-glass mt-6 rounded-[24px] p-6"
    >
      <p className="lux-kicker">{t("notif.prefs")}</p>
      <h2 className="lux-serif mt-2 text-[22px] font-semibold text-stone-50">
        {t("notif.channels")}
      </h2>

      {loading && !value && (
        <p className="mt-4 flex items-center gap-3 text-sm text-stone-400">
          <Spinner /> {t("notif.prefsLoading")}
        </p>
      )}

      {errorText && (
        <div className="mt-4">
          <Alert tone="danger">{errorText}</Alert>
        </div>
      )}

      {notice && !errorText && (
        <div className="mt-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {value && (
        <>
          <div className="mt-5 space-y-3">
            <p className="text-xs leading-relaxed text-stone-400">
              {t("notif.critical")}
            </p>
            <Toggle
              label={t("notif.inApp")}
              hint={t("notif.inAppHint")}
              checked={Boolean(value.inApp)}
              disabled={saving}
              onChange={(checked) => setDraft({ ...value, inApp: checked })}
            />
            <Toggle
              label={t("notif.email")}
              hint={t("notif.emailHint")}
              checked={Boolean(value.email)}
              disabled={saving}
              onChange={(checked) => setDraft({ ...value, email: checked })}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {value.isDefault && (
              <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">
                {t("notif.defaults")}
              </span>
            )}
            <Button loading={saving} onClick={() => draft && void onSave(draft)}>
              {t("notif.save")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-4 rounded-[14px] border border-white/10 bg-black/10 px-4 py-3 transition ${
        disabled ? "opacity-60" : "hover:bg-white/[0.04]"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-stone-200">{label}</span>
        <span className="mt-0.5 block text-xs text-stone-400">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--lux-gold)]"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Barre du mode sélection : tout cocher, compteur, Masquer / Supprimer.
// ---------------------------------------------------------------------------

function SelectionBar(props: {
  isAdmin: boolean;
  count: number;
  pageCount: number;
  total: number;
  pageAllSelected: boolean;
  allAcross: boolean;
  confirmDelete: boolean;
  acting: boolean;
  onTogglePage: () => void;
  onSelectAcross: () => void;
  onHide: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const none = props.count === 0;
  const countText = t(props.count > 1 ? "notif.selectedMany" : "notif.selectedOne", { count: props.count.toLocaleString(t.intl) });
  return (
    <div className="mt-4 rounded-[18px] border border-[rgba(255,138,92,0.3)] bg-[rgba(232,71,36,0.06)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={props.onTogglePage} className="flex items-center gap-2.5 text-[13px] font-medium text-stone-100">
          <CheckMark checked={props.allAcross || props.pageAllSelected} />
          {t("notif.selectAll")}
        </button>
        <span className="text-[12.5px] tabular-nums text-stone-300">{countText}</span>
        <span className="flex flex-wrap items-center gap-2">
          {props.confirmDelete ? (
            <>
              <span className="text-[12.5px] text-[#fca5a5]">{t("notif.deleteConfirm", { count: props.count.toLocaleString(t.intl) })}</span>
              <Button variant="ghost" onClick={props.onCancelDelete} disabled={props.acting}>
                {t("notif.cancelSelect")}
              </Button>
              <button
                type="button"
                onClick={props.onDelete}
                disabled={props.acting}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-[#b91c1c] px-4 text-[13px] font-semibold text-white transition hover:bg-[#dc2626] disabled:opacity-60"
              >
                {props.acting && <Spinner />} {t("notif.delete")}
              </button>
            </>
          ) : (
            <>
              {props.isAdmin ? (
                <button
                  type="button"
                  onClick={props.onAskDelete}
                  disabled={none || props.acting}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[rgba(239,68,68,0.45)] px-4 text-[13px] font-semibold text-[#fca5a5] transition hover:bg-[rgba(239,68,68,0.12)] disabled:opacity-40"
                >
                  {t("notif.delete")}
                </button>
              ) : (
                <Button onClick={props.onHide} disabled={none} loading={props.acting}>
                  {t("notif.hide")}
                </Button>
              )}
              <Button variant="ghost" onClick={props.onCancel} disabled={props.acting}>
                {t("notif.cancelSelect")}
              </Button>
            </>
          )}
        </span>
      </div>
      {props.pageAllSelected && props.total > props.pageCount && (
        <p className="mt-2 text-[12.5px] text-stone-300">
          {props.allAcross ? (
            t("notif.allAcross", { total: props.total.toLocaleString(t.intl) })
          ) : (
            <>
              {t("notif.pageSelected", { count: props.pageCount.toLocaleString(t.intl) })}{" "}
              <button type="button" onClick={props.onSelectAcross} className="font-semibold text-[var(--lux-gold-light)] hover:underline">
                {t("notif.selectAcross", { total: props.total.toLocaleString(t.intl) })}
              </button>
            </>
          )}
        </p>
      )}
      {!props.isAdmin && <p className="mt-1.5 text-[11.5px] text-stone-500">{t("notif.hideHint")}</p>}
    </div>
  );
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${
        checked ? "border-[#ff8a5c] bg-[linear-gradient(135deg,#ff8a5c,#e84724)] text-white" : "border-white/25 bg-black/20"
      }`}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      )}
    </span>
  );
}
