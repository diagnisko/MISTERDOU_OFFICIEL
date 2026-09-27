"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { request, ApiClientError } from "@/lib/api";
import { AuthShell, fieldLabelClass, inputClass } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";

function homeFor(role: string | undefined): string {
  if (role === "ADMIN" || role === "STAFF") return "/admin";
  return "/account";
}

export default function LoginPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Retour OAuth Google : échange de l'id_token (fragment #) contre la session.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const oauthError = params.get("error");
    const idToken = params.get("id_token");
    const state = params.get("state");
    const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname);

    if (!idToken) {
      if (oauthError) setError("La connexion Google a été annulée. Réessayez ou utilisez votre e-mail.");
      cleanUrl();
      return;
    }

    const expected = sessionStorage.getItem("md_google_state");
    sessionStorage.removeItem("md_google_state");
    if (!state || state !== expected) {
      setError("Échange Google interrompu (état invalide). Réessayez.");
      cleanUrl();
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await request<{ user: { role: string } }>("/api/v1/auth/google", {
          method: "POST",
          body: JSON.stringify({ idToken }),
        });
        router.push(homeFor(res.user?.role));
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Erreur réseau");
        setLoading(false);
        cleanUrl();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await request<{ user: { role: string } }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push(homeFor(res.user?.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Erreur réseau");
      setLoading(false);
    }
  }

  const shake = !reduce && error ? { x: [0, -6, 6, -4, 4, 0] } : {};

  return (
    <AuthShell
      kicker="Espace membres"
      title="Se connecter"
      lead="Vos comptes, vos ventes et vos achats — réunis dans un espace sécurisé."
    >
      <div className="space-y-4">
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

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className={fieldLabelClass}>E-mail</span>
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

          <label className="block">
            <span className={fieldLabelClass}>Mot de passe</span>
            <span className="relative block">
              <input
                required
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
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
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>

        <p className="pt-1 text-center text-sm text-[var(--lux-muted)]">
          Pas de compte ?{" "}
          <Link href="/register" className="text-[var(--lux-gold-light)] transition hover:underline">
            Inscription
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
