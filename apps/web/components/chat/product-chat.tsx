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

const POLL_MS = 6_000;

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Messages + zone de saisie. Utilisé partout : fiche produit, compte client,
// espace vendeur, console admin. Les libellés d'auteur viennent du serveur
// (le client ne voit jamais qui, côté vente, a répondu).
// ---------------------------------------------------------------------------

export function MessageList({ messages, showAuthors }: { messages: ThreadMessage[]; showAuthors: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) return <p className="py-8 text-center text-[13px] text-stone-500">Aucun message pour l’instant.</p>;
  return (
    <div className="space-y-3">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const grouped = prev && prev.author === m.author && prev.ownSide === m.ownSide;
        return (
          <div key={m.id} className={`flex flex-col ${m.ownSide ? "items-end" : "items-start"}`}>
            {showAuthors && !grouped && <span className="mb-1 px-1 text-[11px] text-stone-500">{m.author}</span>}
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${
                m.ownSide
                  ? "rounded-br-md bg-[linear-gradient(120deg,#c83a24,#8e2014)] text-white"
                  : "rounded-bl-md border border-white/[0.08] bg-white/[0.05] text-stone-100"
              }`}
            >
              {m.content}
            </div>
            <span className="mt-0.5 px-1 text-[10.5px] text-stone-600">{when(m.createdAt)}</span>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

export function Composer({ onSend, placeholder = "Votre message…" }: { onSend: (text: string) => Promise<void>; placeholder?: string }) {
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
      setError(errorMessage(err, "Envoi impossible."));
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
          placeholder={placeholder}
          aria-label="Message"
          className="min-h-[46px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-[14px] text-stone-100 placeholder:text-stone-600 focus:border-[rgba(255,106,50,0.6)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="lux-btn lux-btn-gold !min-h-[46px] shrink-0 px-5 text-[12px] uppercase tracking-[0.12em] disabled:opacity-50"
          style={{ borderRadius: 16 }}
        >
          {busy ? "…" : "Envoyer"}
        </button>
      </div>
      <p className="text-[11px] text-stone-600">Entrée pour envoyer · Maj + Entrée pour un retour à la ligne</p>
    </form>
  );
}

/** Un fil ouvert : en-tête produit, messages rafraîchis, saisie. */
export function ThreadPanel({ threadId, onActivity }: { threadId: string; onActivity?: () => void }) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await fetchThread(threadId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Discussion indisponible."));
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
        <Spinner className="h-4 w-4" /> Chargement de la discussion…
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Thumb url={thread.product.imageUrl} />
        <div className="min-w-0 flex-1">
          <Link href={`/catalogue/${thread.product.slug}`} className="block truncate text-[14px] font-semibold text-white hover:underline">
            {thread.product.title}
          </Link>
          <p className="text-[12px] text-stone-400">
            {thread.side === "client" ? `Discussion avec ${thread.counterpart === "Vendeur" ? "le vendeur" : thread.counterpart}` : `Client : ${thread.counterpart}`}
            {!thread.product.available && " · plus en vente"}
          </p>
        </div>
        {thread.side === "team" && (
          <span className="shrink-0 rounded-full border border-[rgba(134,239,172,0.3)] px-2.5 py-1 text-[10.5px] text-[#86efac]">Auteurs visibles</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MessageList messages={thread.messages} showAuthors={thread.side !== "client"} />
      </div>
      <div className="border-t border-white/[0.06] p-3">
        <Composer
          placeholder={thread.side === "client" ? "Écrire au vendeur…" : "Répondre au client…"}
          onSend={async (content) => {
            await replyInThread(thread.id, content);
            await load();
            onActivity?.();
          }}
        />
        {thread.side === "seller" && (
          <p className="mt-2 text-[11px] text-stone-600">Le client ne voit pas qui répond : vos réponses et celles de l’équipe apparaissent comme « Vendeur ».</p>
        )}
      </div>
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
  ) : (
    <span aria-hidden className="h-10 w-10 shrink-0 rounded-xl bg-[linear-gradient(135deg,rgba(255,106,50,0.35),rgba(142,32,20,0.35))]" />
  );
}

// ---------------------------------------------------------------------------
// Boîte de réception : liste des fils à gauche, fil ouvert à droite
// (une seule colonne sur mobile). Le fil ouvert est dans l'URL (?thread=).
// ---------------------------------------------------------------------------

export function ChatInbox({ source, basePath, emptyText }: { source: "mine" | "inbox"; basePath: string; emptyText: string }) {
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
      setError(errorMessage(err, "Discussions indisponibles."));
    }
  }, [source]);

  useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(load, 15_000);

  const open = (id: string | null) => router.replace(id ? `${basePath}?thread=${id}` : basePath, { scroll: false });

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
            <Spinner className="h-4 w-4" /> Chargement…
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
                <Thumb url={item.product.imageUrl} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-stone-100">{item.product.title}</span>
                    <span className="shrink-0 text-[10.5px] text-stone-500">{when(item.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={`truncate text-[12.5px] ${item.unread > 0 ? "text-stone-200" : "text-stone-500"}`}>
                      {source === "inbox" && <span className="text-stone-400">{item.counterpart} · </span>}
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
              ← Toutes les discussions
            </button>
            <div className="min-h-0 flex-1">
              <ThreadPanel key={selected} threadId={selected} onActivity={() => void load()} />
            </div>
          </>
        ) : (
          <p className="m-auto max-w-xs text-center text-[13px] text-stone-500">Choisissez une discussion pour l’afficher.</p>
        )}
      </section>
    </div>
  );
}
