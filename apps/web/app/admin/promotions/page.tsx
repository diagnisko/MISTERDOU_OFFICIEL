"use client";

import { useEffect, useState } from "react";
import { formatXof, request } from "@/lib/api";
import { Alert, Button, StatusBadge, TextInput } from "@/components/ui";
import { buildQuery, requestPaged } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminModal,
  AdminPageHead,
  ConfirmDialog,
  DataTable,
  ErrorAlert,
  FieldModal,
  NoticeAlert,
  Pagination,
  RowAction,
  SearchBar,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Promotions & mises en avant — modules P9.
// GET    /admin/promotions          { page, perPage, q }
// POST   /admin/promotions          (createPromotionBody : productId, title?,
//                                    promoPrice?/discountPercent?, startsAt, endsAt)
// POST   /admin/promotions/:id/cancel
// GET    /admin/featured            { page, perPage, status?=PENDING }
// POST   /admin/featured/:id/approve | /reject { reason }
// Les mises en avant achetées par les vendeurs s'activent quand l'équipe les valide.
// ---------------------------------------------------------------------------

type OfferingRow = { id: string; slug: string; title: string; basePrice: number; status: string };

type PromotionRow = {
  id: string;
  title: string;
  promoPrice: number | null;
  discountPercent: number | null;
  startsAt: string;
  endsAt: string;
  status: string;
  createdAt: string;
  createdById: string | null;
  product: { id: string; slug: string; title: string; basePrice: number };
};

type FeaturedRow = {
  id: string;
  days: number;
  dailyRate: number;
  totalPaid: number;
  status: string;
  startedAt: string;
  expiresAt: string;
  createdAt: string;
  product: { id: string; slug: string; title: string };
  purchasedBy: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  payment: { paymentNumber: string; status: string; provider: string; pendingProofId: string | null } | null;
};

/** Où en est le paiement d'une demande : ce que l'équipe doit savoir avant de valider. */
function paymentState(row: FeaturedRow): { label: string; ready: boolean } {
  const p = row.payment;
  if (!p) return { label: "Offerte par l’équipe", ready: false };
  if (p.status === "SUCCESS") return { label: p.provider === "BALANCE" ? "Payée par le solde" : "Paiement encaissé", ready: true };
  if (p.pendingProofId) return { label: "Preuve Wave envoyée", ready: true };
  return { label: "En attente du paiement Wave", ready: false };
}

