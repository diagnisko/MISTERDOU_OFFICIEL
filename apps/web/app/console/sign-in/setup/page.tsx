"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Button, Field, Spinner, TextInput } from "@/components/ui";
import { LuxBack, LuxShell, LuxTopBar } from "@/components/lux/lux-shell";

export default function AdminTotpSetupPage() {
  const router = useRouter();
  const [uri, setUri] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<{ otpauthUri: string; secret: string }>("/api/v1/auth/admin/totp/setup", { method: "POST", body: JSON.stringify({}) })
      .then((result) => { setUri(result.otpauthUri); setSecret(result.secret); })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Enrôlement indisponible."))
      .finally(() => setLoading(false));
  }, []);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await request("/api/v1/auth/admin/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      router.replace("/console");
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Code invalide."); }
    finally { setBusy(false); }
  }

  return <LuxShell>
    <LuxTopBar label="Sécurité administrateur" />
    <main className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-10 md:px-8">
      <LuxBack href="/console/sign-in" label="Connexion console" />
      <div className="lux-glass rounded-[24px] p-6 sm:p-9">
        <p className="lux-kicker">Première connexion</p>
        <h1 className="mt-2">Activer la double authentification</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-400">Scannez ce code avec une application d’authentification. Il est généré par la plateforme et ne sera affiché qu’ici.</p>
        {loading ? <p className="mt-8 flex items-center gap-3 text-sm text-stone-400"><Spinner /> Préparation de votre clé privée…</p> : error ? <div className="mt-6"><Alert tone="danger">{error}</Alert></div> : <div className="mt-7 grid gap-7 md:grid-cols-[220px_1fr] md:items-start">
          <div className="grid place-items-center rounded-[18px] bg-white p-4"><QRCodeSVG value={uri} size={188} level="M" includeMargin /></div>
          <div className="space-y-5">
            <div><p className="lux-kicker">Clé manuelle</p><p className="mt-2 break-all rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-sm tracking-[0.12em] text-[var(--lux-gold-light)]">{secret}</p></div>
            <form onSubmit={confirm} className="space-y-4">
              <Field label="Code à six chiffres" hint="Le code change toutes les 30 secondes."><TextInput required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></Field>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button type="submit" loading={busy} disabled={code.length !== 6}>Confirmer et ouvrir la console</Button>
            </form>
          </div>
        </div>}
      </div>
    </main>
  </LuxShell>;
}
