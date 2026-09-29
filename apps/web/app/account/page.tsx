"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiClientError, request } from "@/lib/api";
import { displayName, refreshAccount, useAccount } from "@/lib/account";
import { putFile } from "@/lib/upload";
import { Avatar } from "@/components/account/account-menu";
import { IconBadgeCheck } from "@/components/dash/dash-icons";
import { useT, type MessageKey } from "@/lib/i18n";

// Statut KYC → message (IN_PROGRESS partage le texte de PENDING).
const kycKey = (status: string): MessageKey =>
  (["VERIFIED", "PENDING", "REJECTED", "RESUBMISSION_REQUIRED"].includes(status)
    ? `kyc.${status}`
    : status === "IN_PROGRESS"
      ? "kyc.PENDING"
      : "kyc.NOT_SUBMITTED") as MessageKey;

const field =
  "w-full min-h-[46px] rounded-xl border border-[rgba(255,236,229,0.1)] bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-[#8a7771] focus:border-[rgba(255,106,50,0.55)] focus:ring-2 focus:ring-[rgba(232,71,36,0.18)] disabled:cursor-not-allowed disabled:opacity-60";

export default function ProfilePage() {
  const t = useT();
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
      setMessage({ tone: "ok", text: t("profile.saved") });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiClientError ? err.message : t("profile.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setMessage(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(t("profile.photoTooBig"));
      const ticket = await request<{ key: string; uploadUrl: string; headers: Record<string, string> }>(
        "/api/v1/account/avatar/upload-url",
        { method: "POST", body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }) },
      );
      await putFile(ticket.uploadUrl, file, ticket.headers);
      await request("/api/v1/account/avatar", { method: "POST", body: JSON.stringify({ key: ticket.key, mimeType: file.type }) });
      await refreshAccount();
      setMessage({ tone: "ok", text: t("profile.photoUpdated") });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("profile.sendFailed") });
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
          {verified ? t("menu.verified") : t("menu.unverified")}
        </span>

        <div className="mt-6 flex flex-col gap-2">
          <label className={`dash-btn dash-btn-ghost cursor-pointer ${photoBusy ? "pointer-events-none opacity-60" : ""}`}>
            {photoBusy ? t("profile.sending") : profile.avatarUrl ? t("profile.changePhoto") : t("profile.addPhoto")}
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
              {t("profile.removePhoto")}
            </button>
          )}
        </div>

        <p className="mt-6 border-t border-[rgba(255,236,229,0.07)] pt-4 text-[12px] text-[#8f7d77]">
          {t("profile.memberSince", { date: new Date(user.createdAt).toLocaleDateString(t.intl, { day: "numeric", month: "long", year: "numeric" }) })}
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
                <h2 className="text-[15px] font-semibold text-white">{t("profile.kycTitle")}</h2>
                <p className="mt-1 max-w-md text-[13px] text-[#b8a6a1]">{t(kycKey(user.kycStatus))}</p>
              </div>
            </div>
            {!verified && (
              <Link href="/identity-verification" className="dash-btn dash-btn-primary">
                {t("profile.verify")}
              </Link>
            )}
          </div>
        </section>

        <form onSubmit={(e) => void save(e)} className="dash-card p-5">
          <h2 className="text-[15px] font-semibold text-white">{t("profile.personal")}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("profile.firstName")}</span>
              <input required maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={field} autoComplete="given-name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("profile.lastName")}</span>
              <input maxLength={100} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={field} autoComplete="family-name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("profile.country")}</span>
              <input maxLength={100} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={field} autoComplete="country-name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("profile.city")}</span>
              <input maxLength={100} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={field} autoComplete="address-level2" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("profile.email")}</span>
              <input value={user.email ?? ""} disabled className={field} />
              <span className="mt-1.5 block text-[12px] text-[#8f7d77]">
                {profile.googleLinked
                  ? t("profile.emailGoogle")
                  : t("profile.emailLocked")}
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
              {saving ? t("profile.saving") : t("profile.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
