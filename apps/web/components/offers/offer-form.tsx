"use client";

import { useState, type ReactNode } from "react";
import { formatXof, request } from "@/lib/api";
import { Alert, FieldError, Spinner, invalidCls } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
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
  /** Prix total en mensualités (null : le même que comptant). */
  installmentPrice?: number | null;
  /** ID eFootball (absent sur les offres publiées avant cette règle). */
  gameAccountId?: string | null;
  acceptsExchange?: boolean;
};

export type EditableOffer = OfferValues & { id: string; slug: string; hasCredentials: boolean; rejectedReason?: string | null };

const DIVISIONS = ["Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Legend", "Ikon", "Epic"];

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={`text-[12px] font-medium ${error ? "text-[#fca5a5]" : "text-[#cdbab3]"}`}>{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? <FieldError message={error} /> : hint && <span className="mt-1 block text-[11px] text-[#8f7d77]">{hint}</span>}
    </label>
  );
}

const toInt = (value: string) => (value.trim() === "" ? NaN : Number(value.replace(/\s/g, "")));
const MIN_PRICE = 500;
const GAME_ID_RE = /^[A-Za-z0-9 _-]+$/;

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
  // Prix total en mensualités : suit le prix comptant tant qu'on ne l'a pas changé à la main.
  const [monthlyPrice, setMonthlyPrice] = useState(offer?.installmentPrice != null ? String(offer.installmentPrice) : "");
  const [monthlyPriceEdited, setMonthlyPriceEdited] = useState(offer?.installmentPrice != null && offer.installmentPrice !== offer.basePrice);
  const [gameId, setGameId] = useState(offer?.gameAccountId ?? "");
  const [acceptsExchange, setAcceptsExchange] = useState(offer?.acceptsExchange ?? false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors();
  const err = errors.fields;
  // Saisie : la valeur change et l'erreur de ce champ disparaît.
  const edit = (key: string, set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    errors.clear(key);
  };
  const [created, setCreated] = useState<{ id: string; slug: string } | null>(null);

  const editing = Boolean(offer);
  const priceValue = toInt(price);
  const shownMonthlyPrice = monthlyPriceEdited ? monthlyPrice : price;
  const monthlyPriceValue = toInt(shownMonthlyPrice);

  /** Contrôle avant l'envoi : une erreur par champ, en français simple. */
  function check(): Record<string, string> {
    const found: Record<string, string> = {};
    const id = gameId.trim().replace(/[\s_-]/g, "");
    if (!gameId.trim()) found.gameAccountId = t("form.required");
    else if (!GAME_ID_RE.test(gameId.trim()) || id.length < 4 || id.length > 40) found.gameAccountId = t("offer.gameIdInvalid");
    if (title.trim().length < 3) found.title = title.trim() ? t("form.minChars", { n: 3 }) : t("form.required");
    if (division.trim().length < 2) found.division = division.trim() ? t("form.minChars", { n: 2 }) : t("form.required");
    const whole = (value: string, key: string) => {
      const n = toInt(value);
      if (value.trim() === "") found[key] = t("form.required");
      else if (!Number.isInteger(n) || n < 0) found[key] = t("form.number");
    };
    whole(teamPower, "teamPower");
    whole(coins, "coins");
    if (description.trim().length < 10) found.description = description.trim() ? t("form.minChars", { n: 10 }) : t("form.required");
    whole(price, "basePrice");
    if (!found.basePrice && priceValue < MIN_PRICE) found.basePrice = t("form.minAmount", { amount: formatXof(MIN_PRICE) });
    if (monthly) {
      whole(months, "installmentMonths");
      if (!found.installmentMonths && toInt(months) < 2) found.installmentMonths = t("offer.monthsMin");
      whole(shownMonthlyPrice, "installmentPrice");
      if (!found.installmentPrice && !found.basePrice && monthlyPriceValue < priceValue) found.installmentPrice = t("offer.monthlyPriceLow");
      if (downPayment.trim() !== "") whole(downPayment, "installmentDownPayment");
      if (!found.installmentDownPayment && !found.installmentPrice && (toInt(downPayment) || 0) >= monthlyPriceValue) {
        found.installmentDownPayment = t("offer.downTooHigh");
      }
    }
    const given = loginId.trim() !== "" || password !== "";
    if (!editing || given) {
      if (!loginId.trim()) found["credentials.loginId"] = editing ? t("offer.credentialsBoth") : t("form.required");
      if (!password) found["credentials.password"] = editing ? t("offer.credentialsBoth") : t("form.required");
    }
    return found;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = check();
    if (Object.keys(found).length > 0) {
      errors.show(found);
      return;
    }
    errors.reset();
    const numbers = { teamPower: toInt(teamPower), coins: toInt(coins), basePrice: priceValue };
    const credentialsGiven = loginId.trim() !== "" || password !== "";
    const body = {
      gameAccountId: gameId.trim(),
      acceptsExchange,
      title,
      description,
      division,
      ...numbers,
      extraInfo: extraInfo.trim() || null,
      paymentMode: monthly ? "INSTALLMENTS" : "ONE_TIME",
      installmentMonths: monthly ? toInt(months) : null,
      installmentDownPayment: monthly ? toInt(downPayment) || 0 : null,
      installmentPrice: monthly ? monthlyPriceValue : null,
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
    } catch (caught) {
      errors.fromError(caught, t("offer.saveFailed"));
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
    <form onSubmit={submit} noValidate className="space-y-5">
      {reviewed && editing && offer?.rejectedReason && (
        <Alert tone="danger">
          <strong className="block">{t("offer.rejectedTitle")}</strong>
          {t("offer.rejectedLead", { reason: offer.rejectedReason })}
        </Alert>
      )}
      {reviewed && editing && <p className="text-[12.5px] leading-relaxed text-[#b8a6a1]">{t("offer.reviewNote")}</p>}
      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionAccount")}</h2>
        <Field label={t("offer.gameId")} hint={t("offer.gameIdHint")} error={err.gameAccountId}>
          <input name="gameAccountId" value={gameId} onChange={edit("gameAccountId", setGameId)} maxLength={60} autoComplete="off" aria-invalid={Boolean(err["gameAccountId"])} className={`dash-input !pl-4 ${invalidCls(err["gameAccountId"])}`} />
        </Field>
        <Field label={t("offer.title")} hint={t("offer.titleHint")} error={err.title}>
          <input name="title" value={title} onChange={edit("title", setTitle)} maxLength={120} aria-invalid={Boolean(err["title"])} className={`dash-input !pl-4 ${invalidCls(err["title"])}`} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("offer.division")} error={err.division}>
            <input name="division" value={division} onChange={edit("division", setDivision)} maxLength={40} list="offer-divisions" aria-invalid={Boolean(err["division"])} className={`dash-input !pl-4 ${invalidCls(err["division"])}`} />
            <datalist id="offer-divisions">
              {DIVISIONS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label={t("offer.teamPower")} error={err.teamPower}>
            <input name="teamPower" value={teamPower} onChange={edit("teamPower", setTeamPower)} inputMode="numeric" aria-invalid={Boolean(err["teamPower"])} className={`dash-input !pl-4 ${invalidCls(err["teamPower"])}`} />
          </Field>
          <Field label={t("offer.coins")} error={err.coins}>
            <input name="coins" value={coins} onChange={edit("coins", setCoins)} inputMode="numeric" aria-invalid={Boolean(err["coins"])} className={`dash-input !pl-4 ${invalidCls(err["coins"])}`} />
          </Field>
        </div>
        <Field label={t("offer.description")} error={err.description}>
          <textarea name="description" value={description} onChange={edit("description", setDescription)} maxLength={2000} rows={4} aria-invalid={Boolean(err["description"])} className={`dash-input !h-auto !pl-4 py-3 ${invalidCls(err["description"])}`} />
        </Field>
        <Field label={t("offer.extra")} hint={t("offer.extraHint")} error={err.extraInfo}>
          <textarea name="extraInfo" value={extraInfo} onChange={edit("extraInfo", setExtraInfo)} maxLength={1000} rows={2} aria-invalid={Boolean(err["extraInfo"])} className={`dash-input !h-auto !pl-4 py-3 ${invalidCls(err["extraInfo"])}`} />
        </Field>
      </div>

      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionPrice")}</h2>
        <Field label={t("offer.price")} hint={Number.isInteger(priceValue) && priceValue > 0 ? formatXof(priceValue) : undefined} error={err.basePrice}>
          <input name="basePrice" value={price} onChange={edit("basePrice", setPrice)} inputMode="numeric" aria-invalid={Boolean(err["basePrice"])} className={`dash-input !pl-4 ${invalidCls(err["basePrice"])}`} />
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
            <div className="sm:col-span-2">
              <Field
                label={t("offer.monthlyPrice")}
                hint={
                  Number.isInteger(monthlyPriceValue) && monthlyPriceValue > priceValue && priceValue > 0
                    ? t("offer.monthlyPriceMore", { amount: formatXof(monthlyPriceValue - priceValue) })
                    : t("offer.monthlyPriceHint")
                }
                error={err.installmentPrice}
              >
                <input
                  name="installmentPrice"
                  value={shownMonthlyPrice}
                  onChange={(e) => {
                    setMonthlyPrice(e.target.value);
                    setMonthlyPriceEdited(true);
                    errors.clear("installmentPrice");
                  }}
                  inputMode="numeric"
                  aria-invalid={Boolean(err["installmentPrice"])}
                  className={`dash-input !pl-4 ${invalidCls(err["installmentPrice"])}`}
                />
              </Field>
            </div>
            <Field label={t("offer.months")} error={err.installmentMonths}>
              <input name="installmentMonths" value={months} onChange={edit("installmentMonths", setMonths)} inputMode="numeric" aria-invalid={Boolean(err["installmentMonths"])} className={`dash-input !pl-4 ${invalidCls(err["installmentMonths"])}`} />
            </Field>
            <Field label={t("offer.downPayment")} hint={t("offer.downPaymentHint")} error={err.installmentDownPayment}>
              <input name="installmentDownPayment" value={downPayment} onChange={edit("installmentDownPayment", setDownPayment)} inputMode="numeric" aria-invalid={Boolean(err["installmentDownPayment"])} className={`dash-input !pl-4 ${invalidCls(err["installmentDownPayment"])}`} />
            </Field>
          </div>
        )}
      </div>

      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionExchange")}</h2>
        <label className="flex items-start gap-3 text-[13px] text-[#e9dad3]">
          <input type="checkbox" checked={acceptsExchange} onChange={(e) => setAcceptsExchange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#ff6a32]" />
          <span>
            {t("offer.acceptsExchange")}
            <span className="block text-[11px] text-[#8f7d77]">{t("offer.acceptsExchangeHint")}</span>
          </span>
        </label>
      </div>

      <div className="dash-card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-white">{t("offer.sectionCredentials")}</h2>
        <p className="text-[12px] leading-relaxed text-[#8f7d77]">
          {editing && offer?.hasCredentials ? t("offer.credentialsKeep") : t("offer.credentialsLead")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("offer.loginId")} error={err["credentials.loginId"]}>
            <input name="credentials.loginId" value={loginId} onChange={edit("credentials.loginId", setLoginId)} autoComplete="off" aria-invalid={Boolean(err["credentials.loginId"])} className={`dash-input !pl-4 ${invalidCls(err["credentials.loginId"])}`} />
          </Field>
          <Field label={t("offer.password")} error={err["credentials.password"]}>
            <input name="credentials.password" value={password} onChange={edit("credentials.password", setPassword)} type="password" autoComplete="new-password" aria-invalid={Boolean(err["credentials.password"])} className={`dash-input !pl-4 ${invalidCls(err["credentials.password"])}`} />
          </Field>
        </div>
      </div>

      {errors.hasErrors && <p className="text-[12.5px] font-medium text-[#fca5a5]">{t("form.fixBelow")}</p>}
      {errors.general && <Alert tone="danger">{errors.general}</Alert>}

      <button type="submit" disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
        {busy && <Spinner />} {editing ? t("offer.save") : reviewed ? t("offer.submit") : t("offer.publish")}
      </button>
    </form>
  );
}
