"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { request, ApiClientError } from "@/lib/api";
import { FieldError } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";

// Mot de passe oublié, en deux temps sur la même page :
// 1. l'e-mail → un code à 6 chiffres part ; un e-mail inconnu est signalé
//    tout de suite (avec un lien pour créer un compte) ;
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
  const fields = useFormErrors();
  const bad = (key: string) => (fields.fields[key] ? " !border-[rgba(239,68,68,0.75)]" : "");
  const [notice, setNotice] = useState<string | null>(null);
  const [unknownEmail, setUnknownEmail] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function sendCode(resend = false) {
    setError(null);
    setNotice(null);
    setUnknownEmail(false);
    if (!email.trim()) return fields.show({ email: t("form.required") });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return fields.show({ email: t("form.emailInvalid") });
    fields.reset();
    setLoading(true);
    try {
      await request("/api/v1/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setStep("code");
      setWait(RESEND_SECONDS);
      if (resend) setNotice(t("reset.resent"));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "EMAIL_NOT_REGISTERED") {
        setUnknownEmail(true);
        fields.show({ email: t("reset.notRegistered") });
      } else if (err instanceof ApiClientError && err.code === "ACCOUNT_SUSPENDED") {
        setError(t("reset.suspended"));
      } else {
        setError(err instanceof ApiClientError ? err.message : t("auth.network"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const found: Record<string, string> = {};
    if (!/^\d{6}$/.test(code)) found.code = t("reset.codeInvalid");
    if (password.length < 8) found.password = t("reset.tooShort");
    else if (password !== confirm) found.confirm = t("reset.mismatch");
    if (Object.keys(found).length > 0) return fields.show(found);
    fields.reset();
    setLoading(true);
    try {
      await request("/api/v1/auth/password/reset-code", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code, password }),
      });
      setStep("done");
    } catch (err) {
      if (err instanceof ApiClientError && ["OTP_INVALID", "OTP_EXPIRED", "OTP_TOO_MANY_ATTEMPTS"].includes(err.code)) {
        fields.show({ code: err.message });
      } else {
        fields.fromError(err, t("auth.network"));
        if (!(err instanceof ApiClientError)) setError(t("auth.network"));
      }
    } finally {
      setLoading(false);
    }
  }

  const message = error ?? fields.general;
  const errorBox = message && (
    <p className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]" role="alert">
      {message}
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
          noValidate
          className="space-y-4"
        >
          <label className="block">
            <span className={fieldLabelClass}>{t("auth.email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                fields.clear("email");
                if (unknownEmail) {
                  setUnknownEmail(false);
                  setError(null);
                }
              }}
              aria-invalid={Boolean(fields.fields.email)}
              className={inputClass + bad("email")}
              placeholder="vous@exemple.com"
            />
            <FieldError message={fields.fields.email} />
          </label>
          {errorBox}
          {unknownEmail && (
            <Link
              href="/register"
              className="block text-center text-[13px] text-[var(--lux-gold-light)] underline-offset-2 hover:underline"
            >
              {t("reset.createAccount")}
            </Link>
          )}
          <button type="submit" disabled={loading} className="lux-btn lux-btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60" aria-busy={loading}>
            {loading ? t("reset.sending") : t("reset.send")}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void onReset(e)} noValidate className="space-y-4">
          <label className="block">
            <span className={fieldLabelClass}>{t("reset.codeLabel")}</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                fields.clear("code");
              }}
              aria-invalid={Boolean(fields.fields.code)}
              className={`${inputClass} text-center font-semibold tracking-[0.5em] tabular-nums${bad("code")}`}
              placeholder="••••••"
              autoFocus
            />
            <FieldError message={fields.fields.code} />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t("reset.newPassword")}</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              maxLength={72}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                fields.clear("password");
              }}
              aria-invalid={Boolean(fields.fields.password)}
              className={inputClass + bad("password")}
            />
            <FieldError message={fields.fields.password} />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>{t("reset.confirm")}</span>
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              maxLength={72}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                fields.clear("confirm");
              }}
              aria-invalid={Boolean(fields.fields.confirm)}
              className={inputClass + bad("confirm")}
            />
            <FieldError message={fields.fields.confirm} />
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
                fields.reset();
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
