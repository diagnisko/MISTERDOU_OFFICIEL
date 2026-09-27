"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiClientError, request, uploadFile } from "@/lib/api";
import { Alert, Button, Field, SelectInput, Spinner, StatusBadge, TextInput } from "@/components/ui";
import { LuxBack, LuxShell, LuxTopBar } from "@/components/lux/lux-shell";

type Verification = {
  id: string;
  status: string;
  documentType: "NATIONAL_ID" | "PASSPORT";
  firstName: string;
  lastName: string;
  birthDate: string | null;
  country: string;
  city: string | null;
  address: string | null;
  submittedAt: string;
  rejectionReason: string | null;
  history: { status: string; reason: string | null; createdAt: string }[];
};

type Me = { countryCode: string | null; phoneNumber: string | null; phoneVerified: boolean };

const filePurposes = {
  front: "kyc_front",
  back: "kyc_back",
  passport: "kyc_passport",
  selfie: "kyc_selfie",
} as const;

type DocumentSlot = keyof typeof filePurposes;

export default function IdentityVerificationPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [records, setRecords] = useState<Verification[]>([]);
  const [status, setStatus] = useState("NOT_SUBMITTED");
  const [documentType, setDocumentType] = useState<"NATIONAL_ID" | "PASSPORT">("NATIONAL_ID");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [files, setFiles] = useState<Partial<Record<DocumentSlot, File>>>({});
  const [location, setLocation] = useState<{ latitude: number; longitude: number; consentGiven: true } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [account, dossier] = await Promise.all([
      request<{ user: Me }>("/api/v1/auth/me"),
      request<{ status: string; records: Verification[] }>("/api/v1/kyc/me"),
    ]);
    setMe(account.user);
    setRecords(dossier.records);
    setStatus(dossier.status);
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : "Dossier indisponible")).finally(() => setLoading(false));
  }, []);

  async function captureLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("La localisation n’est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocation({ latitude: coords.latitude, longitude: coords.longitude, consentGiven: true }),
      () => setError("La localisation n’a pas été autorisée. Vous pouvez continuer sans la partager."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const keys: Partial<Record<DocumentSlot, string>> = {};
      const required: DocumentSlot[] = documentType === "NATIONAL_ID" ? ["front", "back", "selfie"] : ["passport", "selfie"];
      for (const slot of required) {
        const file = files[slot];
        if (!file) throw new Error("Ajoutez chaque document demandé avant l’envoi.");
        keys[slot] = (await uploadFile(file, filePurposes[slot])).key;
      }
      await request("/api/v1/kyc", {
        method: "POST",
        body: JSON.stringify({
          documentType,
          firstName,
          lastName,
          birthDate: birthDate || undefined,
          country,
          city: city || undefined,
          address: address || undefined,
          documentFrontKey: documentType === "NATIONAL_ID" ? keys.front : keys.passport,
          documentBackKey: keys.back,
          passportKey: keys.passport,
          selfieKey: keys.selfie,
          location: location ?? undefined,
        }),
      });
      await refresh();
      setFiles({});
      setMessage("Votre dossier a été transmis à l’équipe de vérification.");
    } catch (err) {
      const text = err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Envoi impossible";
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !["PENDING", "IN_PROGRESS", "VERIFIED"].includes(status);

  return (
    <LuxShell>
      <LuxTopBar label="Vérification" links={[{ href: "/account", label: "Mon espace" }, { href: "/catalogue", label: "Catalogue" }]} />
      <main className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-10 md:px-8">
        <LuxBack href="/account" label="Mon espace" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lux-kicker">Dossier d’identité</p>
            <h1 className="mt-2">Vérifier mon identité</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">La vérification est nécessaire avant tout achat. Vos pièces restent privées et sont consultées uniquement par l’équipe autorisée.</p>
          </div>
          {!loading && <StatusBadge status={status} />}
        </div>

        {loading ? <p className="mt-10 flex items-center gap-3 text-sm text-stone-400"><Spinner /> Chargement du dossier…</p> : (
          <div className="mt-8 space-y-5">
            {!me && <Alert tone="warning">Connectez-vous pour accéder à votre dossier. <Link href="/login" className="ml-1 text-[var(--lux-gold-light)] hover:underline">Se connecter</Link></Alert>}
            {me && !me.phoneVerified && <PhoneVerification me={me} onVerified={refresh} />}
            {error && <Alert tone="danger">{error}</Alert>}
            {message && <Alert tone="success">{message}</Alert>}
            {records[0]?.rejectionReason && <Alert tone="warning" title="Une nouvelle soumission est nécessaire">{records[0].rejectionReason}</Alert>}

            {canSubmit && me?.phoneVerified && (
              <form onSubmit={submit} className="lux-glass rounded-[22px] p-5 sm:p-7">
                <p className="lux-kicker">Nouvelle demande</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label="Prénom" required><TextInput required value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" maxLength={100} /></Field>
                  <Field label="Nom" required><TextInput required value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" maxLength={100} /></Field>
                  <Field label="Pays" required><TextInput required value={country} onChange={(event) => setCountry(event.target.value)} autoComplete="country-name" maxLength={100} /></Field>
                  <Field label="Ville"><TextInput value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" maxLength={100} /></Field>
                  <Field label="Date de naissance"><TextInput type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} autoComplete="bday" /></Field>
                  <Field label="Adresse"><TextInput value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" maxLength={255} /></Field>
                </div>

                <Field label="Document d’identité" required>
                  <SelectInput value={documentType} onChange={(event) => setDocumentType(event.target.value as "NATIONAL_ID" | "PASSPORT")}>
                    <option value="NATIONAL_ID">Carte nationale (recto et verso)</option>
                    <option value="PASSPORT">Passeport</option>
                  </SelectInput>
                </Field>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(documentType === "NATIONAL_ID" ? (["front", "back"] as const) : (["passport"] as const)).map((slot) => (
                    <Field key={slot} label={slot === "front" ? "Recto de la pièce" : slot === "back" ? "Verso de la pièce" : "Passeport"} required hint="JPEG, PNG, WebP ou PDF, 8 Mo maximum">
                      <TextInput required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFiles((prev) => ({ ...prev, [slot]: event.target.files?.[0] }))} className="file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-stone-200" />
                    </Field>
                  ))}
                  <Field label="Photo du visage" required hint="Photo nette, JPEG, PNG ou WebP">
                    <TextInput required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles((prev) => ({ ...prev, selfie: event.target.files?.[0] }))} className="file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-stone-200" />
                  </Field>
                </div>

                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <p className="text-sm font-semibold text-stone-100">Localisation (facultative)</p>
                  <p className="mt-1 text-xs leading-relaxed text-stone-400">Elle est demandée une seule fois, avec votre autorisation, pour compléter le dossier. Aucun suivi en arrière-plan n’est effectué.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" onClick={captureLocation}>{location ? "Position enregistrée" : "Autoriser une fois"}</Button>
                    {location && <span className="text-xs text-emerald-300">Position prête à être envoyée avec le dossier.</span>}
                  </div>
                </div>

                <Button type="submit" loading={busy} className="mt-6 w-full sm:w-auto">Transmettre mon dossier</Button>
              </form>
            )}

            {me && !me.phoneVerified && <Alert tone="warning">Vérifiez d’abord votre numéro de téléphone. Le dossier d’identité sera disponible ensuite.</Alert>}
            {status === "PENDING" || status === "IN_PROGRESS" ? <Alert>Votre dossier est en cours de traitement. Vous pouvez consulter ici son statut et son historique.</Alert> : null}
            {status === "VERIFIED" ? <Alert tone="success">Votre identité est vérifiée. Vous pouvez maintenant passer commande.</Alert> : null}

            {records.length > 0 && (
              <section className="lux-glass rounded-[22px] p-5 sm:p-7">
                <p className="lux-kicker">Historique</p>
                <ul className="mt-4 space-y-4">
                  {records.map((record) => <li key={record.id} className="border-t border-white/10 pt-4 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium text-stone-100">Demande du {new Date(record.submittedAt).toLocaleDateString("fr-FR")}</span><StatusBadge status={record.status} /></div>
                    {record.history.length > 0 && <ol className="mt-3 space-y-2 text-xs text-stone-400">{record.history.map((entry, index) => <li key={`${record.id}-${index}`}>{new Date(entry.createdAt).toLocaleString("fr-FR")} · {entry.status}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}</ol>}
                  </li>)}
                </ul>
              </section>
            )}
            <p className="text-xs text-stone-500">Les documents sont conservés dans un stockage chiffré et ne sont jamais accessibles par une URL publique.</p>
            <Link href="/account" className="text-xs text-[var(--lux-gold-light)] hover:underline">Retour à mon espace</Link>
          </div>
        )}
      </main>
    </LuxShell>
  );
}

