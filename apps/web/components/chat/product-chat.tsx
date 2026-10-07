"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { errorMessage } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import {
  fetchInbox,
  fetchMyThreads,
  fetchThread,
  replyInThread,
  type ThreadDetail,
  type ThreadMessage,
  type ThreadSummary,
} from "@/lib/product-chat";
import { useT } from "@/lib/i18n";

const POLL_MS = 6_000;

function when(iso: string, locale: string) {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Messages + zone de saisie. Utilisé partout : fiche produit, compte client,
// espace vendeur, console admin. Les libellés d'auteur viennent du serveur
// (le client ne voit jamais qui, côté vente, a répondu).
// ---------------------------------------------------------------------------

export function MessageList({ messages, showAuthors }: { messages: ThreadMessage[]; showAuthors: boolean }) {
  const t = useT();
  const end = useRef<HTMLDivElement>(null);
  // Libellés génériques renvoyés par l'API en français.
  const authorLabel = (a: string) => (a === "Vous" ? t("chat.you") : a === "Vendeur" ? t("chat.seller") : a === "Équipe MISTERDOU" ? t("chat.team") : a);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) return <p className="py-8 text-center text-[13px] text-stone-500">{t("chat.noMessages")}</p>;
  return (
    <div className="space-y-3">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const grouped = prev && prev.author === m.author && prev.ownSide === m.ownSide;
        return (
          <div key={m.id} className={`flex flex-col ${m.ownSide ? "items-end" : "items-start"}`}>
            {showAuthors && !grouped && <span className="mb-1 px-1 text-[11px] text-stone-500">{authorLabel(m.author)}</span>}
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${
                m.ownSide
                  ? "rounded-br-md bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white"
                  : "rounded-bl-md border border-white/[0.08] bg-white/[0.05] text-stone-100"
              }`}
            >
              {m.content}
            </div>
            <span className="mt-0.5 px-1 text-[10.5px] text-stone-600">{when(m.createdAt, t.intl)}</span>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

export function Composer({ onSend, placeholder }: { onSend: (text: string) => Promise<void>; placeholder?: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(content);
      setText("");
    } catch (err) {
      setError(errorMessage(err, t("chat.sendFailed")));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          maxLength={2000}
          placeholder={placeholder ?? t("chat.placeholder")}
          aria-label={t("chat.message")}
          className="min-h-[46px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-[14px] text-stone-100 placeholder:text-stone-600 focus:border-[rgba(255,106,50,0.6)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="lux-btn lux-btn-gold !min-h-[46px] shrink-0 px-5 text-[12px] uppercase tracking-[0.12em] disabled:opacity-50"
          style={{ borderRadius: 16 }}
        >
          {busy ? "…" : t("chat.send")}
        </button>
      </div>
      <p className="text-[11px] text-stone-600">{t("chat.hint")}</p>
    </form>
  );
}

/**
 * Photo de l'interlocuteur : vendeur ou client (photo de profil, sinon son
 * initiale) ; MISTERDOU : son monogramme. Remplace la miniature du compte.
 */
export function ChatAvatar({
  name,
  url,
  kind,
  size = 40,
}: {
  name: string;
  url: string | null;
  kind: "seller" | "client" | "platform";
  size?: number;
}) {
  const style = { width: size, height: size };
  // Boutique officielle avec photo : la photo, cerclée de l'anneau braise.
  if (kind === "platform" && url) {
    return (
      <span aria-hidden style={style} className="grid shrink-0 place-items-center rounded-full bg-[conic-gradient(from_0deg,#ffb08a,#e84724,#7a1712,#e84724,#ffb08a)] p-[2px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- bucket public R2 */}
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      </span>
    );
  }
  if (kind === "platform") {
    return (
      <span
        aria-hidden
        style={style}
        className="lux-serif grid shrink-0 place-items-center rounded-full border border-[rgba(255,160,112,0.4)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,160,112,0.3),rgba(122,23,18,0.5))] text-[14px] font-bold text-[#ffd8c4]"
      >
        M.
      </span>
    );
  }
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden
      style={style}
      className="grid shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ff6a32,#8e2014)] text-[14px] font-semibold text-white"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Rappel affiché dans chaque discussion client ↔ vendeur. */
export function OffsiteNotice() {
  const t = useT();
  return (
    <p className="flex gap-2 rounded-xl border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.06)] px-3 py-2 text-[11.5px] leading-relaxed text-[#f5d9a8]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0">
        <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>{t("chat.offsite")}</span>
    </p>
  );
}

/** Un fil ouvert : en-tête (interlocuteur + compte), messages rafraîchis, saisie. */
export function ThreadPanel({ threadId, onActivity }: { threadId: string; onActivity?: () => void }) {
  const t = useT();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await fetchThread(threadId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t("chat.unavailable")));
    }
  }, [threadId]);

  useEffect(() => {
    setThread(null);
    void load().then(() => onActivity?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useVisiblePoll(load, POLL_MS);

  if (error && !thread) return <Alert tone="danger">{error}</Alert>;
  if (!thread) {
    return (
      <p className="flex items-center gap-2 p-4 text-[13px] text-stone-400">
        <Spinner className="h-4 w-4" /> {t("chat.loadingThread")}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <ChatAvatar name={thread.counterpart} url={thread.counterpartAvatarUrl} kind={thread.counterpartKind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-white">
            {thread.side === "client" ? thread.counterpart : t("chat.client", { name: thread.counterpart })}
          </p>
          <p className="truncate text-[12px] text-stone-400">
            <Link href={`/catalogue/${thread.product.slug}`} className="hover:text-stone-200 hover:underline">
              {thread.product.title}
            </Link>
            {(thread.side === "observer" || thread.side === "team") && thread.sellerName && ` · ${t("chat.sellerOf", { name: thread.sellerName })}`}
            {!thread.product.available && t("chat.soldOut")}
          </p>
        </div>
        {thread.readOnly ? (
          <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[10.5px] text-stone-300">{t("chat.readOnly")}</span>
        ) : (
          thread.side === "team" && (
            <span className="shrink-0 rounded-full border border-[rgba(134,239,172,0.3)] px-2.5 py-1 text-[10.5px] text-[#86efac]">{t("chat.authorsVisible")}</span>
          )
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {(thread.side === "client" || thread.side === "seller") && (
          <div className="mb-4">
            <OffsiteNotice />
          </div>
        )}
        <MessageList messages={thread.messages} showAuthors={thread.side !== "client"} />
      </div>
      <div className="border-t border-white/[0.06] p-3">
        {thread.readOnly ? (
          <p className="text-[12.5px] leading-relaxed text-stone-400">{t("chat.readOnlyNote")}</p>
        ) : (
          <Composer
            placeholder={thread.side === "client" ? t("chat.writeSeller") : t("chat.replyClient")}
            onSend={async (content) => {
              await replyInThread(thread.id, content);
              await load();
              onActivity?.();
            }}
          />
        )}
        {thread.side === "seller" && (
          <p className="mt-2 text-[11px] text-stone-600">{t("chat.sellerNote")}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boîte de réception : liste des fils à gauche, fil ouvert à droite
// (une seule colonne sur mobile). Le fil ouvert est dans l'URL (?thread=).
// ---------------------------------------------------------------------------

export function ChatInbox({ source, basePath, emptyText }: { source: "mine" | "inbox"; basePath: string; emptyText: string }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("thread");
  const [items, setItems] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(source === "mine" ? await fetchMyThreads() : (await fetchInbox()).items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t("chat.listUnavailable")));
    }
  }, [source]);

  useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(load, 15_000);

  const open = (id: string | null) => router.replace(id ? `${basePath}?thread=${id}` : basePath, { scroll: false });

  // Aucune discussion : une carte d'accueil, pas un grand cadre vide.
  if (items?.length === 0 && !selected) {
    return (
      <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[rgba(255,106,50,0.35)] text-[var(--lux-gold-light)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
          </svg>
        </span>
        <p className="mx-auto mt-4 max-w-sm text-[13.5px] leading-relaxed text-stone-400">{emptyText}</p>
        {source === "mine" && (
          <Link href="/offres" className="lux-btn lux-btn-ghost mt-6 inline-flex" style={{ borderRadius: 16 }}>
            {t("chat.browseOffers")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100dvh-220px)] min-h-[480px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.02] md:grid-cols-[320px_1fr]">
      <aside className={`min-h-0 overflow-y-auto border-white/[0.06] md:border-r ${selected ? "hidden md:block" : "block"}`}>
        {error && (
          <div className="p-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        {items === null && !error && (
          <p className="flex items-center gap-2 p-4 text-[13px] text-stone-400">
            <Spinner className="h-4 w-4" /> {t("chat.loading")}
          </p>
        )}
        {items?.length === 0 && <p className="p-5 text-[13px] leading-relaxed text-stone-400">{emptyText}</p>}
        <ul>
          {items?.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => open(item.id)}
                aria-current={item.id === selected ? "true" : undefined}
                className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition ${
                  item.id === selected ? "bg-[rgba(232,71,36,0.12)]" : "hover:bg-white/[0.03]"
                }`}
              >
                <ChatAvatar name={item.counterpart} url={item.counterpartAvatarUrl} kind={item.counterpartKind} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-stone-100">{item.counterpart}</span>
                    <span className="shrink-0 text-[10.5px] text-stone-500">{when(item.lastMessageAt, t.intl)}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-stone-500">
                    {item.product.title}
                    {item.readOnly && item.sellerName && ` · ${t("chat.sellerOf", { name: item.sellerName })}`}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={`truncate text-[12.5px] ${item.unread > 0 ? "text-stone-200" : "text-stone-500"}`}>
                      {item.lastMessage?.preview ?? ""}
                    </span>
                    {item.unread > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#ff6a32] px-1.5 text-[10.5px] font-bold text-white">
                        {item.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className={`min-h-0 ${selected ? "flex flex-col" : "hidden md:flex md:flex-col"}`}>
        {selected ? (
          <>
            <button type="button" onClick={() => open(null)} className="px-4 pt-3 text-left text-[12.5px] text-stone-400 md:hidden">
              {t("chat.allThreads")}
            </button>
            <div className="min-h-0 flex-1">
              <ThreadPanel key={selected} threadId={selected} onActivity={() => void load()} />
            </div>
          </>
        ) : (
          <p className="m-auto max-w-xs text-center text-[13px] text-stone-500">{t("chat.pick")}</p>
        )}
      </section>
    </div>
  );
}
