"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import { request, ApiClientError } from "@/lib/api";
import { refreshAccount } from "@/lib/account";
import { AuthShell } from "@/components/auth/auth-shell";

// Confirmation de l'adresse e-mail depuis le lien reçu à l'inscription.
function VerifyEmail() {
  const t = useT();
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"checking" | "done" | "error">("checking");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState("error");
      setError(t("reset.noToken"));
      return;
    }
    request("/api/v1/auth/email/verify", { method: "POST", body: JSON.stringify({ token }) })
      .then(async () => {
        setState("done");
        await refreshAccount().catch(() => undefined);
      })
      .catch((err: unknown) => {
        setState("error");
        setError(err instanceof ApiClientError ? err.message : t("auth.network"));
      });
  }, [token, t]);

  if (state === "checking") return <p className="text-sm text-[var(--lux-muted)]">{t("verify.checking")}</p>;
  return (
    <div className="space-y-4">
      <p
        className={
          state === "done"
            ? "rounded-xl border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3.5 py-3 text-sm text-stone-200"
            : "rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-3.5 py-2.5 text-sm text-[#fca5a5]"
        }
        role={state === "done" ? "status" : "alert"}
      >
        {state === "done" ? t("verify.done") : error}
      </p>
      <Link href="/account" className="lux-btn lux-btn-gold w-full">
        {t("verify.goAccount")}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <AuthShell kicker={t("auth.memberArea")} title={t("verify.title")} lead="">
      <Suspense fallback={null}>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
