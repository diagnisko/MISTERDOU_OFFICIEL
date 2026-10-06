"use client";

import { useState } from "react";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Button, Spinner, TextInput } from "@/components/ui";
import { AdminModal, RowAction } from "./ui";

// ---------------------------------------------------------------------------
// « Clé d'accès » : identifiants d'un compte pour l'équipe.
// • Afficher (chaque affichage est tracé côté serveur).
// • Saisir ou remplacer, à TOUT moment — même offre vendue ou en mensualités :
//   l'acheteur qui a déjà accès la voit aussitôt dans sa commande et en est prévenu.
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

export function CredentialKeyButton({
  productId,
  variant = "row",
  missing = false,
}: {
  productId: string;
  variant?: "row" | "button";
  /** Identifiants absents : le bouton le signale et la fenêtre ouvre directement la saisie. */
  missing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Credential | null>(null);
  const [editing, setEditing] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setNotice(null);
    setEditing(false);
    try {
      setData(await request<Credential>(`/api/v1/admin/offerings/${productId}/credential`));
    } catch (err) {
      // Aucun identifiant enregistré : on passe directement à la saisie.
      if (err instanceof ApiClientError && err.code === "NOT_FOUND") {
        setData(null);
        setEditing(true);
      } else {
        setError(err instanceof ApiClientError ? err.message : "Impossible d'afficher les identifiants.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginId.trim().length < 3 || !password) {
      setError("Indiquez l’identifiant de connexion (3 caractères minimum) et le mot de passe du compte.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await request<{ replaced: boolean; notifiedBuyers: number }>(`/api/v1/admin/offerings/${productId}/credential`, {
        method: "PUT",
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      setNotice(
        res.notifiedBuyers > 0
          ? `Clé d’accès enregistrée. L’acheteur la voit maintenant dans sa commande et vient d’être prévenu.`
          : "Clé d’accès enregistrée. Elle sera remise à l’acheteur dès que son paiement (ou son apport) sera validé.",
      );
      setLoginId("");
      setPassword("");
      setData(await request<Credential>(`/api/v1/admin/offerings/${productId}/credential`));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const label = missing ? "Ajouter la clé d’accès" : "Clé d’accès";

  return (
    <>
      {variant === "row" ? (
        <RowAction label={label} tone={missing ? "danger" : undefined} onClick={() => void show()} />
      ) : (
        <button type="button" onClick={() => void show()} className="dash-btn dash-btn-ghost">
          {label}
        </button>
      )}
      {open && (
        <AdminModal title={data ? `Clé d’accès — ${data.title}` : "Clé d’accès"} onClose={() => setOpen(false)}>
          {loading ? (
            <p className="flex items-center gap-3 text-sm text-[#b8a6a1]">
              <Spinner /> Déchiffrement…
            </p>
          ) : (
            <div className="space-y-4">
              {notice && <Alert tone="success">{notice}</Alert>}
              {data && !editing && (
                <>
                  <CopyField label="Identifiant de connexion" value={data.email} />
                  <CopyField label="Mot de passe" value={data.password} />
                  <p className="text-[12px] leading-relaxed text-[#8f7d77]">
                    Affichage enregistré dans le journal d’audit. Ne communiquez ces identifiants qu’à l’acheteur du compte.
                  </p>
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => setEditing(true)}>
                      Remplacer les identifiants
                    </Button>
                  </div>
                </>
              )}
              {editing && (
                <form onSubmit={(event) => void save(event)} className="space-y-3">
                  {!data && (
                    <Alert tone="warning">
                      Aucun identifiant n’est enregistré pour ce compte : l’acheteur ne peut rien voir tant qu’ils ne sont pas saisis ici.
                    </Alert>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                      Identifiant de connexion (e-mail ou ID)
                    </span>
                    <TextInput value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="off" autoFocus />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                      Mot de passe du compte
                    </span>
                    <TextInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
                  </label>
                  <p className="text-[12px] leading-relaxed text-[#8f7d77]">
                    Chiffrés dès l’enregistrement. Possible à tout moment, même si le compte est vendu ou payé en mensualités :
                    l’acheteur les voit aussitôt dans sa commande.
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {data && (
                      <Button variant="ghost" type="button" onClick={() => setEditing(false)} disabled={saving}>
                        Annuler
                      </Button>
                    )}
                    <Button type="submit" loading={saving}>
                      Enregistrer la clé d’accès
                    </Button>
                  </div>
                </form>
              )}
              {error && <Alert tone="danger">{error}</Alert>}
            </div>
          )}
        </AdminModal>
      )}
    </>
  );
}
