"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import { request } from "@/lib/api";
import { FieldError, invalidCls } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
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
  const form = useFormErrors();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!password) found.password = t("form.required");
    else if (password.length < 8) found.password = t("reset.tooShort");
    if (!confirm) found.confirm = t("form.required");
    else if (password && password !== confirm) found.confirm = t("reset.mismatch");
    if (Object.keys(found).length > 0) return form.show(found);
    form.reset();
    setLoading(true);
    try {
      await request("/api/v1/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (err) {
      form.fromError(err, t("auth.network"));
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
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
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
            form.clear("password");
          }}
          aria-invalid={Boolean(form.fields.password)}
          className={`${inputClass} ${invalidCls(form.fields.password)}`}
        />
        <FieldError message={form.fields.password} />
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
            form.clear("confirm");
          }}
          aria-invalid={Boolean(form.fields.confirm)}
          className={`${inputClass} ${invalidCls(form.fields.confirm)}`}
        />
        <FieldError message={form.fields.confirm} />
      </label>
      {form.general && (
        <p className="rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]" role="alert">
          {form.general}
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
