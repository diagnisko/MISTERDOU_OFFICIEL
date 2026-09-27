"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Button, Field, StatusBadge, TextInput } from "@/components/ui";
import { LuxShell, LuxTopBar } from "@/components/lux/lux-shell";

type Me = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  role: string;
  kycStatus: string;
  status: string;
} & { phoneVerified?: boolean };

export default function VerifyPhonePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    request<{ user: Me }>("/api/v1/auth/me")
      .then(({ user }) => setMe(user))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    if (!me?.countryCode || !me?.phoneNumber) return;
    setError(null);
    setBusy(true);
    try {
      const data = await request<{ requested: boolean; devCode?: string }>("/api/v1/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ countryCode: me.countryCode, phoneNumber: me.phoneNumber }),
      });
      setSent(true);
      setCooldown(30);
      if (data.devCode) setDevCode(data.devCode);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!me?.countryCode || !me?.phoneNumber) return;
    setError(null);
    setBusy(true);
    try {
      const data = await request<{ verified: boolean }>("/api/v1/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ countryCode: me.countryCode, phoneNumber: me.phoneNumber, code }),
      });
      if (data.verified) {
        router.push("/verification");
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.code === "OTP_INVALID" ? "Code invalide. Vérifiez le code affiché dans le journal de l'API." : err.message);
      } else {
        setError("Erreur réseau");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Main>
        <p className="text-sm text-muted">Chargement…</p>
      </Main>
    );
  }

  if (!me) {
    return (
      <Main>
        <Alert tone="warning">Session expirée. <Link href="/login" className="text-[var(--lux-gold-light)] hover:underline">Se connecter</Link></Alert>
      </Main>
    );
  }

  const masked = me.phoneNumber ? `${me.phoneNumber.slice(0, 3)}** ** ${me.phoneNumber.slice(-2)}` : "inconnu";

  return (
    <Main>
      <p className="lux-kicker">Sécurité</p>
      <h1 className="mt-2">Vérifier mon téléphone</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        {me.countryCode} {masked} · <StatusBadge status={me.phoneVerified ? "VERIFIED_PHONE" : "UNVERIFIED"} />
      </p>

      {!sent ? (
        <div className="space-y-4">
          <Alert>
            Un code à 6 chiffres vous sera envoyé par SMS. En développement, il est affiché dans le journal de
            l&apos;API (fichier <code className="text-[var(--lux-gold-light)]">api-out.log</code>).
          </Alert>
          <Field label="Code de vérification" required>
            <TextInput
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="— — — — — —"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.5em]"
            />
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={verify}
              disabled={code.length !== 6}
              loading={busy}
              variant={code.length === 6 ? "primary" : "outline"}
            >
              Vérifier
            </Button>
            <Button onClick={sendCode} variant="ghost" disabled={cooldown > 0 || busy}>
              {cooldown > 0 ? `Renvoyer (${cooldown}s)` : "Envoyer le code"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Alert tone="success">Code envoyé. Saisissez-le ci-dessous.</Alert>
          {devCode && (
            <button
              type="button"
              onClick={() => setCode(devCode)}
              className="w-full rounded-xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand transition-colors hover:bg-brand/20"
            >
              Mode dev : code = <span className="font-mono font-bold tracking-widest">{devCode}</span> (toucher pour
              remplir)
            </button>
          )}
          <Field label="Code de vérification" required>
            <TextInput
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="— — — — — —"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.5em]"
            />
          </Field>
          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={verify} disabled={code.length !== 6} loading={busy}>
              Confirmer
            </Button>
            <Button onClick={sendCode} variant="ghost" disabled={cooldown > 0}>
              {cooldown > 0 ? `Renvoi (${cooldown}s)` : "Renvoyer le code"}
            </Button>
          </div>
        </div>
      )}

      <p className="mt-6 text-sm text-muted">
        Une fois votre numéro confirmé, vous pourrez soumettre votre dossier d&apos;identité pour le{" "}
        <Link href="/verification" className="text-[var(--lux-gold-light)] hover:underline">contrôle d&apos;identité</Link>.
      </p>
    </Main>
  );
}

function Main({ children }: { children: React.ReactNode }) {
  return (
    <LuxShell>
      <LuxTopBar
        label="Sécurité"
        links={[
          { href: "/account", label: "Mon espace" },
          { href: "/verification", label: "Dossier" },
          { href: "/catalogue", label: "Catalogue" },
        ]}
      />
      <main className="relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-12 md:px-8">
        <Link
          href="/account"
          className="mb-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-[var(--lux-gold-light)]"
        >
          <span aria-hidden>←</span> Mon espace
        </Link>
        {children}
      </main>
    </LuxShell>
  );
}