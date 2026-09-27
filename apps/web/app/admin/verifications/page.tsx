"use client";

import { useCallback, useEffect, useState } from "react";
import { request } from "@/lib/api";
import { Button, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { AdminPageHead, ErrorAlert, NoticeAlert } from "../_lib/ui";

// ---------------------------------------------------------------------------
// Vérifications d'identité — port de la page console /identity-verification/review
// dans la coquille admin (mêmes routes, mêmes contrôles, mêmes messages).
// GET  /admin/kyc
// POST /admin/kyc/:id/review { status, reason }
// ---------------------------------------------------------------------------

type RecordItem = {
  id: string;
  status: string;
  documentType: string;
  firstName: string;
  lastName: string;
  country: string;
  city: string | null;
  submittedAt: string;
  user: { id: string; email: string | null; phoneNumber: string | null };
};

const FILES = ["front", "back", "passport", "selfie"] as const;

export default function AdminVerificationsPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (successMessage?: string) => {
    const list = await request<RecordItem[]>("/api/v1/admin/kyc");
    setRecords(list);
    setError(null);
    if (successMessage) setNotice(successMessage);
    return list;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh()
      .catch((err) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function manualRefresh() {
    setRefreshing(true);
    setNotice(null);
    try {
      await refresh("Données actualisées.");
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }

  async function review(record: RecordItem, status: "VERIFIED" | "REJECTED") {
    const reason = reasons[record.id]?.trim() || (status === "VERIFIED" ? "Documents validés" : "");
    if (status !== "VERIFIED" && reason.length < 5) {
      setError(
        "Indiquez un motif d’au moins cinq caractères pour demander une correction ou refuser le dossier.",
      );
      return;
    }
    setBusy(record.id);
    setError(null);
    setNotice(null);
    try {
      await request(`/api/v1/admin/kyc/${record.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status, reason }),
      });
      setNotice(`Dossier mis à jour : ${status.toLowerCase().replaceAll("_", " ")}.`);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminPageHead
        kicker="Modération"
        title="Vérifications"
        meta="Les documents ne sont récupérés qu’à l’ouverture, via une route authentifiée et journalisée."
        action={
          <Button variant="outline" loading={refreshing} onClick={() => void manualRefresh()}>
            Actualiser
          </Button>
        }
      />

      <ErrorAlert error={error} />
      <NoticeAlert notice={notice} />

      {loading ? (
        <p className="mt-8 flex items-center gap-3 text-sm text-stone-400">
          <Spinner /> Chargement des dossiers…
        </p>
      ) : records.length === 0 ? (
        <div className="lux-glass mt-8 rounded-[20px] p-6">
          <p className="text-sm text-stone-300">Aucun dossier en attente.</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-5">
          {records.map((record) => (
            <li key={record.id} className="lux-glass rounded-[22px] p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="lux-kicker">
                    Soumis le {new Date(record.submittedAt).toLocaleString("fr-FR")}
                  </p>
                  <h2 className="mt-2 text-xl text-stone-100">
                    {record.firstName} {record.lastName}
                  </h2>
                  <p className="mt-1 text-sm text-stone-400">
                    {record.user.email ?? "Sans e-mail"} · {record.user.phoneNumber ?? "Sans téléphone"}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {record.country}
                    {record.city ? ` · ${record.city}` : ""} ·{" "}
                    {record.documentType === "PASSPORT" ? "Passeport" : "Carte nationale"}
                  </p>
                </div>
                <StatusBadge status={record.status} />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {FILES.map((kind) => (
                  <a
                    key={kind}
                    href={`/api/v1/admin/kyc/${record.id}/files/${kind}`}
                    target="_blank"
                    rel="noreferrer"
                    className="lux-btn lux-btn-ghost !min-h-[38px] !px-3 !text-[10px] uppercase tracking-[0.12em]"
                  >
                    {kind === "front"
                      ? "Recto"
                      : kind === "back"
                        ? "Verso"
                        : kind === "passport"
                          ? "Passeport"
                          : "Visage"}
                  </a>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <TextInput
                  value={reasons[record.id] ?? ""}
                  onChange={(event) =>
                    setReasons((prev) => ({ ...prev, [record.id]: event.target.value }))
                  }
                  placeholder="Motif si correction ou refus requis"
                  maxLength={500}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    loading={busy === record.id}
                    disabled={Boolean(busy)}
                    onClick={() => void review(record, "VERIFIED")}
                  >
                    Valider
                  </Button>
                  <Button
                    variant="outline"
                    loading={busy === record.id}
                    disabled={Boolean(busy)}
                    onClick={() => void review(record, "REJECTED")}
                  >
                    Demander une nouvelle pièce
                  </Button>
                  <Button
                    variant="danger"
                    loading={busy === record.id}
                    disabled={Boolean(busy)}
                    onClick={() => void review(record, "REJECTED")}
                  >
                    Refuser
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
