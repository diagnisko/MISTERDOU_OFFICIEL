"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Spinner, TextInput } from "@/components/ui";
import { buildQuery, errorMessage, request } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminModal,
  AdminPageHead,
  DataTable,
  ErrorAlert,
  NoticeAlert,
  Pagination,
  RowAction,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";
import { ConversationThread } from "@/components/messagerie/thread";
import { ChatAvatar } from "@/components/chat/product-chat";
import {
  excerpt,
  kindLabel,
  personName,
  unreadCount,
  type ConversationSummary,
} from "@/components/messagerie/types";
import { resolveSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Messages — GET /admin/conversations { page, perPage, q }, ouverture d’un fil
// via le composant partagé components/messagerie/thread.tsx (envoi côté admin).
// « Écrire à un membre » : l'équipe peut écrire la première à un client ou un
// vendeur (GET /admin/conversations/recipients, POST /admin/conversations/start).
// ---------------------------------------------------------------------------

const PER_PAGE = 25;

function participantsLabel(row: ConversationSummary): string {
  const names = (row.participants ?? [])
    .map((person) => personName(person))
    .filter(Boolean)
    .join(" / ");
  if (names) return names;
  return personName(row.peer) || "—";
}

export default function AdminMessagesPage() {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const list = useAdminList<ConversationSummary>(
    `/api/v1/admin/conversations${buildQuery({ page, perPage })}`,
  );

  useEffect(() => {
    let active = true;
    void resolveSession().then((session) => {
      if (active) setCurrentUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <AdminPageHead
        kicker="Clients & support"
        title="Messages"
        meta="Conversations internes : clients et vendeurs avec l’administration."
        action={
          <>
            <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
              Actualiser
            </Button>
            <Button onClick={() => setComposing(true)}>Écrire à un membre</Button>
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Conversations</p>
          <p className="mt-3 text-xs text-stone-500">
            {list.meta.total.toLocaleString("fr-FR")} conversation
            {list.meta.total > 1 ? "s" : ""} · dernière activité en premier
          </p>
        </div>
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading label="Chargement des conversations…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label="Aucune conversation pour cette recherche." />
        ) : (
          <DataTable
            columns={["Participants", "Type", "Dernier message", "Non lus", "Mis à jour"]}
            minWidth={940}
          >
            {list.items.map((row) => {
              const count = unreadCount(row.unread);
              return (
                <tr key={row.id} className="transition hover:bg-white/[0.025]">
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-2.5">
                      {(() => {
                        // Photo du membre (le participant qui n'est pas de l'équipe), sinon initiales.
                        const member = row.participants?.find((p) => p.role !== "ADMIN" && p.role !== "STAFF") ?? row.participants?.[0];
                        return <ChatAvatar name={personName(member) || participantsLabel(row)} url={member?.avatarUrl ?? null} kind="client" size={32} />;
                      })()}
                      <span className="min-w-0">
                        <span className="block max-w-[240px] truncate text-stone-200">
                          {participantsLabel(row)}
                        </span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-[0.14em] text-stone-500">
                          {row.participants
                            ?.map((person) => person.role)
                            .filter(Boolean)
                            .join(" · ") ?? ""}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge cls="border-white/15 bg-white/5 text-stone-300">
                      {kindLabel(row.kind)}
                    </Badge>
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3.5 text-stone-300">
                    {excerpt(row.lastMessage?.content)}
                  </td>
                  <td className="px-4 py-3.5">
                    {count > 0 ? (
                      <span className="grid min-w-[20px] place-items-center rounded-full bg-[linear-gradient(120deg,#ffa070,#ff6a32_45%,#e84724)] px-1.5 py-0.5 text-[10px] font-bold text-[#1a0503]">
                        {count > 99 ? "99+" : count}
                      </span>
                    ) : (
                      <span className="text-stone-600">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                    {formatDateTime(row.updatedAt)}
                  </td>
                  <td className="px-4 py-3.5">
                    <RowAction label="Ouvrir" onClick={() => setSelected(row)} />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </TableCard>

      <Pagination
        meta={list.meta}
        onPage={setPage}
        onPerPage={(size) => {
          setPerPage(size);
          setPage(1);
        }}
      />

      {composing && (
        <NewConversationModal
          onClose={() => setComposing(false)}
          onOpened={(conversation) => {
            setComposing(false);
            setSelected(conversation);
            void list.refresh();
          }}
        />
      )}

      {selected && (
        <AdminModal
          title={participantsLabel(selected)}
          onClose={() => {
            setSelected(null);
            void list.refresh();
          }}
          width="max-w-3xl"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Badge cls="border-white/15 bg-white/5 text-stone-300">{kindLabel(selected.kind)}</Badge>
            <span className="text-[11px] tabular-nums text-stone-500">
              Mis à jour le {formatDateTime(selected.updatedAt)}
            </span>
          </div>

          <ConversationThread
            conversationId={selected.id}
            currentUserId={currentUserId}
            onSent={() => void list.refresh()}
            className="h-[65vh]"
            header={
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-stone-100">
                  {participantsLabel(selected)}
                </span>
                <span className="block truncate text-[10px] uppercase tracking-[0.16em] text-stone-500">
                  {kindLabel(selected.kind)} · réponse en tant qu’administration
                </span>
              </span>
            }
          />
        </AdminModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Écrire à un membre : recherche par nom, e-mail ou téléphone, puis la
// conversation s'ouvre (la même que s'il avait écrit le premier).
// ---------------------------------------------------------------------------

type Recipient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarUrl: string | null;
  isSeller: boolean;
};

function NewConversationModal({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (conversation: ConversationSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      request<Recipient[]>(`/api/v1/admin/conversations/recipients${buildQuery({ q })}`)
        .then((rows) => active && setResults(rows))
        .catch((err) => active && setError(errorMessage(err)))
        .finally(() => active && setSearching(false));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  async function open(recipient: Recipient) {
    setOpening(recipient.id);
    setError(null);
    try {
      const conversation = await request<ConversationSummary>("/api/v1/admin/conversations/start", {
        method: "POST",
        body: JSON.stringify({ userId: recipient.id }),
      });
      onOpened(conversation);
    } catch (err) {
      setError(errorMessage(err));
      setOpening(null);
    }
  }

  return (
    <AdminModal title="Écrire à un membre" onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        <TextInput
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nom, e-mail ou téléphone"
          aria-label="Chercher un membre"
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {searching && (
          <p className="flex items-center gap-2 text-sm text-stone-400">
            <Spinner /> Recherche…
          </p>
        )}
        {!searching && results !== null && results.length === 0 && (
          <p className="text-sm text-stone-500">Aucun membre ne correspond.</p>
        )}
        {results && results.length > 0 && (
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
            {results.map((recipient) => {
              const name = personName(recipient) || recipient.email || "Membre";
              return (
                <li key={recipient.id}>
                  <button
                    type="button"
                    disabled={opening !== null}
                    onClick={() => void open(recipient)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04] disabled:opacity-60"
                  >
                    <ChatAvatar name={name} url={recipient.avatarUrl} kind="client" size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-stone-100">{name}</span>
                      <span className="block truncate text-[12px] text-stone-500">
                        {recipient.email ?? ""}
                        {recipient.isSeller ? " · Vendeur" : " · Client"}
                      </span>
                    </span>
                    {opening === recipient.id ? <Spinner /> : <span className="text-[12px] font-medium text-[#ff8a5c]">Écrire</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {results === null && !searching && (
          <p className="text-[12.5px] text-stone-500">Tapez au moins 2 lettres. Le membre reçoit votre message dans sa messagerie, avec une notification.</p>
        )}
      </div>
    </AdminModal>
  );
}
