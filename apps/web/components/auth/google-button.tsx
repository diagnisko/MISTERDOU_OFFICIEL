"use client";

// Bouton « Continuer avec Google » — flux OAuth2 implicite (id_token).
// Sans NEXT_PUBLIC_GOOGLE_CLIENT_ID, le clic remonte un message clair (non configuré).
// Le callback revient sur /login où l'id_token est échangé contre la session.

import { useT } from "@/lib/i18n";

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export function startGoogleLogin() {
  if (!clientId || typeof window === "undefined") return false;
  const state = crypto.randomUUID();
  sessionStorage.setItem("md_google_state", state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}/login`,
    response_type: "id_token",
    scope: "openid email profile",
    state,
    nonce: state,
    prompt: "select_account",
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  return true;
}

export function GoogleButton({ onNotice }: { onNotice: (message: string) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        if (!startGoogleLogin()) {
          onNotice(t("google.unavailable"));
        }
      }}
      className="lux-btn lux-btn-ghost w-full [text-transform:none]"
    >
      <GoogleMark />
      {t("google.continue")}
    </button>
  );
}
