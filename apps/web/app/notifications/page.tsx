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
  fetchNotificationPreferences,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTypeLabel,
  saveNotificationPreferences,
  type NotificationItem,
  type NotificationPreferences,
} from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Centre de notifications — GET /notifications (filtre unreadOnly, pagination),
// POST /notifications/:id/read, POST /notifications/read-all,
// GET|PATCH /notifications/preferences. Session obligée → /login.
// ---------------------------------------------------------------------------

const PER_PAGE = 20;

type Tab = "all" | "unread";

export default function NotificationsPage() {
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

  const reload = useCallback(() => {
    setNotice(null);
    setLoading(true);
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

  async function openItem(item: NotificationItem) {
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
      setNotice("Toutes les notifications sont marquées comme lues.");
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
      setPrefsNotice("Préférences enregistrées.");
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
            <Spinner /> Chargement de vos notifications…
          </span>
        </div>
      </LuxShell>
    );
  }

  const unread = Number(meta.unread ?? 0);

  return (
    <LuxShell>
      <div className="relative z-10">
        <LuxTopBar
          label="Espace membre"
          links={[
            { href: "/account", label: "Mon espace" },
            { href: "/messages", label: "Messagerie" },
            { href: "/catalogue", label: "Catalogue" },
          ]}
        />

        <main className="mx-auto max-w-4xl px-5 py-10 md:px-8">
          <LuxPageHead
            kicker="Centre de notifications"
            title="Notifications"
            meta={
              unread > 0
                ? `${unread.toLocaleString("fr-FR")} non lue${unread > 1 ? "s" : ""} sur ${meta.total.toLocaleString("fr-FR")}`
                : `${meta.total.toLocaleString("fr-FR")} notification${meta.total > 1 ? "s" : ""}`
            }
            action={
              <>
                <Button variant="outline" loading={loading} onClick={reload}>
                  Actualiser
                </Button>
                <Button
                  variant="outline"
                  loading={markingAll}
                  disabled={unread === 0}
                  onClick={() => void markAll()}
                >
                  Tout marquer comme lu
                </Button>
                <Button variant="ghost" onClick={() => void togglePrefs()} aria-expanded={prefsOpen}>
                  Préférences
                </Button>
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

          <div className="mt-7" role="tablist" aria-label="Filtrer les notifications">
            <div className="flex flex-wrap gap-1.5">
              {([
                { value: "all", label: "Toutes" },
                { value: "unread", label: "Non lues" },
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

          <div className="mt-4 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#101825]/80">
            {loading ? (
              <p className="flex items-center gap-3 p-6 text-sm text-stone-400">
                <Spinner /> Chargement des notifications…
              </p>
            ) : error !== null && items.length === 0 ? (
              <p className="p-6 text-sm text-stone-400">{errorMessage(error)}</p>
            ) : items.length === 0 ? (
              <p className="p-6 text-sm text-stone-400">
                {tab === "unread"
                  ? "Aucune notification non lue — vous êtes à jour."
                  : "Aucune notification pour le moment."}
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      disabled={busyId === item.id}
                      className="flex w-full gap-3 px-4 py-4 text-left transition hover:bg-white/[0.03] disabled:opacity-60"
                    >
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
                ))}
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
  const [draft, setDraft] = useState<NotificationPreferences | null>(prefs);

  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  const value = draft ?? prefs;
  const errorText = error ? errorMessage(error) : null;

  return (
    <section
      aria-label="Préférences de notifications"
      className="lux-glass mt-6 rounded-[24px] p-6"
    >
      <p className="lux-kicker">Préférences</p>
      <h2 className="lux-serif mt-2 text-[22px] font-semibold text-stone-50">
        Canaux de notification
      </h2>

      {loading && !value && (
        <p className="mt-4 flex items-center gap-3 text-sm text-stone-400">
          <Spinner /> Chargement des préférences…
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
              Les notifications critiques restent toujours affichées même si le centre est
              désactivé.
            </p>
            <Toggle
              label="En application"
              hint="Afficher les notifications dans le centre et la cloche du site."
              checked={Boolean(value.inApp)}
              disabled={saving}
              onChange={(checked) => setDraft({ ...value, inApp: checked })}
            />
            <Toggle
              label="Push"
              hint="Notifications push (architecture prête)."
              checked={Boolean(value.push)}
              disabled={saving}
              onChange={(checked) => setDraft({ ...value, push: checked })}
            />
            <Toggle
              label="E-mail"
              hint="Événements importants envoyés par e-mail."
              checked={Boolean(value.email)}
              disabled={saving}
              onChange={(checked) => setDraft({ ...value, email: checked })}
            />
            <Toggle
              label="SMS"
              hint="Alertes par SMS pour les opérations sensibles."
              checked={Boolean(value.sms)}
              disabled={saving}
              onChange={(checked) => setDraft({ ...value, sms: checked })}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {value.isDefault && (
              <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">
                Valeurs par défaut du compte
              </span>
            )}
            <Button loading={saving} onClick={() => draft && void onSave(draft)}>
              Enregistrer
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
