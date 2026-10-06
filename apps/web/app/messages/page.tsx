"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Spinner } from "@/components/ui";
import { LuxPageHead, LuxShell, LuxTopBar } from "@/components/lux/lux-shell";
import { LuxFooter } from "@/components/lux/lux-footer";
import { errorMessage, isPermissionError, type PageMeta } from "@/lib/api";
import { resolveSession, isAuthError, type SessionUser } from "@/lib/session";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { ConversationThread } from "@/components/messagerie/thread";
import { ChatAvatar } from "@/components/chat/product-chat";
import {
  createConversation,
  fetchConversation,
  fetchConversations,
} from "@/components/messagerie/api";
import {
  excerpt,
  kindLabel,
  peerOf,
  personName,
  roleLabel,
  unreadCount,
  type ConversationSummary,
} from "@/components/messagerie/types";
import { useT } from "@/lib/i18n";
import { documentIntl } from "@/lib/i18n-core";

// ---------------------------------------------------------------------------
// Messagerie membre (§44) — liste des conversations à gauche, fil à droite.
// GET /conversations (sondage 15 s des compteurs), GET /conversations/:id
// (détail si l’interlocuteur n’est pas dans la première page),
// POST /conversations { kind: CLIENT_TO_ADMIN } pour contacter le support.
// Deep link : /messages?c=<conversationId>.
// ---------------------------------------------------------------------------

const PER_PAGE = 20;
const LIST_POLL_MS = 15000;

export default function MessagesPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <LuxShell>
          <div className="relative z-10 grid min-h-[70vh] place-items-center text-sm text-stone-400">
            <span className="flex items-center gap-3">
              <Spinner /> {t("msg.opening")}
            </span>
          </div>
        </LuxShell>
      }
    >
      <MessagesInner />
    </Suspense>
  );
}

function MessagesInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("c");

  const [session, setSession] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);

  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, perPage: PER_PAGE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ConversationSummary | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);

  const activeRow = useMemo(
    () => rows.find((row) => row.id === activeId) ?? null,
    [rows, activeId],
  );
  const inList = Boolean(activeId && rows.some((row) => row.id === activeId));

  // Garde de session.
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

  const refreshList = useCallback(async () => {
    try {
      const page = await fetchConversations({ page: 1, perPage: PER_PAGE });
      setRows(page.items);
      setMeta(page.meta);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  // Première mise à jour de la liste : l’état « chargement » ne retombe qu’une
  // fois, au premier passage réussi du sondage.
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (!session) return;
    firstRunRef.current = true;
    setLoading(true);
  }, [session]);

  // Liste + compteurs non lus (sondage 15 s, pause hors premier plan).
  useVisiblePoll(
    async () => {
      try {
        const page = await fetchConversations({ page: 1, perPage: PER_PAGE });
        setRows(page.items);
        setMeta(page.meta);
        setError(null);
      } catch (err) {
        if (isAuthError(err)) {
          router.replace("/login");
          return false;
        }
        setError(err);
      } finally {
        if (firstRunRef.current) {
          firstRunRef.current = false;
          setLoading(false);
        }
      }
      return undefined;
    },
    LIST_POLL_MS,
    { enabled: Boolean(session), immediate: true },
  );

  // Conversation profonde (?c=) absente de la première page → détail dédié.
  useEffect(() => {
    if (!session || !activeId || inList) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailError(null);
    fetchConversation(activeId)
      .then((conversation) => {
        if (active) setDetail(conversation);
      })
      .catch((err) => {
        if (active) setDetailError(err);
      });
    return () => {
      active = false;
    };
  }, [session, activeId, inList]);

  function select(id: string | null) {
    router.replace(id ? `/messages?c=${id}` : "/messages", { scroll: false });
  }

  async function startConversation() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const conversation = await createConversation("CLIENT_TO_ADMIN");
      await refreshList();
      select(conversation.id);
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  if (checking) {
    return (
      <LuxShell>
        <div className="relative z-10 grid min-h-[70vh] place-items-center text-sm text-stone-400">
          <span className="flex items-center gap-3">
            <Spinner /> {t("msg.opening")}
          </span>
        </div>
      </LuxShell>
    );
  }

  const conversation = activeRow ?? detail;
  const peer = conversation ? peerOf(conversation, session?.id) : null;
  const peerName = personName(peer) || t("msg.support");

  return (
    <LuxShell>
      <div className="relative z-10">
        <LuxTopBar
          label={t("notif.memberArea")}
          links={[
            { href: "/account", label: t("notif.myAccount") },
            { href: "/notifications", label: t("notif.title") },
            { href: "/offres", label: t("notif.catalogue") },
          ]}
        />

        <main className="mx-auto max-w-6xl px-5 py-8 md:px-8">
          <LuxPageHead
            kicker={t("notif.memberArea")}
            title={t("msg.title")}
            meta={t("msg.meta")}
            action={
              <Button loading={creating} onClick={() => void startConversation()}>
                {t("msg.contact")}
              </Button>
            }
          />

          {createError && (
            <div className="mt-5">
              <Alert tone="danger">{createError}</Alert>
            </div>
          )}
          {!createError && error !== null && rows.length === 0 && (
            <div className="mt-5">
              <Alert tone={isPermissionError(error) ? "warning" : "danger"}>
                {errorMessage(error)}
              </Alert>
            </div>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            {/* Liste des conversations */}
            <aside
              className={`overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#101825]/80 ${
                activeId ? "hidden lg:block" : "block"
              }`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
                <p className="lux-kicker">{t("msg.conversations")}</p>
                <span className="text-[10px] uppercase tracking-[0.14em] tabular-nums text-stone-500">
                  {meta.total.toLocaleString(t.intl)}
                </span>
              </div>

              {loading && rows.length === 0 ? (
                <p className="flex items-center gap-3 p-5 text-sm text-stone-400">
                  <Spinner /> Chargement des conversations…
                </p>
              ) : rows.length === 0 ? (
                <div className="p-5">
                  <p className="text-sm text-stone-400">{t("msg.none")}</p>
                  <Button
                    variant="outline"
                    className="mt-4 w-full"
                    loading={creating}
                    onClick={() => void startConversation()}
                  >
                {t("msg.contact")}
              </Button>
                </div>
              ) : (
                <ul className="max-h-[60vh] divide-y divide-white/[0.06] overflow-y-auto lg:max-h-[62vh]">
                  {rows.map((row) => {
                    const rowPeer = peerOf(row, session?.id);
                    const name = personName(rowPeer) || t("msg.support");
                    const count = unreadCount(row.unread);
                    const active = row.id === activeId;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => select(row.id)}
                          aria-current={active ? "true" : undefined}
                          className={`flex w-full gap-3 px-4 py-3.5 text-left transition ${
                            active ? "bg-white/[0.05]" : "hover:bg-white/[0.04]"
                          }`}
                        >
                          <ChatAvatar name={name} url={rowPeer?.avatarUrl ?? null} kind={rowPeer ? "client" : "platform"} size={40} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-stone-100">
                                {name}
                              </span>
                              <span className="shrink-0 text-[10px] tabular-nums text-stone-500">
                                {shortDate(row.lastMessage?.createdAt ?? row.updatedAt)}
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-2">
                              <Badge cls="border-white/15 bg-white/5 text-stone-400">
                                {roleLabel(rowPeer?.role) || kindLabel(row.kind)}
                              </Badge>
                              {count > 0 && (
                                <span className="ml-auto grid min-w-[18px] place-items-center rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-1.5 text-[10px] font-bold leading-[18px] text-[#1a0503]">
                                  {count > 9 ? "9+" : count}
                                </span>
                              )}
                            </span>
                            <span className="mt-1.5 block truncate text-xs text-stone-400">
                              {excerpt(row.lastMessage?.content)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            {/* Fil de discussion */}
            <div className={activeId ? "block" : "hidden lg:block"}>
              {!activeId ? (
                <div className="grid min-h-[360px] place-items-center rounded-[20px] border border-dashed border-white/10 bg-[#101825]/60 p-6 text-center">
                  <div>
                    <p className="text-sm text-stone-400">
                      {t("msg.pick")}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      loading={creating}
                      onClick={() => void startConversation()}
                    >
                {t("msg.contact")}
              </Button>
                    <p className="mt-4 text-xs text-stone-500">
                      {t("msg.orderQuestion")}{" "}
                      <Link href="/support" className="text-[var(--lux-gold-light)] hover:underline">
                        {t("msg.openRequest")}
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              ) : loading && !conversation && !detailError ? (
                <div className="grid min-h-[360px] place-items-center rounded-[20px] border border-white/[0.08] bg-[#101825]/80">
                  <span className="flex items-center gap-3 text-sm text-stone-400">
                    <Spinner /> {t("msg.loadingThread")}
                  </span>
                </div>
              ) : !conversation && detailError ? (
                <div className="rounded-[20px] border border-white/[0.08] bg-[#101825]/80 p-5">
                  <Alert tone="danger">{errorMessage(detailError)}</Alert>
                  <Button variant="outline" className="mt-4" onClick={() => select(null)}>
                    {t("msg.backToList")}
                  </Button>
                </div>
              ) : conversation ? (
                <ConversationThread
                  conversationId={conversation.id}
                  currentUserId={session?.id ?? null}
                  onSent={() => void refreshList()}
                  className="h-[70vh]"
                  header={
                    <>
                      <span className="flex min-w-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={() => select(null)}
                          aria-label={t("msg.backToListLabel")}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-stone-300 transition hover:text-stone-100 lg:hidden"
                        >
                          ←
                        </button>
                        <ChatAvatar name={peerName} url={peer?.avatarUrl ?? null} kind={peer ? "client" : "platform"} size={36} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-stone-100">
                            {peerName}
                          </span>
                          <span className="block truncate text-[10px] uppercase tracking-[0.16em] text-stone-500">
                            {[roleLabel(peer?.role), kindLabel(conversation.kind)]
                              .filter((label, index, all) => label && all.indexOf(label) === index)
                              .join(" · ")}
                          </span>
                        </span>
                      </span>
                      <Link
                        href="/support"
                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lux-gold-light)] hover:underline"
                      >
                        {t("msg.help")}
                      </Link>
                    </>
                  }
                />
              ) : null}
            </div>
          </div>
        </main>

        <div className="relative z-10 mt-16">
          <LuxFooter />
        </div>
      </div>
    </LuxShell>
  );
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  if (sameDay) return date.toLocaleTimeString(documentIntl(), { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(documentIntl(), { day: "2-digit", month: "2-digit" });
}
