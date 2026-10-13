"use client";

import { useState, type FormEvent } from "react";
import { FieldError } from "@/components/ui";
import { useFormErrors } from "@/lib/form-errors";
import { useRouter } from "next/navigation";
import { ApiClientError, request } from "@/lib/api";
import { refreshAccount, useAccount } from "@/lib/account";
import { useT } from "@/lib/i18n";
import { LOCALES, setLocale, setTheme, usePreferences, type Theme } from "@/lib/preferences";
import { PushSettingsCard } from "@/components/account/push-settings";

const field =
  "w-full min-h-[46px] rounded-xl border border-[rgba(255,236,229,0.1)] bg-white/[0.035] px-4 text-sm text-white outline-none transition focus:border-[rgba(255,106,50,0.55)] focus:ring-2 focus:ring-[rgba(232,71,36,0.18)]";

const optionClass = (active: boolean) =>
  `flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border px-4 text-[14px] font-medium transition ${
    active
      ? "border-[rgba(255,106,50,0.6)] bg-[rgba(232,71,36,0.12)] text-white"
      : "border-white/[0.1] text-stone-300 hover:border-white/25 hover:text-white"
  }`;

export default function SettingsPage() {
  const account = useAccount();
  const prefs = usePreferences();
  const t = useT();
  const router = useRouter();

  if (account.status !== "member") return null;

  return (
    <div className="max-w-2xl space-y-5">
      <section className="dash-card p-5 sm:p-6" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="text-[17px] font-semibold text-white">
          {t("settings.appearance")}
        </h2>
        <p className="mt-1 text-[13px] text-[#b8a6a1]">{t("settings.appearanceLead")}</p>
        <div role="radiogroup" aria-labelledby="appearance-title" className="mt-4 flex gap-3">
          {(["dark", "light"] as Theme[]).map((theme) => (
            <button
              key={theme}
              type="button"
              role="radio"
              aria-checked={prefs.theme === theme}
              onClick={() => setTheme(theme)}
              className={optionClass(prefs.theme === theme)}
            >
              <span
                aria-hidden
                className={`h-5 w-5 rounded-full border ${theme === "dark" ? "border-stone-500 bg-[#120908]" : "border-stone-400 bg-[#faf6f3]"}`}
                style={{ backgroundColor: theme === "dark" ? "#120908" : "#faf6f3" }}
              />
              {theme === "dark" ? t("settings.dark") : t("settings.light")}
            </button>
          ))}
        </div>
      </section>

      <section className="dash-card p-5 sm:p-6" aria-labelledby="language-title">
        <h2 id="language-title" className="text-[17px] font-semibold text-white">
          {t("settings.language")}
        </h2>
        <p className="mt-1 text-[13px] text-[#b8a6a1]">{t("settings.languageLead")}</p>
        <div role="radiogroup" aria-labelledby="language-title" className="mt-4 flex flex-col gap-3 sm:flex-row">
          {LOCALES.map((l) => (
            <button
              key={l.value}
              type="button"
              role="radio"
              lang={l.value}
              aria-checked={prefs.locale === l.value}
              onClick={() => {
                setLocale(l.value);
                router.refresh(); // pages rendues côté serveur
              }}
              className={optionClass(prefs.locale === l.value)}
            >
              {l.native}
            </button>
          ))}
        </div>
        {prefs.locale !== "fr" && <p className="mt-3 text-[12px] text-[#8f7d77]">{t("settings.languageNote")}</p>}
      </section>

      <PushSettingsCard team={account.user.role === "STAFF"} />

      <PasswordCard hasPassword={account.profile.hasPassword} />
    </div>
  );
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fields = useFormErrors();
  const bad = (key: string) => (fields.fields[key] ? " !border-[rgba(239,68,68,0.75)]" : "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const found: Record<string, string> = {};
    if (hasPassword && !current) found.currentPassword = t("form.required");
    if (!next) found.newPassword = t("form.required");
    else if (next.length < 8) found.newPassword = t("form.minChars", { n: 8 });
    else if (next !== confirm) found.confirm = t("settings.mismatch");
    if (Object.keys(found).length > 0) return fields.show(found);
    fields.reset();
    setBusy(true);
    try {
      const res = await request<{ otherSessionsClosed: number }>("/api/v1/account/password", {
        method: "POST",
        body: JSON.stringify({ ...(hasPassword ? { currentPassword: current } : {}), newPassword: next }),
      });
      await refreshAccount();
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({
        tone: "ok",
        text: hasPassword
          ? t("settings.changed") + (res.otherSessionsClosed > 0 ? t("settings.othersClosed") : "")
          : t("settings.created"),
      });
    } catch (err) {
      // Mot de passe actuel refusé : le message va sous ce champ.
      fields.fromError(err, t("settings.failed"), { INVALID_PASSWORD: "currentPassword", INVALID_CREDENTIALS: "currentPassword" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="dash-card p-5 sm:p-6">
      <h2 className="text-[17px] font-semibold text-white">{hasPassword ? t("settings.changePassword") : t("settings.createPassword")}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#b8a6a1]">{hasPassword ? t("settings.changeLead") : t("settings.createLead")}</p>

      <div className="mt-5 grid gap-4">
        {hasPassword && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("settings.current")}</span>
            <input name="currentPassword" type="password" autoComplete="current-password" value={current} onChange={(e) => {
              setCurrent(e.target.value);
              fields.clear("currentPassword");
            }} aria-invalid={Boolean(fields.fields.currentPassword)} className={field + bad("currentPassword")} />
            <FieldError message={fields.fields.currentPassword} />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("settings.new")}</span>
          <input name="newPassword" type="password" maxLength={72} autoComplete="new-password" value={next} onChange={(e) => {
              setNext(e.target.value);
              fields.clear("newPassword");
            }} aria-invalid={Boolean(fields.fields.newPassword)} className={field + bad("newPassword")} />
            <FieldError message={fields.fields.newPassword} />
          {!fields.fields.newPassword && <span className="mt-1.5 block text-[12px] text-[#8f7d77]">{t("settings.minLength")}</span>}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-[#b8a6a1]">{t("settings.confirm")}</span>
          <input name="confirm" type="password" maxLength={72} autoComplete="new-password" value={confirm} onChange={(e) => {
              setConfirm(e.target.value);
              fields.clear("confirm");
            }} aria-invalid={Boolean(fields.fields.confirm)} className={field + bad("confirm")} />
            <FieldError message={fields.fields.confirm} />
        </label>
      </div>

      {fields.general && (
        <p role="alert" className="mt-4 text-[13px] text-[#fca5a5]">
          {fields.general}
        </p>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-4 text-[13px] ${message.tone === "error" ? "text-[#fca5a5]" : "text-[#86efac]"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button type="submit" disabled={busy} className="dash-btn dash-btn-primary">
          {busy ? t("settings.saving") : hasPassword ? t("settings.changePassword") : t("settings.createPassword")}
        </button>
      </div>
    </form>
  );
}