export default function PromotionsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PromotionRow | null>(null);

  const [featuredPage, setFeaturedPage] = useState(1);
  const [featuredPerPage, setFeaturedPerPage] = useState(10);

  const promos = useAdminList<PromotionRow>(
    `/api/v1/admin/promotions${buildQuery({
      page,
      perPage,
      q: search || undefined,
    })}`,
  );
  const featured = useAdminList<FeaturedRow>(
    `/api/v1/admin/featured${buildQuery({ page: featuredPage, perPage: featuredPerPage })}`,
  );
  const requests = useAdminList<FeaturedRow>(`/api/v1/admin/featured${buildQuery({ status: "PENDING", page: 1, perPage: 50 })}`);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<FeaturedRow | null>(null);

  async function approveRequest(row: FeaturedRow) {
    setBusyId(row.id);
    try {
      await request(`/api/v1/admin/featured/${row.id}/approve`, { method: "POST", body: "{}" });
      await Promise.all([requests.refresh(`Mise en avant de « ${row.product.title} » validée.`), featured.refresh()]);
    } catch (err) {
      requests.setError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function rejectRequest(row: FeaturedRow, reason: string) {
    await request(`/api/v1/admin/featured/${row.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    setRejectTarget(null);
    await Promise.all([requests.refresh("Demande refusée, le vendeur est prévenu."), featured.refresh()]);
  }

  async function createPromotion(payload: unknown) {
    await request("/api/v1/admin/promotions", { method: "POST", body: JSON.stringify(payload) });
    setCreateOpen(false);
    await promos.refresh("Promotion créée.");
  }

  async function cancelPromotion(row: PromotionRow) {
    await request(`/api/v1/admin/promotions/${row.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setCancelTarget(null);
    await promos.refresh("Promotion annulée.");
  }

  return (
    <>
      <AdminPageHead
        kicker="Visibilité"
        title="Promotions"
        meta="Baisses de prix datées sur les offres MISTERDOU, et validation des mises en avant achetées par les vendeurs."
        action={
          <>
            <Button variant="outline" loading={promos.refreshing} onClick={() => void promos.refresh()}>
              Actualiser
            </Button>
            <Button onClick={() => setCreateOpen(true)}>Créer une promotion</Button>
          </>
        }
      />

      <ErrorAlert error={promos.error} />
      <NoticeAlert notice={promos.notice} />

      {/* Demandes des vendeurs : rien n'est visible avant la validation de l'équipe. */}
      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="lux-kicker">Mises en avant à valider</p>
            <p className="mt-2 max-w-2xl text-sm text-stone-400">
              Le vendeur a choisi son offre et sa durée, puis payé. Vérifiez l’offre (et la preuve Wave le cas échéant) :
              la mise en avant démarre à votre validation. Un refus rembourse le solde du vendeur.
            </p>
          </div>
          <Button variant="outline" loading={requests.refreshing} onClick={() => void requests.refresh()}>
            Actualiser
          </Button>
        </div>
        <ErrorAlert error={requests.error} />
        <NoticeAlert notice={requests.notice} />
        {requests.loading ? (
          <TableCard>
            <TableLoading label="Chargement des demandes…" />
          </TableCard>
        ) : requests.items.length === 0 ? (
          <TableCard>
            <TableEmpty label="Aucune demande en attente." />
          </TableCard>
        ) : (
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {requests.items.map((row) => {
              const state = paymentState(row);
              const seller = [row.purchasedBy?.firstName, row.purchasedBy?.lastName].filter(Boolean).join(" ") || row.purchasedBy?.email || "Vendeur";
              return (
                <li key={row.id} className="dash-card p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={`/catalogue/${row.product.slug}`} target="_blank" rel="noopener noreferrer" className="block truncate text-[15px] font-semibold text-white hover:text-[#ffb08a]">
                        {row.product.title}
                      </a>
                      <p className="mt-0.5 truncate text-[12px] text-[#8f7d77]">{seller}</p>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="block text-[17px] font-semibold tabular-nums text-white">{formatXof(Number(row.totalPaid))}</span>
                      <span className="text-[12px] text-[#b8a6a1]">{row.days} jour{row.days > 1 ? "s" : ""}</span>
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                    <span className={`dash-pill ${state.ready ? "dash-pill-paid" : "dash-pill-due"}`}>{state.label}</span>
                    {row.payment?.pendingProofId && (
                      <a
                        href={`/api/v1/admin/payment-proofs/${row.payment.pendingProofId}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#ff8a5c] hover:underline"
                      >
                        Voir la capture Wave
                      </a>
                    )}
                    <span className="text-[#6f5f5a]">· demandé le {new Date(row.createdAt).toLocaleDateString("fr-FR")}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button className="flex-1" loading={busyId === row.id} disabled={!state.ready || busyId !== null} onClick={() => void approveRequest(row)}>
                      Valider
                    </Button>
                    <Button variant="outline" className="flex-1" disabled={busyId !== null} onClick={() => setRejectTarget(row)}>
                      Refuser
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-12 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Promotions</p>
          <p className="mt-2 text-sm text-stone-400">Recherche par titre de promo ou offre associée.</p>
        </div>
        <SearchBar
          placeholder="Titre ou produit"
          onSearch={(query) => {
            setSearch(query);
            setPage(1);
          }}
        />
      </div>

      <TableCard>
        {promos.loading ? (
          <TableLoading label="Chargement des promotions…" />
        ) : promos.items.length === 0 ? (
          <TableEmpty label="Aucune promotion pour ce filtre." />
        ) : (
          <DataTable columns={["Produit", "Promotion", "Prix promo", "Réduction", "Fenêtre", "Statut"]} minWidth={940}>
            {promos.items.map((row) => (
              <tr key={row.id} className="transition hover:bg-white/[0.025]">
                <td className="max-w-[200px] truncate px-4 py-3.5 text-stone-200">{row.product.title}</td>
                <td className="max-w-[200px] truncate px-4 py-3.5 text-stone-300">{row.title}</td>
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                  {row.promoPrice ? formatXof(Number(row.promoPrice)) : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                  {row.discountPercent ? `${row.discountPercent} %` : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {new Date(row.startsAt).toLocaleDateString("fr-FR")} →{" "}
                  {new Date(row.endsAt).toLocaleDateString("fr-FR")}
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3.5">
                  {row.status === "CANCELLED" ? (
                    <span className="text-stone-600">—</span>
                  ) : (
                    <RowAction label="Annuler" tone="danger" onClick={() => setCancelTarget(row)} />
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </TableCard>

      <Pagination
        meta={promos.meta}
        onPage={setPage}
        onPerPage={(size) => {
          setPerPage(size);
          setPage(1);
        }}
      />


      <div className="mt-12 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-kicker">Historique des mises en avant</p>
          <p className="mt-2 text-sm text-stone-400">Toutes les demandes, validées, refusées ou terminées.</p>
        </div>
        <Button variant="outline" loading={featured.refreshing} onClick={() => void featured.refresh()}>
          Actualiser
        </Button>
      </div>

      <ErrorAlert error={featured.error} />

      <TableCard>
        {featured.loading ? (
          <TableLoading label="Chargement des mises en avant…" />
        ) : featured.items.length === 0 ? (
          <TableEmpty label="Aucune mise en avant enregistrée." />
        ) : (
          <DataTable columns={["Produit", "Jours", "Montant", "Statut", "Début", "Fin"]} minWidth={820} actionLabel={null}>
            {featured.items.map((row) => (
              <tr key={row.id} className="transition hover:bg-white/[0.025]">
                <td className="max-w-[220px] truncate px-4 py-3.5 text-stone-200">{row.product.title}</td>
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">{row.days}</td>
                <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-stone-300">
                  {formatXof(Number(row.totalPaid))}
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={row.status} />
                </td>
                {/* Une demande pas encore validée n'a pas de dates réelles. */}
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {row.status === "PENDING" ? "—" : new Date(row.startedAt).toLocaleDateString("fr-FR")}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                  {row.status === "PENDING" ? "—" : new Date(row.expiresAt).toLocaleDateString("fr-FR")}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </TableCard>

      <Pagination
        meta={featured.meta}
        onPage={setFeaturedPage}
        onPerPage={(size) => {
          setFeaturedPerPage(size);
          setFeaturedPage(1);
        }}
      />

      {createOpen && <CreatePromotionModal onClose={() => setCreateOpen(false)} onSubmit={createPromotion} />}

      {rejectTarget && (
        <FieldModal
          title="Refuser la mise en avant"
          label="Motif communiqué au vendeur"
          placeholder="Ex. : photos de l’offre trompeuses"
          minLength={3}
          maxLength={300}
          submitLabel="Refuser"
          onClose={() => setRejectTarget(null)}
          onSubmit={(reason) => rejectRequest(rejectTarget, reason)}
        />
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Annuler cette promotion"
          danger
          confirmLabel="Annuler la promotion"
          message={
            <>
              Annuler la promotion <strong className="text-stone-100">« {cancelTarget.title} »</strong> sur{" "}
              {cancelTarget.product.title} ? Le prix normal reprend immédiatement.
            </>
          }
          onClose={() => setCancelTarget(null)}
          onConfirm={() => cancelPromotion(cancelTarget)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CreatePromotionModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: unknown) => Promise<void>;
}) {
  const [offerings, setOfferings] = useState<OfferingRow[] | null>(null);
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [promoPrice, setPromoPrice] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    requestPaged<OfferingRow>(`/api/v1/admin/offerings${buildQuery({ page: 1, perPage: 100, owner: "platform" })}`)
      .then((result) => {
        if (active) setOfferings(result.items);
      })
      .catch(() => {
        if (active) setOfferings([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = offerings?.find((item) => item.id === productId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!productId) {
      setError("Sélectionnez une offre.");
      return;
    }
    if (title.trim() && (title.trim().length < 3 || title.trim().length > 120)) {
      setError("Le titre de la promotion doit comporter entre 3 et 120 caractères.");
      return;
    }
    const price = promoPrice.trim() ? Number(promoPrice) : null;
    const percent = discountPercent.trim() ? Number(discountPercent) : null;
    if (price === null && percent === null) {
      setError("Indiquez un prix promo ou un pourcentage de remise.");
      return;
    }
    if (price !== null && (!Number.isInteger(price) || price <= 0)) {
      setError("Le prix promo doit être un entier strictement positif.");
      return;
    }
    if (price !== null && selected && selected.basePrice > 0 && price >= selected.basePrice) {
      setError(`Le prix promo doit être strictement inférieur à ${formatXof(selected.basePrice)}.`);
      return;
    }
    if (percent !== null && (percent < 1 || percent > 99)) {
      setError("Le pourcentage de remise doit être compris entre 1 et 99.");
      return;
    }
    const start = startsAt ? new Date(startsAt) : null;
    const end = endsAt ? new Date(endsAt) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError("Indiquez la date de début et la date de fin.");
      return;
    }
    if (start.getTime() >= end.getTime()) {
      setError("La fin de la promo doit être postérieure à son début.");
      return;
    }
    if (end.getTime() <= Date.now()) {
      setError("La fenêtre de la promo est déjà passée.");
      return;
    }

    const payload: Record<string, unknown> = {
      productId,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    if (title.trim()) payload.title = title.trim();
    if (price !== null) payload.promoPrice = price;
    if (percent !== null) payload.discountPercent = percent;

    setPending(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal title="Créer une promotion" onClose={onClose} width="max-w-xl">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div>
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Offre <span className="ml-1 text-[var(--lux-gold, #ff6a32)]">*</span>
          </span>
          {offerings === null ? (
            <p className="text-sm text-stone-500">Chargement des offres…</p>
          ) : offerings.length > 0 ? (
            <OfferPicker offerings={offerings} value={productId} onChange={setProductId} />
          ) : (
            <TextInput
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              placeholder="Identifiant (UUID) de l’offre"
            />
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
            Titre de la promotion (optionnel)
          </span>
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Soldes de rentrée"
            maxLength={120}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
              Prix promo (FCFA)
            </span>
            <TextInput
              type="number"
              min={1}
              value={promoPrice}
              onChange={(event) => setPromoPrice(event.target.value)}
              placeholder="ex. 45000"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
              Remise (%)
            </span>
            <TextInput
              type="number"
              min={1}
              max={99}
              value={discountPercent}
              onChange={(event) => setDiscountPercent(event.target.value)}
              placeholder="ex. 15"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
              Début <span className="ml-1 text-[var(--lux-gold, #ff6a32)]">*</span>
            </span>
            <TextInput type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
              Fin <span className="ml-1 text-[var(--lux-gold, #ff6a32)]">*</span>
            </span>
            <TextInput type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
        </div>

        <p className="text-[11px] leading-relaxed text-stone-500">
          Au moins un prix promo ou un pourcentage de remise est requis — mêmes règles que l’API.
        </p>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button type="submit" loading={pending}>
            Créer la promotion
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// Choix de l'offre : recherche + liste lisible (titre, prix, statut) au lieu de
// la longue liste déroulante du navigateur.
// ---------------------------------------------------------------------------

function OfferPicker({
  offerings,
  value,
  onChange,
}: {
  offerings: OfferingRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? offerings.filter((item) => item.title.toLowerCase().includes(needle) || item.slug.toLowerCase().includes(needle))
    : offerings;
  // Titres en double : un repère court les distingue.
  const titleCount = new Map<string, number>();
  for (const item of offerings) titleCount.set(item.title, (titleCount.get(item.title) ?? 0) + 1);
  const selected = offerings.find((item) => item.id === value);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
      <div className="border-b border-white/[0.07] p-2">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Rechercher parmi ${offerings.length} offres`}
          aria-label="Rechercher une offre"
          className="!rounded-xl !border-transparent !bg-white/[0.04]"
        />
      </div>
      {/* Colonne minmax(0,1fr) : les titres longs se coupent au lieu d'élargir la fenêtre. */}
      <ul role="listbox" aria-label="Offres" className="grid max-h-60 grid-cols-[minmax(0,1fr)] overflow-y-auto py-1">
        {shown.length === 0 ? (
          <li className="px-4 py-3 text-sm text-stone-500">Aucune offre ne correspond.</li>
        ) : (
          shown.map((item) => {
            const active = item.id === value;
            return (
              <li key={item.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => onChange(item.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                    active ? "bg-[rgba(232,71,36,0.16)]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                      active ? "border-[#ff8a5c] bg-[#ff8a5c]" : "border-white/25"
                    }`}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-[#1a0503]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] font-medium ${active ? "text-white" : "text-stone-100"}`}>
                      {item.title}
                    </span>
                    {(titleCount.get(item.title) ?? 0) > 1 && (
                      <span className="block text-[11px] text-stone-500">Réf. {item.id.slice(0, 8).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-[#ffb08a]">{formatXof(item.basePrice)}</span>
                  <span className="hidden shrink-0 sm:inline">
                    <StatusBadge status={item.status} />
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      {selected && (
        <p className="border-t border-white/[0.07] px-4 py-2 text-[12px] text-stone-400">
          Choisie : <span className="text-stone-200">{selected.title}</span> · {formatXof(selected.basePrice)}
        </p>
      )}
    </div>
  );
}
