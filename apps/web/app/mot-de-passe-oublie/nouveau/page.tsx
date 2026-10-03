"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import { request, ApiClientError } from "@/lib/api";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";

// Nouveau mot de passe, depuis le lien reçu par e-mail (valable 30 minutes,
// utilisable une seule fois). Toutes les sessions ouvertes sont fermées.
function NewPasswordForm() {
  const t = useT();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t("reset.tooShort"));
    if (password !== confirm) return setError(t("reset.mismatch"));
    setLoading(true);
    try {
      await request("/api/v1/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.network"));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]" role="alert">
        {t("reset.noToken")}{" "}
        <Link href="/mot-de-passe-oublie" className="font-semibold underline">
          {t("reset.again")}
        </Link>
      </p>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3.5 py-3 text-sm text-stone-200" role="status">
          {t("reset.done")}
        </p>
        <Link href="/login" className="lux-btn lux-btn-gold w-full">
          {t("auth.login")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <label className="block">
        <span className={fieldLabelClass}>{t("reset.newPassword")}</span>
        <input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className={fieldLabelClass}>{t("reset.confirm")}</span>
        <input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
      </label>
      {error && (
        <p className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="lux-btn lux-btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60" aria-busy={loading}>
        {loading ? t("reset.saving") : t("reset.save")}
      </button>
    </form>
  );
}

export default function NewPasswordPage() {
  const t = useT();
  return (
    <AuthShell kicker={t("auth.memberArea")} title={t("reset.newTitle")} lead={t("reset.newLead")}>
      <Suspense fallback={null}>
        <NewPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
