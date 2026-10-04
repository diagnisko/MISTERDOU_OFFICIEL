"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiClientError } from "@/lib/api";

// Confirmation d'une suppression par le mot de passe de la personne connectée
// (console de l'équipe). Le serveur vérifie le mot de passe : sans lui, rien
// n'est supprimé, même si cette fenêtre était contournée.
export function PasswordConfirmDialog({
  title,
  message,
  confirmLabel = "Supprimer définitivement",
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("Entrez votre mot de passe.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err instanceof ApiClientError || err instanceof Error ? err.message : "La suppression a échoué.");
      setPassword("");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form role="dialog" aria-modal="true" aria-label={title} onSubmit={(e) => void submit(e)} className="dash-card my-auto w-full max-w-md p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.12)] text-[#fca5a5]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-stone-50">{title}</h2>
            <div className="mt-1.5 text-[13.5px] leading-relaxed text-stone-300">{message}</div>
          </div>
        </div>

        <label htmlFor="confirm-password" className="mt-5 block text-[12px] text-[#b8a6a1]">
          Votre mot de passe administrateur
        </label>
        <input
          ref={input}
          id="confirm-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="dash-input mt-1.5 !pl-4"
        />
        {error && <p className="mt-2 text-[12.5px] text-[#fca5a5]">{error}</p>}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="dash-btn dash-btn-ghost">
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            className="dash-btn border border-[rgba(239,68,68,0.55)] bg-[rgba(239,68,68,0.16)] text-[#fca5a5] hover:bg-[rgba(239,68,68,0.26)] disabled:opacity-60"
          >
            {busy ? "Suppression…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
