"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, request } from "@/lib/api";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";

export default function AdminSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requiresCode, setRequiresCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await request<{ setupRequired: boolean; role?: "ADMIN" | "STAFF" }>("/api/v1/auth/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password, ...(requiresCode ? { totpCode } : {}) }),
      });
      router.replace(result.role === "STAFF" ? "/admin" : result.setupRequired ? "/console/sign-in/setup" : "/admin");
    } catch (err) {
      // Mot de passe juste, code manquant : on demande le code, sans erreur.
      if (err instanceof ApiClientError && err.code === "ACTION_REQUIRES_2FA") {
        setRequiresCode(true);
        setHint(err.message);
        setTimeout(() => document.getElementById("totp-code")?.focus(), 0);
      } else {
        setHint(null);
        setError(err instanceof ApiClientError ? err.message : "Connexion indisponible.");
      }
    } finally {
      setBusy(false);
    }
  }

  return <AuthShell kicker="Accès sécurisé" title="Console MISTERDOU" lead="Connexion réservée à l’équipe d’administration.">
    <form onSubmit={submit} className="space-y-4">
      <label className="block"><span className={fieldLabelClass}>E-mail administrateur</span><input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} placeholder="admin@exemple.com" /></label>
      <label className="block"><span className={fieldLabelClass}>Mot de passe</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} /></label>
      {requiresCode && <label className="block"><span className={fieldLabelClass}>Code d’authentification</span><input id="totp-code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))} className={inputClass} placeholder="6 chiffres" /></label>}
      {hint && !error && <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3.5 py-2.5 text-sm text-amber-100" role="status">{hint}</p>}
      {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-3.5 py-2.5 text-sm text-red-200" role="alert">{error}</p>}
      <button type="submit" disabled={busy} className="lux-btn lux-btn-gold w-full disabled:opacity-60">{busy ? "Vérification…" : requiresCode ? "Vérifier et entrer" : "Continuer"}</button>
      <p className="pt-1 text-center text-xs text-[var(--lux-muted)]">L’accès à la plateforme est protégé par une double authentification.</p>
    </form>
  </AuthShell>;
}
