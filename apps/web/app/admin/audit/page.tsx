"use client";

import { Fragment, useState } from "react";
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, auditActionLabel } from "@misterdou/shared";
import { Button, TextInput, statusLabel } from "@/components/ui";
import { buildQuery, dateInputToIso } from "../_lib/api";
import { useAdminList } from "../_lib/hooks";
import {
  AdminPageHead,
  DataTable,
  ErrorAlert,
  FilterTabs,
  NoticeAlert,
  Pagination,
  SearchBar,
  SeverityBadge,
  TableCard,
  TableEmpty,
  TableLoading,
} from "../_lib/ui";

// ---------------------------------------------------------------------------
// Journal d'activité — GET /admin/audit { page, perPage, category?, from?, to?, q? }
// Chaque action en français simple, rangée par catégorie. « Tout » montre ce
// qui compte (offres, commandes, paiements, équipe…) sans les connexions des
// membres, rangées dans leur propre onglet.
// ---------------------------------------------------------------------------

type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  severity: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  actorRole: string | null;
  metadata: unknown;
  user: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
};

const CATEGORY_TABS = [
  { value: "", label: "Tout" },
  ...Object.entries(AUDIT_CATEGORIES).map(([value, label]) => ({ value, label })),
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrateur",
  STAFF: "Équipe",
  VENDOR: "Vendeur",
  CLIENT: "Client",
};

const RESOURCE_LABELS: Record<string, string> = {
  Product: "Offre",
  Order: "Commande",
  Payment: "Paiement",
  PaymentProof: "Capture de paiement",
  User: "Membre",
  Seller: "Vendeur",
  Withdrawal: "Retrait",
  InstallmentPlan: "Paiement en plusieurs fois",
  Installment: "Mensualité",
  IdentityVerification: "Pièce d’identité",
  SupportTicket: "Demande au support",
  Conversation: "Conversation",
  Settings: "Paramètre",
  ManagerProfile: "Membre de l’équipe",
  Promotion: "Promotion",
  FeaturedProduct: "Mise en avant",
};

// Détails : noms de champs en clair (les autres sont masqués s'ils sont techniques).
const FIELD_LABELS: Record<string, string> = {
  status: "Statut",
  reason: "Motif",
  note: "Note",
  amount: "Montant",
  totalAmount: "Montant total",
  paidTotal: "Déjà payé",
  price: "Prix",
  basePrice: "Prix",
  title: "Titre",
  orderNumber: "Commande",
  key: "Paramètre",
  before: "Avant",
  after: "Après",
  permissions: "Permissions",
  email: "E-mail",
  kind: "Type",
  days: "Jours",
  months: "Mois",
  method: "Moyen",
  reference: "Référence",
  alreadyPaid: "Déjà payé",
  assignedToId: "Responsable",
  by: "Par",
  changes: "Changements",
  fields: "Champs modifiés",
};

const MONEY_FIELDS = new Set(["amount", "totalAmount", "paidTotal", "price", "basePrice", "alreadyPaid"]);

const HIDDEN_FIELDS = new Set(["page", "total", "userId", "ownerId", "sellerId", "productId", "orderId", "conversationId", "sessionId", "mediaId"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shortId(id: string): string {
  return UUID_RE.test(id) ? `n° ${id.slice(0, 8).toUpperCase()}` : id;
}

function plainValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return value.toLocaleString("fr-FR");
  if (typeof value === "string") {
    if (UUID_RE.test(value)) return shortId(value);
    if (/^[A-Z][A-Z_]+$/.test(value)) return statusLabel(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString("fr-FR");
    return value;
  }
  if (Array.isArray(value)) return value.map(plainValue).join(", ") || "—";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("from" in obj && "to" in obj) return `${plainValue(obj.from)} → ${plainValue(obj.to)}`;
    return Object.entries(obj)
      .filter(([k]) => !HIDDEN_FIELDS.has(k))
      .map(([k, v]) => `${FIELD_LABELS[k] ?? k} : ${plainValue(v)}`)
      .join(" · ");
  }
  return String(value);
}

function detailLines(row: AuditRow): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  if (row.resourceType) {
    lines.push(["Concerne", `${RESOURCE_LABELS[row.resourceType] ?? row.resourceType}${row.resourceId ? ` ${shortId(row.resourceId)}` : ""}`]);
  }
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
      if (HIDDEN_FIELDS.has(key)) continue;
      const money = MONEY_FIELDS.has(key) && typeof value === "number";
      lines.push([FIELD_LABELS[key] ?? key, money ? `${value.toLocaleString("fr-FR")} F CFA` : plainValue(value)]);
    }
  }
  if (row.ip) lines.push(["Adresse IP", row.ip]);
  return lines;
}

