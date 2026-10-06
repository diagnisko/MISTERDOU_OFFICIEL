"use client";

import { useState, type ReactNode } from "react";
import { ApiClientError, formatXof, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { MediaManager } from "@/components/media/media-manager";
import { useT } from "@/lib/i18n";

// Formulaire d'offre partagé : espace vendeur (/api/v1/seller/offers) et
// console (/api/v1/admin/offerings). Après la création, on passe aux photos et
// vidéos. L'offre d'un vendeur attend la validation de l'équipe ; celle de
// l'équipe est publiée tout de suite.

export type OfferValues = {
  title: string;
  description: string;
  division: string;
  teamPower: number;
  coins: number;
  extraInfo: string | null;
  basePrice: number;
  paymentMode: "ONE_TIME" | "INSTALLMENTS";
  installmentMonths: number | null;
  installmentDownPayment: number | null;
};

export type EditableOffer = OfferValues & { id: string; slug: string; hasCredentials: boolean; rejectedReason?: string | null };

const DIVISIONS = ["Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Legend", "Ikon", "Epic"];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-[#cdbab3]">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-[#8f7d77]">{hint}</span>}
    </label>
  );
}

const toInt = (value: string) => (value.trim() === "" ? NaN : Number(value.replace(/\s/g, "")));

