"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { request, ApiClientError } from "@/lib/api";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";

// Mot de passe oublié, en deux temps sur la même page :
// 1. l'e-mail → un code à 6 chiffres part (réponse identique que le compte
//    existe ou non : aucune information divulguée) ;
// 2. le code + le nouveau mot de passe → toutes les sessions sont fermées.
const RESEND_SECONDS = 60;

export default function ForgotPasswordPage() {
  const t = useT();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function sendCode(resend = false) {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await request("/api/v1/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setStep("code");
      setWait(RESEND_SECONDS);
      if (resend) setNotice(t("reset.resent"));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.network"));
    } finally {
      setLoading(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!/^\d{6}$/.test(code)) return setError(t("reset.codeInvalid"));
    if (password.length < 8) return setError(t("reset.tooShort"));
    if (password !== confirm) return setError(t("reset.mismatch"));
    setLoading(true);
    try {
      await request("/api/v1/auth/password/reset-code", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code, password }),
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.network"));
    } finally {
      setLoading(false);
    }
  }

  const errorBox = error && (
    <p className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]" role="alert">
      {error}
    </p>
  );

  return (
    <AuthShell
      kicker={t("auth.memberArea")}
      title={step === "email" ? t("reset.forgotTitle") : t("reset.newTitle")}
      lead={step === "email" ? t("reset.forgotLead") : step === "code" ? t("reset.codeSentTo", { email: email.trim() }) : ""}
    >
      {step === "done" ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3.5 py-3 text-sm text-stone-200" role="status">
            {t("reset.done")}
          </p>
          <Link href="/login" className="lux-btn lux-btn-gold w-full">
            {t("auth.login")}
          </Link>
        </div>
      ) : step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
          className="space-y-4"
        >
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
          {errorBox}
          <button type="submit" disabled={loading} className="lux-btn lux-btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60" aria-busy={loading}>
            {loading ? t("reset.sending") : t("reset.send")}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void onReset(e)} className="space-y-4">
          <label className="block">
            <span className={fieldLabelClass}>{t("reset.codeLabel")}</span>
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={`${inputClass} text-center font-semibold tracking-[0.5em] tabular-nums`}
              placeholder="••••••"
              autoFocus
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t("reset.newPassword")}</span>
            <input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t("reset.confirm")}</span>
            <input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </label>
          {errorBox}
          {notice && (
            <p className="rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3.5 py-2.5 text-sm text-stone-200" role="status">
              {notice}
            </p>
          )}
          <button type="submit" disabled={loading} className="lux-btn lux-btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60" aria-busy={loading}>
            {loading ? t("reset.saving") : t("reset.save")}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              disabled={wait > 0 || loading}
              onClick={() => void sendCode(true)}
              className="text-[var(--lux-gold-light)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--lux-muted)] disabled:no-underline"
            >
              {wait > 0 ? t("reset.resendIn", { s: wait }) : t("reset.resend")}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setNotice(null);
              }}
              className="text-[var(--lux-muted)] hover:text-stone-200"
            >
              {t("reset.changeEmail")}
            </button>
          </div>
          <p className="text-[12.5px] text-[var(--lux-muted)]">
            {t("reset.spamHint")}{" "}
            <Link href="/support" className="text-[var(--lux-gold-light)] hover:underline">
              {t("reset.support")}
            </Link>
          </p>
        </form>
      )}
      {step !== "done" && (
        <p className="pt-5 text-center text-sm text-[var(--lux-muted)]">
          <Link href="/login" className="text-[var(--lux-gold-light)] hover:underline">
            {t("reset.backToLogin")}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
