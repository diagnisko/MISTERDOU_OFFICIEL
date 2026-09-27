"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { buildQuery } from "../_lib/api";
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
import {
  excerpt,
  initials,
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
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
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
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[rgba(245,215,142,0.28)] bg-[rgba(245,158,11,0.12)] text-[10px] font-bold text-[var(--lux-gold-light)]"
                        aria-hidden
                      >
                        {initials(participantsLabel(row))}
                      </span>
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
                      <span className="grid min-w-[20px] place-items-center rounded-full bg-[linear-gradient(120deg,#f5d78e,#f59e0b_45%,#d97706)] px-1.5 py-0.5 text-[10px] font-bold text-[#1c1303]">
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
