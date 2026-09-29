"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiClientError, request } from "@/lib/api";
import { displayName, refreshAccount, useAccount } from "@/lib/account";
import { putFile } from "@/lib/upload";
import { Avatar } from "@/components/account/account-menu";
import { IconBadgeCheck } from "@/components/dash/dash-icons";

const KYC_TEXT: Record<string, string> = {
  VERIFIED: "Votre identité est vérifiée : vous pouvez acheter librement.",
  PENDING: "Votre dossier est en cours d’examen par notre équipe.",
  IN_PROGRESS: "Votre dossier est en cours d’examen par notre équipe.",
  REJECTED: "Votre dossier a été refusé : consultez le motif et renvoyez vos pièces.",
  RESUBMISSION_REQUIRED: "Une pièce doit être renvoyée pour terminer la vérification.",
  NOT_SUBMITTED: "Vérifiez votre identité une fois pour pouvoir acheter.",
};

const field =
  "w-full min-h-[46px] rounded-xl border border-[rgba(255,236,229,0.1)] bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-[#8a7771] focus:border-[rgba(255,106,50,0.55)] focus:ring-2 focus:ring-[rgba(232,71,36,0.18)] disabled:cursor-not-allowed disabled:opacity-60";

export default function ProfilePage() {
  const account = useAccount();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", country: "", city: "" });
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (account.status !== "member") return;
    setForm({
      firstName: account.user.firstName ?? "",
      lastName: account.user.lastName ?? "",
      country: account.profile.country ?? "",
      city: account.profile.city ?? "",
    });
  }, [account]);

  if (account.status !== "member") return null;
  const { user, profile } = account;
  const verified = user.kycStatus === "VERIFIED";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await request("/api/v1/account/profile", { method: "PATCH", body: JSON.stringify(form) });
      await refreshAccount();
      setMessage({ tone: "ok", text: "Profil enregistré." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiClientError ? err.message : "Enregistrement impossible." });
    } finally {
      setSaving(false);
    }
  }

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setMessage(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Photo trop lourde : 2 Mo maximum.");
      const ticket = await request<{ key: string; uploadUrl: string; headers: Record<string, string> }>(
        "/api/v1/account/avatar/upload-url",
        { method: "POST", body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }) },
      );
      await putFile(ticket.uploadUrl, file, ticket.headers);
      await request("/api/v1/account/avatar", { method: "POST", body: JSON.stringify({ key: ticket.key, mimeType: file.type }) });
      await refreshAccount();
      setMessage({ tone: "ok", text: "Photo de profil mise à jour." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Envoi impossible." });
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await request("/api/v1/account/avatar", { method: "DELETE", body: JSON.stringify({}) });
      await refreshAccount();
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="dash-card p-6 text-center">
        <div className="mx-auto w-fit">
          <Avatar user={user} url={profile.avatarUrl} size={112} />
        </div>
        <h1 className="mt-4 text-[22px] font-semibold text-white">{displayName(user)}</h1>
        <p className="mt-1 truncate text-[13px] text-[#8f7d77]">{user.email}</p>
        <span className={`dash-pill mt-3 ${verified ? "dash-pill-paid" : "dash-pill-due"}`}>
          {verified ? "Identité vérifiée" : "Identité non vérifiée"}
        </span>

        <div className="mt-6 flex flex-col gap-2">
          <label className={`dash-btn dash-btn-ghost cursor-pointer ${photoBusy ? "pointer-events-none opacity-60" : ""}`}>
            {photoBusy ? "Envoi…" : profile.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => void changePhoto(e.target.files?.[0])}
            />
          </label>
          {profile.avatarUrl && (
            <button type="button" onClick={() => void removePhoto()} disabled={photoBusy} className="text-[12px] text-[#8f7d77] hover:text-white">
              Retirer la photo
            </button>
          )}
        </div>

        <p className="mt-6 border-t border-[rgba(255,236,229,0.07)] pt-4 text-[12px] text-[#8f7d77]">
          Membre depuis le {new Date(user.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </section>

      <div className="space-y-5">
        <section className={`dash-card p-5 ${verified ? "" : "border-[rgba(255,106,50,0.35)]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="dash-icon">
                <IconBadgeCheck size={18} />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-white">Vérification d’identité</h2>
                <p className="mt-1 max-w-md text-[13px] text-[#b8a6a1]">{KYC_TEXT[user.kycStatus] ?? KYC_TEXT.NOT_SUBMITTED}</p>
              </div>
            </div>
            {!verified && (
              <Link href="/identity-verification" className="dash-btn dash-btn-primary">
                Vérifier mon compte
              </Link>
            )}
          </div>
        </section>

        <form onSubmit={(e) => void save(e)} className="dash-card p-5">
          <h2 className="text-[15px] font-semibold text-white">Informations personnelles</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">Prénom</span>
              <input required maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={field} autoComplete="given-name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">Nom</span>
              <input maxLength={100} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={field} autoComplete="family-name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">Pays</span>
              <input maxLength={100} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={field} autoComplete="country-name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">Ville</span>
              <input maxLength={100} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={field} autoComplete="address-level2" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">E-mail</span>
              <input value={user.email ?? ""} disabled className={field} />
              <span className="mt-1.5 block text-[12px] text-[#8f7d77]">
                {profile.googleLinked
                  ? "Adresse fournie par votre compte Google : elle ne peut pas être modifiée."
                  : "L’e-mail sert à vous connecter : il ne peut pas être modifié."}
              </span>
            </label>
          </div>

          {message && (
            <p role={message.tone === "error" ? "alert" : "status"} className={`mt-4 text-[13px] ${message.tone === "error" ? "text-[#fca5a5]" : "text-[#86efac]"}`}>
              {message.text}
            </p>
          )}

          <div className="mt-5 flex justify-end">
            <button type="submit" disabled={saving} className="dash-btn dash-btn-primary">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
