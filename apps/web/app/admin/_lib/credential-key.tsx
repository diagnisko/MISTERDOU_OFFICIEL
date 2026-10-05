"use client";

import { useState } from "react";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { AdminModal, RowAction } from "./ui";

// ---------------------------------------------------------------------------
// « Clé d'accès » : identifiants d'un compte pour l'équipe (code de
// vérification, aide au client). Chaque affichage est tracé côté serveur.
// ---------------------------------------------------------------------------

type Credential = { title: string; email: string; password: string };

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8f7d77]">{label}</p>
      <div className="mt-1.5 flex items-center gap-2 rounded-[14px] border border-white/10 bg-black/30 px-3.5 py-2.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[14px] text-white">{value}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="shrink-0 text-[12px] font-semibold text-[#ff8a5c] hover:underline"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
    </div>
  );
}

export function CredentialKeyButton({ productId, variant = "row" }: { productId: string; variant?: "row" | "button" }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Credential | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      setData(await request<Credential>(`/api/v1/admin/offerings/${productId}/credential`));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Impossible d'afficher les identifiants.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {variant === "row" ? (
        <RowAction label="Clé d’accès" onClick={() => void show()} />
      ) : (
        <button type="button" onClick={() => void show()} className="dash-btn dash-btn-ghost">
          Clé d’accès
        </button>
      )}
      {open && (
        <AdminModal title={data ? `Clé d’accès — ${data.title}` : "Clé d’accès"} onClose={() => setOpen(false)}>
          {loading ? (
            <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
              <Spinner /> Déchiffrement…
            </p>
          ) : error ? (
            <Alert tone="danger">{error}</Alert>
          ) : data ? (
            <div className="space-y-4">
              <CopyField label="Identifiant de connexion" value={data.email} />
              <CopyField label="Mot de passe" value={data.password} />
              <p className="text-[12px] leading-relaxed text-[#8f7d77]">
                Affichage enregistré dans le journal d’audit. Ne communiquez ces identifiants qu’à l’acheteur du compte.
              </p>
            </div>
          ) : null}
        </AdminModal>
      )}
    </>
  );
}
