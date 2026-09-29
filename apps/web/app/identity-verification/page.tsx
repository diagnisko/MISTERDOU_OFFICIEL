import { useT, type MessageKey } from "@/lib/i18n";
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

type Me = { countryCode: string | null; phoneNumber: string | null };

const filePurposes = {
  front: "kyc_front",
  back: "kyc_back",
  passport: "kyc_passport",
  selfie: "kyc_selfie",
} as const;

type DocumentSlot = keyof typeof filePurposes;

export default function IdentityVerificationPage() {
  const t = useT();
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
    void refresh().catch((err) => setError(err instanceof Error ? err.message : t("kycp.unavailable"))).finally(() => setLoading(false));
  }, []);

  async function captureLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError(t("kycp.noGeo"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocation({ latitude: coords.latitude, longitude: coords.longitude, consentGiven: true }),
      () => setError(t("kycp.geoDenied")),
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
        if (!file) throw new Error(t("kycp.missingDocs"));
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
      setMessage(t("kycp.sent"));
    } catch (err) {
      const text = err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : t("kycp.sendFailed");
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !["PENDING", "IN_PROGRESS", "VERIFIED"].includes(status);

  return (
    <LuxShell>
      <LuxTopBar label={t("kycp.topbar")} links={[{ href: "/account", label: t("kycp.mySpace") }, { href: "/offres", label: t("pay.catalogue") }]} />
      <main className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-10 md:px-8">
        <LuxBack href="/account" label={t("kycp.mySpace")} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lux-kicker">{t("kycp.kicker")}</p>
            <h1 className="mt-2">{t("kycp.title")}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">{t("kycp.lead")}</p>
          </div>
          {!loading && <StatusBadge status={status} />}
        </div>

        {loading ? <p className="mt-10 flex items-center gap-3 text-sm text-stone-400"><Spinner /> {t("kycp.loading")}</p> : (
          <div className="mt-8 space-y-5">
            {!me && <Alert tone="warning">{t("kycp.loginFirst")} <Link href="/login" className="ms-1 text-[var(--lux-gold-light)] hover:underline">{t("pay.login")}</Link></Alert>}
            {error && <Alert tone="danger">{error}</Alert>}
            {message && <Alert tone="success">{message}</Alert>}
            {records[0]?.rejectionReason && <Alert tone="warning" title={t("kycp.resubmitTitle")}>{records[0].rejectionReason}</Alert>}

            {canSubmit && me && (
              <form onSubmit={submit} className="lux-glass rounded-[22px] p-5 sm:p-7">
                <p className="lux-kicker">{t("kycp.newRequest")}</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label={t("kycp.firstName")} required><TextInput required value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" maxLength={100} /></Field>
                  <Field label={t("kycp.lastName")} required><TextInput required value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" maxLength={100} /></Field>
                  <Field label={t("kycp.country")} required><TextInput required value={country} onChange={(event) => setCountry(event.target.value)} autoComplete="country-name" maxLength={100} /></Field>
                  <Field label={t("kycp.city")}><TextInput value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" maxLength={100} /></Field>
                  <Field label={t("kycp.birthDate")}><TextInput type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} autoComplete="bday" /></Field>
                  <Field label={t("kycp.address")}><TextInput value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" maxLength={255} /></Field>
                </div>

                <Field label={t("kycp.document")} required>
                  <SelectInput value={documentType} onChange={(event) => setDocumentType(event.target.value as "NATIONAL_ID" | "PASSPORT")}>
                    <option value="NATIONAL_ID">{t("kycp.nationalId")}</option>
                    <option value="PASSPORT">{t("kycp.passport")}</option>
                  </SelectInput>
                </Field>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(documentType === "NATIONAL_ID" ? (["front", "back"] as const) : (["passport"] as const)).map((slot) => (
                    <Field key={slot} label={slot === "front" ? t("kycp.front") : slot === "back" ? t("kycp.back") : t("kycp.passport")} required hint={t("kycp.fileHint")}>
                      <TextInput required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFiles((prev) => ({ ...prev, [slot]: event.target.files?.[0] }))} className="file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-stone-200" />
                    </Field>
                  ))}
                  <Field label={t("kycp.selfie")} required hint={t("kycp.selfieHint")}>
                    <TextInput required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles((prev) => ({ ...prev, selfie: event.target.files?.[0] }))} className="file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-stone-200" />
                  </Field>
                </div>

                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <p className="text-sm font-semibold text-stone-100">{t("kycp.location")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-stone-400">{t("kycp.locationBody")}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" onClick={captureLocation}>{location ? t("kycp.locationSaved") : t("kycp.locationAllow")}</Button>
                    {location && <span className="text-xs text-emerald-300">{t("kycp.locationReady")}</span>}
                  </div>
                </div>

                <Button type="submit" loading={busy} className="mt-6 w-full sm:w-auto">{t("kycp.submit")}</Button>
              </form>
            )}

            {status === "PENDING" || status === "IN_PROGRESS" ? <Alert>{t("kycp.processing")}</Alert> : null}
            {status === "VERIFIED" ? <Alert tone="success">{t("kycp.verified")}</Alert> : null}

            {records.length > 0 && (
              <section className="lux-glass rounded-[22px] p-5 sm:p-7">
                <p className="lux-kicker">{t("kycp.history")}</p>
                <ul className="mt-4 space-y-4">
                  {records.map((record) => <li key={record.id} className="border-t border-white/10 pt-4 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium text-stone-100">{t("kycp.requestOf", { date: new Date(record.submittedAt).toLocaleDateString(t.intl) })}</span><StatusBadge status={record.status} /></div>
                    {record.history.length > 0 && <ol className="mt-3 space-y-2 text-xs text-stone-400">{record.history.map((entry, index) => <li key={`${record.id}-${index}`}>{new Date(entry.createdAt).toLocaleString(t.intl)} · {t(`badge.${entry.status}` as MessageKey)}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}</ol>}
                  </li>)}
                </ul>
              </section>
            )}
            <p className="text-xs text-stone-500">{t("kycp.storage")}</p>
            <Link href="/account" className="text-xs text-[var(--lux-gold-light)] hover:underline">{t("kycp.backToAccount")}</Link>
          </div>
        )}
      </main>
    </LuxShell>
  );
}
