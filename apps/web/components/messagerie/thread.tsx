"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Spinner } from "@/components/ui";
import { ApiClientError, errorMessage } from "@/lib/api";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import {
  MESSAGES_PAGE_SIZE,
  fetchMessages,
  mergeMessages,
  sendConversationMessage,
} from "./api";
import type { MessageItem } from "./types";
import { useT } from "@/lib/i18n";
import { documentIntl } from "@/lib/i18n-core";

// ---------------------------------------------------------------------------
// Fil de discussion — implémentation unique partagée par /messages (membre)
// et /admin/messages (administration).
// Recharge les nouveaux messages toutes les 8 s (onglet visible uniquement),
// monte les messages plus anciens avec `before` (curseur nextBefore) quand on
// remonte en haut du fil, et nettoie ses intervalles au démontage.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 8000;

type Row =
  | { kind: "date"; id: string; label: string }
  | { kind: "message"; id: string; message: MessageItem };

function buildRows(messages: MessageItem[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const day = Number.isNaN(date.getTime()) ? "" : date.toDateString();
    if (day && day !== lastDay) {
      lastDay = day;
      rows.push({
        kind: "date",
        id: `day-${day}`,
        label: date.toLocaleDateString(documentIntl(), {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      });
    }
    rows.push({ kind: "message", id: message.id, message });
  }
  return rows;
}

function timeOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(documentIntl(), { hour: "2-digit", minute: "2-digit" });
}

export function ConversationThread({
  conversationId,
  currentUserId,
  header,
  onSent,
  className = "",
}: {
  conversationId: string;
  currentUserId?: string | null;
  header?: ReactNode;
  onSent?: () => void;
  className?: string;
}) {
  const t = useT();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const restoreRef = useRef<{ top: number; height: number } | null>(null);
  // Fil en cours : invalide les réponses du sondage arrivées après un
  // changement de conversation (elles seraient fusionnées dans le mauvais fil).
  const activeConversationRef = useRef(conversationId);
  activeConversationRef.current = conversationId;

  // Réinitialisation à chaque changement de conversation.
  useEffect(() => {
    setMessages([]);
    setNextBefore(null);
    setError(null);
    setSendError(null);
    setDraft("");
    setReady(false);
    stickToBottomRef.current = true;
    restoreRef.current = null;
  }, [conversationId]);

  // Chargement de la première page du fil.
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchMessages(conversationId, { limit: MESSAGES_PAGE_SIZE })
      .then((page) => {
        if (!active) return;
        setMessages(page.items);
        setNextBefore(page.nextBefore);
        setError(null);
        setReady(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err);
        setReady(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, reloadToken]);

  // Synchronisation du défilement : restauration après un « charger plus »,
  // sinon coller en bas si l'utilisateur était déjà en bas.
  useEffect(() => {
    const restore = restoreRef.current;
    const el = scrollRef.current;
    if (!el) return;
    if (restore) {
      restoreRef.current = null;
      el.scrollTop = Math.max(0, restore.top + (el.scrollHeight - restore.height));
      return;
    }
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Interrogation des nouveaux messages (8 s, pause hors premier plan).
  useVisiblePoll(
    async () => {
      const target = conversationId;
      try {
        const page = await fetchMessages(target, { limit: MESSAGES_PAGE_SIZE });
        if (activeConversationRef.current !== target) return;
        setMessages((prev) => mergeMessages(prev, page.items));
        setNextBefore((prev) => prev ?? page.nextBefore);
        setError(null);
      } catch (err) {
        if (activeConversationRef.current !== target) return;
        setError(err);
        if (
          err instanceof ApiClientError &&
          ["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(err.code)
        ) {
          setReady(false);
          return false;
        }
      }
      return undefined;
    },
    POLL_INTERVAL_MS,
    { enabled: ready },
  );

  const loadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || !nextBefore) return;
    const top = el.scrollTop;
    const height = el.scrollHeight;
    setLoadingMore(true);
    fetchMessages(conversationId, { before: nextBefore, limit: MESSAGES_PAGE_SIZE })
      .then((page) => {
        restoreRef.current = { top, height };
        setMessages((prev) => mergeMessages(page.items, prev));
        setNextBefore(page.nextBefore);
      })
      .catch((err) => setError(err))
      .finally(() => setLoadingMore(false));
  }, [conversationId, loading, loadingMore, nextBefore]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    // Auto-chargement seulement si le fil déborde réellement (sinon boucle
    // d’empilement sur un fil plus court que la zone de défilement).
    if (el.scrollTop <= 8 && el.scrollHeight > el.clientHeight + 8) loadOlder();
  }, [loadOlder]);

  async function submit() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await sendConversationMessage(conversationId, content);
      setMessages((prev) => mergeMessages(prev, [created]));
      setDraft("");
      stickToBottomRef.current = true;
      onSent?.();
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  const rows = buildRows(messages);
  const empty = !loading && !error && messages.length === 0;

  return (
    <section
      className={`flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#101825]/80 ${className}`}
    >
      {header && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.02] px-4 py-3">
          {header}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
      >
        {loading && (
          <p className="flex items-center gap-3 py-8 text-sm text-stone-400">
            <Spinner /> {t("thread.loading")}
          </p>
        )}

        {!loading && loadingMore && (
          <p className="flex items-center gap-2 pb-1 text-[11px] text-stone-500">
            <Spinner className="h-3.5 w-3.5" /> {t("thread.loadingOlder")}
          </p>
        )}

        {!loading && error !== null && messages.length === 0 && (
          <div className="space-y-3 py-4">
            <Alert tone="danger">{errorMessage(error)}</Alert>
            <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
              {t("thread.retry")}
            </Button>
          </div>
        )}

        {!loading && empty && !error && (
          <p className="py-10 text-center text-sm text-stone-400">
            {t("thread.empty")}
          </p>
        )}

        {rows.map((row) =>
          row.kind === "date" ? (
            <p key={row.id} className="flex items-center gap-3 py-2 text-[10px] uppercase tracking-[0.18em] text-stone-500">
              <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
              {row.label}
              <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            </p>
          ) : (
            <MessageBubble
              key={row.id}
              message={row.message}
              mine={Boolean(currentUserId) && row.message.senderId === currentUserId}
            />
          ),
        )}

        {!loading && error !== null && messages.length > 0 && (
          <div className="pt-2">
            <Alert tone="warning">{errorMessage(error)}</Alert>
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="border-t border-white/[0.08] bg-black/10 px-3 py-3 sm:px-4"
      >
        {sendError && (
          <div className="mb-2">
            <Alert tone="danger">{sendError}</Alert>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            aria-label={t("thread.inputLabel")}
            placeholder={t("thread.placeholder")}
            className="min-h-[46px] w-full resize-none rounded-[14px] border border-[rgba(255,255,255,0.12)] bg-white/[0.04] px-3.5 py-2.5 text-sm text-stone-100 outline-none transition-colors placeholder:text-stone-500 focus:border-[rgba(232,71,36,0.6)]"
          />
          <Button type="submit" loading={sending} disabled={!draft.trim()}>
            {t("thread.send")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function MessageBubble({ message, mine }: { message: MessageItem; mine: boolean }) {
  const t = useT();
  if (message.isSystem) {
    return (
      <p className="py-1 text-center text-[11px] leading-relaxed text-stone-400">{message.content}</p>
    );
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-[16px] border px-3.5 py-2.5 sm:max-w-[70%] ${
          mine
            ? "rounded-br-md border-[rgba(255,106,50,0.32)] bg-[linear-gradient(120deg,rgba(255,106,50,0.16),rgba(232,71,36,0.12))] text-stone-50"
            : "rounded-bl-md border-white/10 bg-white/[0.05] text-stone-200"
        }`}
      >
        {!mine && message.senderName && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--lux-gold-light)]">
            {message.senderName}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
          {message.content}
        </p>
        {message.attachmentKey && (
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-400">{t("thread.attachment")}</p>
        )}
        <p className="mt-1 flex items-center justify-end gap-2 text-[10px] tabular-nums text-stone-400">
          {mine && message.readAt && <span className="text-[var(--lux-gold-light)]">Lu</span>}
          <span>{timeOf(message.createdAt)}</span>
        </p>
      </div>
    </div>
  );
}