function actorName(row: AuditRow): string {
  if (row.user) {
    const name = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ");
    return name || row.user.email || "—";
  }
  return row.actorRole ? ROLE_LABELS[row.actorRole] ?? "—" : "Le site (automatique)";
}

export default function AuditPage() {
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useAdminList<AuditRow>(
    `/api/v1/admin/audit${buildQuery({
      page,
      perPage,
      category: category || undefined,
      q: q || undefined,
      from: dateInputToIso(from),
      to: dateInputToIso(to),
    })}`,
  );

  function change(next: () => void) {
    next();
    setPage(1);
    setExpanded(null);
  }

  const filtered = Boolean(q || from || to);

  return (
    <>
      <AdminPageHead
        kicker="Paramètres & équipe"
        title="Journal d’activité"
        meta="Ce qui s’est passé sur le site : offres, commandes, paiements, équipe… Cliquez sur une ligne pour voir le détail."
        action={
          <Button variant="outline" loading={list.refreshing} onClick={() => void list.refresh()}>
            Actualiser
          </Button>
        }
      />

      <div className="mt-6">
        <FilterTabs value={category} options={CATEGORY_TABS} onChange={(value) => change(() => setCategory(value))} />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <SearchBar placeholder="Action, nom ou e-mail" onSearch={(query) => change(() => setQ(query))} />
        <label className="flex items-center gap-2 text-[12px] text-stone-400">
          Du
          <TextInput type="date" value={from} onChange={(event) => change(() => setFrom(event.target.value))} className="!w-auto" />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-stone-400">
          au
          <TextInput type="date" value={to} onChange={(event) => change(() => setTo(event.target.value))} className="!w-auto" />
        </label>
        {(from || to) && (
          <Button type="button" variant="ghost" onClick={() => change(() => { setFrom(""); setTo(""); })}>
            Toutes les dates
          </Button>
        )}
      </div>

      <ErrorAlert error={list.error} />
      <NoticeAlert notice={list.notice} />

      <TableCard>
        {list.loading ? (
          <TableLoading label="Chargement du journal…" />
        ) : list.items.length === 0 ? (
          <TableEmpty label={filtered ? "Rien ne correspond à cette recherche." : "Aucune activité dans cette catégorie pour le moment."} />
        ) : (
          <DataTable columns={["Quand", "Ce qui s’est passé", "Par", "Importance"]} actionLabel="Détail" minWidth={760}>
            {list.items.map((row) => {
              const open = expanded === row.id;
              const meta = AUDIT_ACTIONS[row.action];
              const categoryLabel = meta && meta.category !== "routine" ? AUDIT_CATEGORIES[meta.category] : null;
              const lines = open ? detailLines(row) : [];
              return (
                <Fragment key={row.id}>
                  <tr className="cursor-pointer transition hover:bg-white/[0.025]" onClick={() => setExpanded(open ? null : row.id)}>
                    <td className="whitespace-nowrap px-4 py-3.5 text-stone-400">
                      {new Date(row.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="block text-stone-100">{auditActionLabel(row.action)}</span>
                      {categoryLabel && !category && (
                        <span className="mt-0.5 block text-[11px] text-stone-500">{categoryLabel}</span>
                      )}
                    </td>
                    <td className="max-w-[240px] px-4 py-3.5">
                      <span className="block truncate text-stone-200">{actorName(row)}</span>
                      {row.user && row.actorRole && (
                        <span className="mt-0.5 block text-[11px] text-stone-500">{ROLE_LABELS[row.actorRole] ?? ""}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <SeverityBadge severity={row.severity} />
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpanded(open ? null : row.id);
                        }}
                        className="whitespace-nowrap text-[12px] font-medium text-[#ff8a5c] transition hover:opacity-80"
                      >
                        {open ? "Masquer" : "Voir"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={5} className="bg-black/25 px-4 py-4">
                        {lines.length === 0 ? (
                          <p className="text-sm text-stone-500">Pas d’autre détail pour cette action.</p>
                        ) : (
                          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                            {lines.map(([label, value], index) => (
                              <Fragment key={`${label}-${index}`}>
                                <dt className="text-stone-500">{label}</dt>
                                <dd className="break-words text-stone-200">{value}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
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
    </>
  );
}