export function OfferForm({
  apiBase,
  offer,
  onDone,
  doneLabel,
}: {
  /** Racine de l'API : /api/v1/seller/offers ou /api/v1/admin/offerings. */
  apiBase: string;
  /** Offre à modifier ; absente = création. */
  offer?: EditableOffer;
  onDone: (created: { id: string; slug: string }) => void;
  doneLabel: string;
}) {
  const t = useT();
  // Espace vendeur : chaque envoi passe par la validation de l'équipe.
  const reviewed = !apiBase.startsWith("/api/v1/admin");
  const [title, setTitle] = useState(offer?.title ?? "");
  const [description, setDescription] = useState(offer?.description ?? "");
  const [division, setDivision] = useState(offer?.division ?? "");
  const [teamPower, setTeamPower] = useState(offer ? String(offer.teamPower) : "");
  const [coins, setCoins] = useState(offer ? String(offer.coins) : "");
  const [extraInfo, setExtraInfo] = useState(offer?.extraInfo ?? "");
  const [price, setPrice] = useState(offer ? String(offer.basePrice) : "");
  const [monthly, setMonthly] = useState(offer?.paymentMode === "INSTALLMENTS");
  const [months, setMonths] = useState(offer?.installmentMonths ? String(offer.installmentMonths) : "3");
  const [downPayment, setDownPayment] = useState(offer?.installmentDownPayment != null ? String(offer.installmentDownPayment) : "0");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; slug: string } | null>(null);

  const editing = Boolean(offer);
  const priceValue = toInt(price);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const numbers = { teamPower: toInt(teamPower), coins: toInt(coins), basePrice: priceValue };
    if (Object.values(numbers).some((n) => !Number.isInteger(n) || n < 0)) {
      setError(t("offer.numbersInvalid"));
      return;
    }
    const credentialsGiven = loginId.trim() !== "" || password !== "";
    if (!editing && (!loginId.trim() || !password)) {
      setError(t("offer.credentialsRequired"));
      return;
    }
    if (credentialsGiven && (!loginId.trim() || !password)) {
      setError(t("offer.credentialsBoth"));
      return;
    }
    const body = {
      title,
      description,
      division,
      ...numbers,
      extraInfo: extraInfo.trim() || null,
      paymentMode: monthly ? "INSTALLMENTS" : "ONE_TIME",
      installmentMonths: monthly ? toInt(months) : null,
      installmentDownPayment: monthly ? toInt(downPayment) || 0 : null,
      ...(credentialsGiven ? { credentials: { loginId: loginId.trim(), password } } : {}),
    };
    setBusy(true);
    try {
      const result = await request<{ id: string; slug: string }>(editing ? `${apiBase}/${offer!.id}` : apiBase, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      setPassword("");
      if (editing) onDone(result);
      else setCreated(result);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("offer.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  // Étape 2 (création) : l'offre est en ligne, on ajoute photos et vidéos.
  if (created) {
    return (
      <div className="space-y-5">
        <Alert tone="success">{reviewed ? t("offer.submitted") : t("offer.published")}</Alert>
        <div className="dash-card p-5">
          <h2 className="text-[15px] font-semibold text-white">{t("offer.mediaTitle")}</h2>
          <p className="mb-4 mt-1 text-[12px] text-[#8f7d77]">{t("offer.mediaLead")}</p>
          <MediaManager productId={created.id} team={apiBase.startsWith("/api/v1/admin")} />
        </div>
        <button type="button" onClick={() => onDone(created)} className="dash-btn dash-btn-primary">
          {doneLabel}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {reviewed && editing && offer?.rejectedReason && (
        <Alert tone="danger">
          <strong className="block">{t("offer.rejectedTitle")}</strong>
          {t("offer.rejectedLead", { reason: offer.rejectedReason })}
        </Alert>
      )}
      {reviewed && editing && <p className="text-[12.5px] leading-relaxed text-[#b8a6a1]">{t("offer.reviewNote")}</p>}
      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionAccount")}</h2>
        <Field label={t("offer.title")} hint={t("offer.titleHint")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={120} className="dash-input !pl-4" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("offer.division")}>
            <input value={division} onChange={(e) => setDivision(e.target.value)} required minLength={2} maxLength={40} list="offer-divisions" className="dash-input !pl-4" />
            <datalist id="offer-divisions">
              {DIVISIONS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label={t("offer.teamPower")}>
            <input value={teamPower} onChange={(e) => setTeamPower(e.target.value)} required inputMode="numeric" className="dash-input !pl-4" />
          </Field>
          <Field label={t("offer.coins")}>
            <input value={coins} onChange={(e) => setCoins(e.target.value)} required inputMode="numeric" className="dash-input !pl-4" />
          </Field>
        </div>
        <Field label={t("offer.description")}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} maxLength={2000} rows={4} className="dash-input !h-auto !pl-4 py-3" />
        </Field>
        <Field label={t("offer.extra")} hint={t("offer.extraHint")}>
          <textarea value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)} maxLength={1000} rows={2} className="dash-input !h-auto !pl-4 py-3" />
        </Field>
      </div>

      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionPrice")}</h2>
        <Field label={t("offer.price")} hint={Number.isInteger(priceValue) && priceValue > 0 ? formatXof(priceValue) : undefined}>
          <input value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="numeric" className="dash-input !pl-4" />
        </Field>
        <label className="flex items-start gap-3 text-[13px] text-[#e9dad3]">
          <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#ff6a32]" />
          <span>
            {t("offer.monthly")}
            <span className="block text-[11px] text-[#8f7d77]">{t("offer.monthlyHint")}</span>
          </span>
        </label>
        {monthly && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("offer.months")}>
              <input value={months} onChange={(e) => setMonths(e.target.value)} required inputMode="numeric" className="dash-input !pl-4" />
            </Field>
            <Field label={t("offer.downPayment")} hint={t("offer.downPaymentHint")}>
              <input value={downPayment} onChange={(e) => setDownPayment(e.target.value)} inputMode="numeric" className="dash-input !pl-4" />
            </Field>
          </div>
        )}
      </div>

      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionCredentials")}</h2>
        <p className="text-[12px] leading-relaxed text-[#8f7d77]">
          {editing && offer?.hasCredentials ? t("offer.credentialsKeep") : t("offer.credentialsLead")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("offer.loginId")}>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} required={!editing} autoComplete="off" className="dash-input !pl-4" />
          </Field>
          <Field label={t("offer.password")}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!editing} autoComplete="new-password" className="dash-input !pl-4" />
          </Field>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <button type="submit" disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
        {busy && <Spinner />} {editing ? t("offer.save") : reviewed ? t("offer.submit") : t("offer.publish")}
      </button>
    </form>
  );
}
