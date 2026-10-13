"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { request } from "@/lib/api";
import { FieldError } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";
import { GoogleButton, googleEnabled } from "@/components/auth/google-button";
import { homeForRole, setGreeting } from "@/lib/greeting";
import { refreshAccount } from "@/lib/account";

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const errors = useFormErrors();
  const error = errors.general;
  const setError = (value: null) => value === null && errors.reset();
  const bad = (key: string) => (errors.fields[key] ? " !border-[rgba(239,68,68,0.75)]" : "");

  /** Contrôle avant l'envoi, en français, sous chaque champ. */
  function check(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!firstName.trim()) found.firstName = t("form.required");
    if (!email.trim()) found.email = t("form.required");
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found.email = t("form.emailInvalid");
    if (!password) found.password = t("form.required");
    else if (password.length < 8) found.password = t("form.minChars", { n: 8 });
    return found;
  }
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = check();
    if (Object.keys(found).length > 0) {
      errors.show(found);
      return;
    }
    errors.reset();
    setLoading(true);
    try {
      await request("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ firstName, email, password }),
      });
      setGreeting({ kind: "welcome", firstName });
      await refreshAccount();
      router.push(homeForRole("CLIENT"));
    } catch (err) {
      errors.fromError(err, t("auth.network"), { EMAIL_ALREADY_REGISTERED: "email" });
      setLoading(false);
    }
  }

  const shake = !reduce && error ? { x: [0, -6, 6, -4, 4, 0] } : {};

  return (
    <AuthShell
      kicker={t("auth.newMember")}
      title={t("auth.register")}
      lead={t("auth.registerLead")}
    >
      <div className="space-y-4">
        {googleEnabled && (
          <>
            <GoogleButton
              onNotice={(msg) => {
                setNotice(msg);
                setError(null);
              }}
            />

            <div className="flex items-center gap-4 py-1">
              <span className="h-px flex-1 bg-[var(--lux-line)]" aria-hidden />
              <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--lux-muted)]">
                ou par e-mail
              </span>
              <span className="h-px flex-1 bg-[var(--lux-line)]" aria-hidden />
            </div>
          </>
        )}

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <label className="block">
            <span className={fieldLabelClass}>{t("auth.firstName")}</span>
            <input
              name="firstName"
              autoComplete="given-name"
              maxLength={80}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                errors.clear("firstName");
              }}
              aria-invalid={Boolean(errors.fields.firstName)}
              className={inputClass + bad("firstName")}
              placeholder={t("auth.firstNamePlaceholder")}
            />
            <FieldError message={errors.fields.firstName} />
          </label>

          <label className="block">
            <span className={fieldLabelClass}>{t("auth.email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                errors.clear("email");
              }}
              aria-invalid={Boolean(errors.fields.email)}
              className={inputClass + bad("email")}
              placeholder="vous@exemple.com"
            />
            <FieldError message={errors.fields.email} />
          </label>

          <label className="block">
            <span className={fieldLabelClass}>{t("auth.password")}</span>
            <span className="relative block">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  errors.clear("password");
                }}
                aria-invalid={Boolean(errors.fields.password)}
                className={`${inputClass} pr-12${bad("password")}`}
                placeholder={t("auth.passwordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--lux-muted)] transition hover:text-[var(--lux-gold-light)] focus-visible:outline-2 focus-visible:outline-[rgba(232,71,36,0.5)]"
              >
                {showPassword ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.6M6.3 6.8C4 8.4 3 10.7 3 12c0 2.5 4 7 9 7 1.3 0 2.5-.3 3.6-.8" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </span>
            <FieldError message={errors.fields.password} />
          </label>

          {notice && (
            <p
              className="rounded-xl border border-[rgba(232,71,36,0.35)] bg-[rgba(232,71,36,0.09)] px-3.5 py-2.5 text-sm text-[var(--lux-gold-light)]"
              role="status"
            >
              {notice}
            </p>
          )}

          {error && (
            <motion.p
              key={error}
              animate={shake}
              transition={{ duration: 0.35 }}
              className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]"
              role="alert"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="lux-btn lux-btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-busy={loading}
          >
            {loading ? t("auth.creating") : t("auth.createAccount")}
          </button>
        </form>

        <p className="pt-1 text-center text-sm text-[var(--lux-muted)]">
          {t("auth.alreadyMember")}{" "}
          <Link href="/login" className="text-[var(--lux-gold-light)] transition hover:underline">
            {t("nav.login")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
