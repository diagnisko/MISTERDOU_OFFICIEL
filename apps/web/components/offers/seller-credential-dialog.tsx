"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError, request } from "@/lib/api";
import { Alert, Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Espace vendeur : saisir ou remplacer les identifiants d'une offre, à tout
// moment — y compris vendue ou payée en mensualités. L'acheteur qui a déjà
// accès au compte les voit aussitôt dans sa commande (et il est prévenu).
// ---------------------------------------------------------------------------

export function SellerCredentialDialog({
  productId,
  title,
  hasCredentials,
  onClose,
  onSaved,
}: {
  productId: string;
  title: string;
  hasCredentials: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginId.trim().length < 3 || !password) {
      setError(t("offer.credentialsBoth"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await request<{ notifiedBuyers: number }>(`/api/v1/seller/offers/${productId}/credential`, {
        method: "PUT",
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      onSaved(res.notifiedBuyers > 0 ? t("creds.savedBuyer") : t("creds.saved"));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("offer.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form role="dialog" aria-modal="true" aria-label={title} onSubmit={(e) => void submit(e)} className="dash-card my-auto w-full max-w-md space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="text-[16px] font-semibold text-white">{t("creds.editTitle")}</h2>
          <p className="mt-1 text-[12.5px] text-[#b8a6a1]">{title}</p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[#8f7d77]">{hasCredentials ? t("creds.replaceLead") : t("creds.missingLead")}</p>
        <label className="block">
          <span className="text-[12px] font-medium text-[#cdbab3]">{t("offer.loginId")}</span>
          <input ref={first} value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="off" className="dash-input mt-1.5 !pl-4" />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-[#cdbab3]">{t("offer.password")}</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className="dash-input mt-1.5 !pl-4" />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="dash-btn dash-btn-ghost">
            {t("chat.close")}
          </button>
          <button type="submit" disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
            {busy && <Spinner />} {t("offer.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
