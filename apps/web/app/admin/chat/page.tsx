"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { request } from "@/lib/api";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { Alert, Spinner } from "@/components/ui";
import { DashHeading } from "@/components/dash/dash-ui";
import { IconChevron, IconUsers } from "@/components/dash/dash-icons";
import { ChatAvatar } from "@/components/chat/product-chat";
import { ConversationThread, type ThreadSource } from "@/components/messagerie/thread";
import type { MessageItem, MessagePage } from "@/components/messagerie/types";
import { errorMessage } from "../_lib/api";

// ---------------------------------------------------------------------------
// Discussion d'équipe — administrateurs et managers, quelle que soit leur
// permission. Salon « Toute l'équipe » + échanges privés à deux.
// GET /admin/team-chat (liste, non lus), POST /admin/team-chat/direct,
// /admin/team-chat/room/messages (salon), /conversations/:id/messages (privé).
// ?with=<id> ouvre l'échange avec ce membre (lien des notifications).
// ---------------------------------------------------------------------------

type LastMessage = { content: string; createdAt: string; mine: boolean; senderName?: string } | null;

type Member = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: "ADMIN" | "STAFF";
  title: string;
  onDuty: boolean;
  schedule: string | null;
  conversationId: string | null;
  unread: number;
  lastMessage: LastMessage;
};

type Overview = { me: string; room: { unread: number; lastMessage: LastMessage }; members: Member[] };

type Selection = { kind: "room" } | { kind: "member"; id: string };

const POLL_MS = 15_000;

/** « 15:05 » aujourd'hui, sinon « 12 oct. ». */
function shortWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const roomSource: ThreadSource = {
  fetch: (params) => {
    const search = new URLSearchParams({ limit: String(params.limit ?? 50) });
    if (params.before) search.set("before", params.before);
    return request<MessagePage>(`/api/v1/admin/team-chat/room/messages?${search.toString()}`);
  },
  send: (content) => request<MessageItem>("/api/v1/admin/team-chat/room/messages", { method: "POST", body: JSON.stringify({ content }) }),
};

// Lecture de ?with=… : sous Suspense (exigence de Next pour la construction).
export default function TeamChatPage() {
  return (
    <Suspense fallback={null}>
      <TeamChat />
    </Suspense>
  );
}

