"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { request } from "@/lib/api";
import { Button } from "@/components/ui";
import { MediaManager } from "@/components/media/media-manager";
import { buildQuery } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminModal,
  AdminPageHead,
  DataTable,
  ErrorAlert,
  FieldModal,
  FilterTabs,
  NoticeAlert,
  Pagination,
  RowAction,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
  formatCell,
} from "../_lib/ui";
import { OfferReviewModal } from "./offer-review";

// ---------------------------------------------------------------------------
// Offres — port de la vue « offerings » de la console (modération du catalogue).
// GET   /admin/offerings             { page, perPage, q, status }
// PATCH /admin/offerings/:id/status  { status, reason }
// Offres des vendeurs : « À valider » → examen, puis validation ou refus motivé.
// Création et modification : offres MISTERDOU uniquement (/admin/offers/new).
// ---------------------------------------------------------------------------

type OfferingRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  ownerType: string;
  sellerId: string | null;
  basePrice: number;
  paymentMode: string;
  featuredPriceOverride: number | null;
  rejectedReason: string | null;
  sellerName: string | null;
  createdAt: string;
};

type StatusFilter = "all" | "PENDING_REVIEW" | "ACTIVE" | "DRAFT" | "SUSPENDED" | "SOLD";

const COLUMNS = [
  { key: "title", label: "Offre" },
  { key: "sellerName", label: "Vendeur" },
  { key: "basePrice", label: "Prix" },
  { key: "paymentMode", label: "Paiement" },
  { key: "status", label: "Statut" },
  { key: "slug", label: "Identifiant" },
];

export default function OffersPage() {
  return (
    <Suspense>
      <OffersView />
    </Suspense>
  );
}

function OffersView() {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>((params.get("status") as StatusFilter | null) ?? "all");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<{ row: OfferingRow; next: string } | null>(null);
  const [media, setMedia] = useState<OfferingRow | null>(null);

  const list = useAdminList<OfferingRow>(
    `/api/v1/admin/offerings${buildQuery({ page, perPage, q: search || undefined, status: status === "all" ? undefined : status })}`,
  );
  const pendingReview = Number(list.extra.pendingReview ?? 0);

  async function changeStatus(id: string, status: string, reason: string) {
    setBusy(id);
    list.setNotice(null);
    try {
      await request(`/api/v1/admin/offerings/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason }),
      });
      setTarget(null);
      await list.refresh("Modification enregistrée et journalisée.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Gestion de la plateforme"
        title="Offres"
        meta="Catalogue et modération des offres"
        action={
          <div className="flex gap-2">
            <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
              Actualiser
            </Button>
            <Link href="/admin/offers/new" className="dash-btn dash-btn-primary">
              Nouvelle offre
            </Link>
          </div>
        }
      />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Catalogue</p>
          <p className="mt-2 text-sm text-stone-400">Recherche par titre ou identifiant (slug).</p>
        </div>
        <SearchBar
          placeholder="Titre ou slug"
          onSearch={(query) => {
            setSearch(query);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4">
        <FilterTabs
          value={status}
          options={[
            { value: "all", label: "Toutes" },
            { value: "PENDING_REVIEW", label: pendingReview > 0 ? `À valider · ${pendingReview}` : "À valider" },
            { value: "ACTIVE", label: "En ligne" },
            { value: "DRAFT", label: "Refusées / brouillons" },
            { value: "SUSPENDED", label: "Désactivées" },
            { value: "SOLD", label: "Vendues" },
          ]}
          onChange={(value) => {
            setStatus(value as StatusFilter);
            setPage(1);
          }}
        />
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading />
        ) : list.items.length === 0 ? (
          <TableEmpty />
        ) : (
          <DataTable columns={COLUMNS.map((column) => column.label)}>
            {list.items.map((row) => {
              const data = row as unknown as Record<string, unknown>;
              const rowStatus = String(row.status ?? "");
              return (
                <tr key={row.id} className="transition hover:bg-white/[0.025]">
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3.5 text-stone-300">
                      {column.key === "sellerName" ? (
                        row.sellerName ?? <span className="text-[#ffb08a]">MISTERDOU</span>
                      ) : column.key === "status" && status === "DRAFT" && row.rejectedReason ? (
                        <span className="flex flex-col gap-1">
                          {formatCell(data[column.key], column.key)}
                          <span className="max-w-[220px] text-[11.5px] text-[#fca5a5]">Refusée : {row.rejectedReason}</span>
                        </span>
                      ) : (
                        formatCell(data[column.key], column.key)
                      )}
                    </td>
                  ))}
                  <td className="flex gap-2 px-4 py-3.5">
                    {status === "PENDING_REVIEW" && <RowAction label="Examiner" onClick={() => setReviewing(row.id)} />}
                    {row.sellerId === null && rowStatus !== "SOLD" && (
                      <Link href={`/admin/offers/${row.id}`} className="whitespace-nowrap rounded-full border border-current/20 px-2.5 py-1 text-[12px] font-medium text-[#ff8a5c] transition hover:bg-white/[0.04]">
                        Modifier
                      </Link>
                    )}
                    <RowAction label="Médias" tone="muted" onClick={() => setMedia(row)} />
                    {rowStatus !== "PENDING_REVIEW" && (
                      <RowAction
                        label={rowStatus === "ACTIVE" ? "Désactiver" : "Publier"}
                        busy={busy === row.id}
                        onClick={() => setTarget({ row, next: rowStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}
                      />
                    )}
                    {rowStatus === "PENDING_REVIEW" && status !== "PENDING_REVIEW" && (
                      <RowAction label="Examiner" onClick={() => setReviewing(row.id)} />
                    )}
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

      {reviewing && (
        <OfferReviewModal
          productId={reviewing}
          onClose={() => setReviewing(null)}
          onDone={(message) => {
            setReviewing(null);
            void list.refresh(message);
          }}
        />
      )}

      {media && (
        <AdminModal title={`Médias — ${media.title}`} onClose={() => setMedia(null)} width="max-w-2xl">
          <MediaManager productId={media.id} team />
        </AdminModal>
      )}

      {target && (
        <FieldModal
          title={target.next === "SUSPENDED" ? "Désactiver cette offre" : "Publier cette offre"}
          label="Motif de cette action"
          hint="Minimum 5 caractères — le motif est journalisé."
          minLength={5}
          maxLength={300}
          submitLabel={target.next === "SUSPENDED" ? "Désactiver" : "Publier"}
          onClose={() => setTarget(null)}
          onSubmit={(value) => changeStatus(target.row.id, target.next, value)}
        />
      )}
    </>
  );
}
