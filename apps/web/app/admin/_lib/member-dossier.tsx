"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatXof, request } from "@/lib/api";
import { Alert, Spinner, StatusBadge } from "@/components/ui";
import { errorMessage } from "./api";
import { AdminModal } from "./ui";

// Fiche d'un client ou d'un vendeur : identité, coordonnées, pièces d'identité
// (ouvertes par le serveur, consultation journalisée), commandes, compte vendeur.

type Verification = {
  id: string;
  status: string;
  documentType: "NATIONAL_ID" | "PASSPORT";
  firstName: string;
  lastName: string;
  birthDate: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  files: Array<"front" | "back" | "passport" | "selfie">;
};

type Dossier = {
  id: string;
  email: string | null;
  googleEmail: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  status: string;
  kycStatus: string;
  verifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  role: string;
  _count: { orders: number };
  seller: {
    id: string;
    status: string;
    sellerSince: string | null;
    registrationFee: number;
    registrationPaidAt: string | null;
    sellerBalance: { balanceAvailable: number; balancePending: number; totalEarnings: number } | null;
    _count: { product: number };
  } | null;
  verifications: Verification[];
};

const FILE_LABEL: Record<string, string> = { front: "Recto", back: "Verso", passport: "Passeport", selfie: "Selfie" };
const DOC_LABEL: Record<string, string> = { NATIONAL_ID: "Carte d'identité", PASSPORT: "Passeport" };

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—");

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-[13px]">
      <dt className="text-stone-400">{label}</dt>
      <dd className="text-right text-stone-100">{children || "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#ff8a5c]">{title}</h3>
      {children}
    </section>
  );
}

export function MemberDossierModal({ url, onClose, actions }: { url: string; onClose: () => void; actions?: ReactNode }) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<Dossier>(url).then(setDossier).catch((err: unknown) => setError(errorMessage(err)));
  }, [url]);

  const name = dossier ? [dossier.firstName, dossier.lastName].filter(Boolean).join(" ") || dossier.email || "Membre" : "Fiche";

  return (
    <AdminModal title={name} onClose={onClose} width="max-w-2xl">
      {error && <Alert tone="danger">{error}</Alert>}
      {!dossier && !error && (
        <p className="flex items-center gap-2 text-sm text-stone-400">
          <Spinner /> Chargement de la fiche…
        </p>
      )}
      {dossier && (
        <div className="space-y-4">
          <Section title="Identité et contact">
            <dl>
              <Row label="Nom">{[dossier.firstName, dossier.lastName].filter(Boolean).join(" ")}</Row>
              <Row label="E-mail">{dossier.email}</Row>
              {dossier.googleEmail && dossier.googleEmail !== dossier.email && <Row label="Compte Google">{dossier.googleEmail}</Row>}
              <Row label="Téléphone">{dossier.phoneNumber ? `${dossier.countryCode ?? ""} ${dossier.phoneNumber}`.trim() : ""}</Row>
              <Row label="Date de naissance">{dossier.birthDate ? date(dossier.birthDate) : ""}</Row>
              <Row label="Adresse">{[dossier.address, dossier.city, dossier.country].filter(Boolean).join(", ")}</Row>
              <Row label="Compte">
                <StatusBadge status={dossier.status} />
              </Row>
              <Row label="Inscrit le">{date(dossier.createdAt)}</Row>
              <Row label="Dernière connexion">{date(dossier.lastLoginAt)}</Row>
              <Row label="Commandes">{String(dossier._count.orders)}</Row>
            </dl>
          </Section>

          <Section title="Vérification d'identité">
            {dossier.verifications.length === 0 ? (
              <p className="text-[13px] text-stone-400">Aucune pièce envoyée.</p>
            ) : (
              <div className="space-y-4">
                {dossier.verifications.map((v) => (
                  <div key={v.id} className="border-t border-white/[0.06] pt-3 first:border-0 first:pt-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[13px] text-stone-200">
                        {DOC_LABEL[v.documentType]} · envoyé le {date(v.submittedAt)}
                      </p>
                      <StatusBadge status={v.status} />
                    </div>
                    <dl className="mt-2">
                      <Row label="Nom sur la pièce">{`${v.firstName} ${v.lastName}`}</Row>
                      <Row label="Date de naissance">{v.birthDate ? date(v.birthDate) : ""}</Row>
                      <Row label="Adresse">{[v.address, v.city, v.country].filter(Boolean).join(", ")}</Row>
                      {v.rejectionReason && <Row label="Motif du refus">{v.rejectionReason}</Row>}
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {v.files.map((kind) => (
                        <a
                          key={kind}
                          href={`/api/v1/admin/kyc/${v.id}/files/${kind}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-[#ff8a5c] transition hover:bg-white/[0.05]"
                        >
                          Voir : {FILE_LABEL[kind]}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {dossier.seller && (
            <Section title="Compte vendeur">
              <dl>
                <Row label="Statut">
                  <StatusBadge status={dossier.seller.status} />
                </Row>
                <Row label="Vendeur depuis">{date(dossier.seller.sellerSince)}</Row>
                <Row label="Adhésion payée">
                  {dossier.seller.registrationPaidAt ? `${formatXof(dossier.seller.registrationFee)} le ${date(dossier.seller.registrationPaidAt)}` : "Non"}
                </Row>
                <Row label="Offres publiées">{String(dossier.seller._count.product)}</Row>
                <Row label="Solde disponible">{formatXof(dossier.seller.sellerBalance?.balanceAvailable ?? 0)}</Row>
                <Row label="Solde en attente">{formatXof(dossier.seller.sellerBalance?.balancePending ?? 0)}</Row>
                <Row label="Gains totaux">{formatXof(dossier.seller.sellerBalance?.totalEarnings ?? 0)}</Row>
              </dl>
            </Section>
          )}
        </div>
      )}
      {actions && <div className="mt-6 border-t border-white/[0.06] pt-4">{actions}</div>}
    </AdminModal>
  );
}