function TeamChat() {
  const router = useRouter();
  const params = useSearchParams();
  const withId = params.get("with");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(withId ? { kind: "member", id: withId } : null);
  const [openError, setOpenError] = useState<string | null>(null);
  // Ouverture en cours (une seule à la fois par membre, insensible aux rafraîchissements).
  const pendingRef = useRef<string | null>(null);
  // Conversations ouvertes pendant la visite (avant le prochain rafraîchissement de la liste).
  const [opened, setOpened] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setOverview(await request<Overview>("/api/v1/admin/team-chat"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(load, POLL_MS);

  // Lien d'une notification (?with=…) : ouvre l'échange avec ce membre.
  useEffect(() => {
    if (withId) setSelection({ kind: "member", id: withId });
  }, [withId]);

  const member = selection?.kind === "member" ? overview?.members.find((m) => m.id === selection.id) ?? null : null;
  const conversationId = member ? (member.conversationId ?? opened[member.id] ?? null) : null;

  // Premier message à un collègue : l'échange privé est créé à l'ouverture.
  const memberId = member?.id ?? null;
  useEffect(() => {
    if (!memberId || conversationId || pendingRef.current === memberId) return;
    pendingRef.current = memberId;
    setOpenError(null);
    request<{ conversationId: string }>("/api/v1/admin/team-chat/direct", { method: "POST", body: JSON.stringify({ userId: memberId }) })
      .then((res) => setOpened((prev) => ({ ...prev, [memberId]: res.conversationId })))
      .catch((err) => setOpenError(errorMessage(err)))
      .finally(() => {
        if (pendingRef.current === memberId) pendingRef.current = null;
      });
  }, [memberId, conversationId]);

  function select(next: Selection) {
    setSelection(next);
    // Ancien lien ?with=… effacé : la sélection suit les clics.
    if (withId) router.replace("/admin/chat");
  }

  const onDutyCount = useMemo(() => (overview ? overview.members.filter((m) => m.onDuty).length + 1 : 0), [overview]);

  return (
    <>
      <DashHeading greeting="Équipe" title="Discussion d’équipe" />
      <p className="mt-2 max-w-2xl text-[13.5px] text-[#b8a6a1]">
        Échangez avec toute l’équipe dans le salon commun, ou en privé avec un collègue. Les clients ne voient jamais ces
        messages.
      </p>

      {error && (
        <div className="mt-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {!overview && !error ? (
        <p className="mt-8 flex items-center gap-3 text-sm text-[#b8a6a1]">
          <Spinner /> Chargement de l’équipe…
        </p>
      ) : overview ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Liste : salon + membres (masquée sur téléphone quand un échange est ouvert). */}
          <aside className={`dash-card overflow-hidden p-2 ${selection ? "hidden lg:block" : ""}`}>
            <ListRow
              active={selection?.kind === "room"}
              onClick={() => select({ kind: "room" })}
              avatar={
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ff8a5c,#8e2014)] text-white">
                  <IconUsers size={18} />
                </span>
              }
              title="Toute l’équipe"
              subtitle={`${onDutyCount} en service maintenant`}
              last={overview.room.lastMessage}
              unread={overview.room.unread}
            />
            <p className="mb-1 mt-3 px-3 text-[11px] text-[#6f5f5a]">Membres</p>
            {overview.members.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-[#8f7d77]">Aucun autre membre dans l’équipe pour le moment.</p>
            ) : (
              overview.members.map((m) => (
                <ListRow
                  key={m.id}
                  active={selection?.kind === "member" && selection.id === m.id}
                  onClick={() => select({ kind: "member", id: m.id })}
                  avatar={<PresenceAvatar member={m} />}
                  title={m.name}
                  subtitle={`${m.title} · ${m.onDuty ? "En service" : "Hors service"}`}
                  last={m.lastMessage}
                  unread={m.unread}
                />
              ))
            )}
          </aside>

          {/* Échange ouvert. */}
          <div className={`min-w-0 ${selection ? "" : "hidden lg:block"}`}>
            {!selection ? (
              <div className="dash-card grid h-[60vh] place-items-center p-6 text-center">
                <div>
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[rgba(255,138,92,0.35)] text-[#ff8a5c]">
                    <IconUsers size={20} />
                  </span>
                  <p className="mt-3 text-[15px] font-semibold text-stone-100">Choisissez une discussion</p>
                  <p className="mt-1 text-[13px] text-[#8f7d77]">Le salon de toute l’équipe, ou un collègue à gauche.</p>
                </div>
              </div>
            ) : selection.kind === "room" ? (
              <ConversationThread
                conversationId="team-room"
                currentUserId={overview.me}
                source={roomSource}
                onSent={() => void load()}
                className="h-[70vh]"
                header={
                  <ThreadHeader
                    onBack={() => setSelection(null)}
                    avatar={
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ff8a5c,#8e2014)] text-white">
                        <IconUsers size={16} />
                      </span>
                    }
                    title="Toute l’équipe"
                    subtitle={`${overview.members.length + 1} membres · ${onDutyCount} en service`}
                  />
                }
              />
            ) : member && conversationId ? (
              <ConversationThread
                conversationId={conversationId}
                currentUserId={overview.me}
                onSent={() => void load()}
                className="h-[70vh]"
                header={
                  <ThreadHeader
                    onBack={() => setSelection(null)}
                    avatar={<PresenceAvatar member={member} size={36} />}
                    title={member.name}
                    subtitle={`${member.title} · ${member.onDuty ? "En service" : member.schedule ? `Hors service — ${member.schedule}` : "Hors service"}`}
                  />
                }
              />
            ) : (
              <div className="dash-card grid h-[40vh] place-items-center p-6 text-center text-[13px] text-[#b8a6a1]">
                {openError ? (
                  <Alert tone="danger">{openError}</Alert>
                ) : member ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Ouverture de la discussion…
                  </span>
                ) : (
                  <span>Ce membre ne fait plus partie de l’équipe.</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ListRow({
  active,
  onClick,
  avatar,
  title,
  subtitle,
  last,
  unread,
}: {
  active: boolean;
  onClick: () => void;
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
  last: LastMessage;
  unread: number;
}) {
  const preview = last ? `${last.mine ? "Vous : " : last.senderName ? `${last.senderName} : ` : ""}${last.content}` : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
        active ? "bg-[rgba(232,71,36,0.12)]" : "hover:bg-white/[0.04]"
      }`}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-[14px] ${unread > 0 ? "font-semibold text-stone-50" : "text-stone-200"}`}>{title}</span>
          {last && <span className="shrink-0 text-[10.5px] tabular-nums text-[#8f7d77]">{shortWhen(last.createdAt)}</span>}
        </span>
        <span className="block truncate text-[11.5px] text-[#8f7d77]">{subtitle}</span>
        {preview && <span className={`mt-0.5 block truncate text-[12.5px] ${unread > 0 ? "text-stone-200" : "text-[#b8a6a1]"}`}>{preview}</span>}
      </span>
      {unread > 0 && (
        <span className="grid min-w-[20px] shrink-0 place-items-center rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-1.5 py-0.5 text-[10px] font-bold text-[#1a0503]">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

function PresenceAvatar({ member, size = 40 }: { member: Member; size?: number }) {
  return (
    <span className="relative shrink-0">
      <ChatAvatar name={member.name} url={member.avatarUrl} kind="client" size={size} />
      <span
        aria-hidden
        title={member.onDuty ? "En service" : "Hors service"}
        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0e0807] ${member.onDuty ? "bg-[#34d399]" : "bg-[#6f5f5a]"}`}
      />
    </span>
  );
}

function ThreadHeader({ onBack, avatar, title, subtitle }: { onBack: () => void; avatar: React.ReactNode; title: string; subtitle: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Retour à la liste" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-stone-300 lg:hidden">
        <IconChevron size={16} className="rotate-90" />
      </button>
      {avatar}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-stone-100">{title}</span>
        <span className="block truncate text-[11.5px] text-[#8f7d77]">{subtitle}</span>
      </span>
    </span>
  );
}
