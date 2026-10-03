"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { request, ApiClientError } from "@/lib/api";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";

// Mot de passe oublié : le lien de réinitialisation part par e-mail. La réponse
// est identique que le compte existe ou non (aucune information divulguée).
export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await request("/api/v1/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.network"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell kicker={t("auth.memberArea")} title={t("reset.forgotTitle")} lead={t("reset.forgotLead")}>
      {sent ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3.5 py-3 text-sm text-stone-200" role="status">
            {t("reset.sent")}
          </p>
          <p className="text-sm text-[var(--lux-muted)]">
            {t("reset.notReceived")}{" "}
            <Link href="/support" className="text-[var(--lux-gold-light)] hover:underline">
              {t("reset.support")}
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <label className="block">
            <span className={fieldLabelClass}>{t("auth.email")}</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="vous@exemple.com"
            />
          </label>
          {error && (
            <p className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="lux-btn lux-btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60" aria-busy={loading}>
            {loading ? t("reset.sending") : t("reset.send")}
          </button>
        </form>
      )}
      <p className="pt-5 text-center text-sm text-[var(--lux-muted)]">
        <Link href="/login" className="text-[var(--lux-gold-light)] hover:underline">
          {t("reset.backToLogin")}
        </Link>
      </p>
    </AuthShell>
  );
}