function PhoneVerification({ me, onVerified }: { me: Me | null; onVerified: () => Promise<void> }) {
  const [countryCode, setCountryCode] = useState(me?.countryCode ?? "+221");
  const [phone, setPhone] = useState(me?.phoneNumber?.replace(/^\+\d{1,4}/, "") ?? "");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sent, setSent] = useState(Boolean(me?.phoneNumber));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePhone() {
    setBusy(true); setError(null);
    try {
      await request("/api/v1/auth/phone", { method: "POST", body: JSON.stringify({ countryCode, phoneNumber: phone }) });
      setSent(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Numéro invalide"); }
    finally { setBusy(false); }
  }
  async function sendCode() {
    setBusy(true); setError(null);
    try {
      const result = await request<{ devCode?: string }>("/api/v1/auth/otp/request", { method: "POST", body: JSON.stringify({ countryCode, phoneNumber: phone }) });
      setDevCode(result.devCode ?? null);
      setSent(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Envoi du code impossible"); }
    finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError(null);
    try {
      await request("/api/v1/auth/otp/verify", { method: "POST", body: JSON.stringify({ countryCode, phoneNumber: phone, code }) });
      await onVerified();
    } catch (err) { setError(err instanceof Error ? err.message : "Code incorrect"); }
    finally { setBusy(false); }
  }
  return <section className="lux-glass rounded-[22px] p-5 sm:p-7">
    <p className="lux-kicker">Étape préalable</p>
    <h2 className="mt-2 text-xl text-stone-100">Confirmer mon téléphone</h2>
    <p className="mt-2 text-sm text-stone-400">Votre numéro reste privé. Il sert à sécuriser votre compte et les achats.</p>
    {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
    {!sent ? <div className="mt-5 grid gap-3 sm:grid-cols-[120px_1fr_auto]">
      <Field label="Indicatif"><TextInput value={countryCode} onChange={(event) => setCountryCode(event.target.value)} placeholder="+221" /></Field>
      <Field label="Téléphone"><TextInput type="tel" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))} /></Field>
      <Button type="button" className="self-end" loading={busy} onClick={() => void savePhone()}>Continuer</Button>
    </div> : <div className="mt-5 space-y-4">
      {devCode && <Alert tone="info">Mode développement : code {devCode}</Alert>}
      <div className="flex flex-wrap items-end gap-3"><Field label="Code reçu par SMS"><TextInput inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></Field><Button type="button" loading={busy} onClick={() => void verify()} disabled={code.length !== 6}>Vérifier le numéro</Button><Button type="button" variant="ghost" onClick={() => void sendCode()} disabled={busy}>Renvoyer le code</Button></div>
      {!devCode && <p className="text-xs text-stone-500">Si aucun SMS n’arrive, l’envoi SMS doit être configuré par l’administrateur.</p>}
    </div>}
  </section>;
}
