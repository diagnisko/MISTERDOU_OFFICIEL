"use client";

import { useEffect, useState } from "react";
import { ApiClientError, request } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Paramètres → Notifications sur cet appareil (centre de notifications du
// téléphone ou de l'ordinateur), pour tout membre : clients, vendeurs, équipe.
// iPhone : le site doit être ouvert depuis l'écran d'accueil (Partager → « Sur
// l'écran d'accueil ») ; Android et ordinateur : directement dans le navigateur.
// ---------------------------------------------------------------------------

type State = "loading" | "install" | "unsupported" | "denied" | "off" | "on";

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

export function PushSettingsCard({ team }: { team: boolean }) {
  const t = useT();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        // Abonnement rattaché au compte connecté (téléphone partagé, abonnement renouvelé).
        saveSubscription(sub).catch(() => undefined);
      } else {
        setState("off");
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      // La demande d'autorisation suit directement le toucher (exigence d'Apple).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const { publicKey } = await request<{ publicKey: string }>("/api/v1/push/key");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await saveSubscription(sub);
      setState("on");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("push.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
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

  return (
    <section className="dash-card p-5 sm:p-6" aria-labelledby="push-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="push-title" className="text-[17px] font-semibold text-white">
            {t("push.title")}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#b8a6a1]">{t("push.lead")}</p>
          {team && <p className="mt-1.5 text-[12px] text-[#8f7d77]">{t("push.teamNote")}</p>}
        </div>
        {state === "on" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)] px-3 py-1 text-[12px] font-medium text-[#6ee7b7]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
            {t("push.on")}
          </span>
        )}
      </div>

      {state === "loading" && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-[#8f7d77]">
          <Spinner />
        </p>
      )}

      {state === "install" && (
        <div className="mt-4">
          <p className="text-[13px] text-stone-200">{t("push.installIntro")}</p>
          <ol className="mt-2.5 space-y-2 text-[13px] text-stone-200">
            {(["push.step1", "push.step2", "push.step3"] as const).map((key, i) => (
              <li key={key} className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[rgba(255,138,92,0.16)] text-[11px] font-semibold text-[#ffb08a]">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{t(key)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {state === "unsupported" && <p className="mt-4 text-[13px] text-[#b8a6a1]">{t("push.unsupported")}</p>}

      {state === "denied" && (
        <p className="mt-4 rounded-xl border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-stone-200">
          {t("push.denied")}
        </p>
      )}

      {error && <p className="mt-3 text-[12.5px] text-[#fca5a5]">{error}</p>}

      {(state === "off" || state === "on") && (
        <div className="mt-4">
          {state === "off" ? (
            <button type="button" onClick={() => void enable()} disabled={busy} className="dash-btn dash-btn-primary disabled:opacity-60">
              {busy && <Spinner />} {t("push.enable")}
            </button>
          ) : (
            <button type="button" onClick={() => void disable()} disabled={busy} className="dash-btn dash-btn-ghost disabled:opacity-60">
              {busy && <Spinner />} {t("push.disable")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
