"use client";

import { useEffect, useState } from "react";
import { ApiClientError, request } from "@/lib/api";
import { Spinner } from "@/components/ui";

// ---------------------------------------------------------------------------
// Notifications sur ce téléphone (centre de notifications) pour l'équipe.
// iPhone : le site doit être ouvert depuis l'écran d'accueil (Partager → « Sur
// l'écran d'accueil ») ; Android et ordinateur : directement dans le navigateur.
// ---------------------------------------------------------------------------

type State = "loading" | "install" | "unsupported" | "denied" | "off" | "on";

const HIDE_KEY = "md-push-card-hidden";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  await request("/api/v1/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
}

export function PushSetupCard() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      /* stockage indisponible : la carte reste visible */
    }
    void (async () => {
      if (!supported()) {
        setState(isIos() && !isStandalone() ? "install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const sub = Notification.permission === "granted" ? await currentSubscription().catch(() => null) : null;
      if (sub) {
        setState("on");
        // Abonnement rattaché au compte connecté (ex. téléphone partagé, abonnement renouvelé).
        saveSubscription(sub).catch(() => undefined);
      } else {
        setState("off");
      }
    })();
  }, []);

  function hide(value: boolean) {
    setHidden(value);
    try {
      if (value) window.localStorage.setItem(HIDE_KEY, "1");
      else window.localStorage.removeItem(HIDE_KEY);
    } catch {
      /* préférence non mémorisée */
    }
  }

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      // La demande d'autorisation doit suivre directement le toucher (exigence d'Apple).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const { publicKey } = await request<{ publicKey: string }>("/api/v1/push/key");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await saveSubscription(sub);
      setState("on");
      setNote(null);
    } catch (err) {
      setNote(err instanceof ApiClientError ? err.message : "Activation impossible sur cet appareil. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await request("/api/v1/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  if (state === "on") {
    return (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.06)] px-4 py-3">
        <p className="flex items-center gap-2.5 text-[13px] text-stone-200">
          <BellIcon className="text-[#6ee7b7]" />
          Notifications activées sur cet appareil.
        </p>
        <button type="button" onClick={() => void disable()} disabled={busy} className="text-[12.5px] text-[#8f7d77] transition hover:text-white disabled:opacity-60">
          Désactiver
        </button>
      </div>
    );
  }

  if (hidden) {
    return (
      <button type="button" onClick={() => hide(false)} className="mb-4 flex items-center gap-2 text-[12.5px] text-[#ff8a5c] hover:underline">
        <BellIcon /> Recevoir les alertes sur ce téléphone
      </button>
    );
  }

  return (
    <section className="dash-card mb-6 overflow-hidden p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[rgba(255,138,92,0.35)] bg-[rgba(232,71,36,0.1)] text-[#ff8a5c]">
          <BellIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15.5px] font-semibold text-stone-50">Recevez les alertes sur ce téléphone</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#b8a6a1]">
            Messages, paiements Wave, commandes, codes, retraits, offres et vérifications d’identité arrivent dans le
            centre de notifications, même site fermé. Seule l’équipe en service à ce moment est prévenue.
          </p>

          {state === "install" && (
            <ol className="mt-4 space-y-2 text-[13px] text-stone-200">
              <Step n={1}>
                Ouvrez <strong>misterdou.com</strong> dans <strong>Safari</strong>.
              </Step>
              <Step n={2}>
                Touchez <ShareIcon /> <strong>Partager</strong>, puis <strong>« Sur l’écran d’accueil »</strong>.
              </Step>
              <Step n={3}>Ouvrez MISTERDOU depuis la nouvelle icône, puis revenez ici pour activer.</Step>
            </ol>
          )}

          {state === "denied" && (
            <p className="mt-4 rounded-xl border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] px-3.5 py-2.5 text-[12.5px] text-stone-200">
              Les notifications sont bloquées sur cet appareil. Autorisez-les : sur iPhone, Réglages → Notifications →
              MISTERDOU ; ailleurs, dans les réglages du site du navigateur. Rechargez ensuite la page.
            </p>
          )}

          {note && <p className="mt-3 text-[12.5px] text-[#ffb08a]">{note}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {state === "off" && (
              <button type="button" onClick={() => void enable()} disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
                {busy && <Spinner />} Activer les notifications
              </button>
            )}
            <button type="button" onClick={() => hide(true)} className="text-[12.5px] text-[#8f7d77] transition hover:text-white">
              Plus tard
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[rgba(255,138,92,0.16)] text-[11px] font-semibold text-[#ffb08a]">{n}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function BellIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg aria-label="Partager" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline -translate-y-px">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}
