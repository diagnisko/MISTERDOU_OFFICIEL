"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, formatXof, request } from "@/lib/api";
import { Alert, Button, Spinner, StatusBadge } from "@/components/ui";
import { LuxShell, LuxTopBar } from "@/components/lux/lux-shell";
import { useT, type MessageKey } from "@/lib/i18n";
import { refreshAccount } from "@/lib/account";

type CheckoutState = {
  status: string;
  amount: number;
  currency: string;
  type: string;
  paymentNumber: string;
  paidAt: string | null;
  orderId: string | null;
};

type CheckoutInit =
  | { mode: "REDIRECT"; url: string; status: string }
  | { mode: "LOCAL"; status: string }
  | { mode: "POLL"; status: string }
  | { mode: "DONE"; status: string };

type Method = "wave" | "orange_money";

const POLL_MS = 2500;

// Page de retour selon le motif du paiement.
function backHref(state: { type: string; orderId: string | null }) {
  if (state.type === "SELLER_REGISTRATION_FEE") return "/account/devenir-vendeur";
  if (state.type === "FEATURED") return "/seller";
  return state.orderId ? `/account/orders/${state.orderId}` : "/account/orders";
}


export default function CheckoutPage() {
  const t = useT();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [state, setState] = useState<CheckoutState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyMethod, setBusyMethod] = useState<Method | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pollErrors = useRef(0);

  const refresh = useCallback(async () => {
    const s = await request<CheckoutState>(`/api/v1/payments/${token}`);
    setState(s);
    if (s.status === "PROCESSING") setVerifying(true);
    if (s.status !== "PROCESSING") setVerifying(false);
    return s;
  }, [token]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    request<CheckoutState>(`/api/v1/payments/${token}`)
      .then((s) => {
        if (!alive) return;
        setState(s);
        if (s.status === "PROCESSING") setVerifying(true);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiClientError) {
          setLoadError(err.code === "NOT_FOUND" ? t("pay.notFound") : err.message);
        } else {
          setLoadError(t("pay.network"));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  // Succès → redirection selon le motif du paiement (côté serveur uniquement).
  useEffect(() => {
    // Retour sur la commande payée (identifiants, mensualités), sinon la liste.
    if (state?.status === "SUCCESS") {
      if (state.type === "SELLER_REGISTRATION_FEE") {
        // Le compte vient de passer vendeur : le menu du profil doit le savoir.
        void refreshAccount().then(() => router.replace("/seller"));
        return;
      }
      router.replace(state.type === "FEATURED" ? "/seller" : backHref(state));
    }
  }, [state, router]);

  // Polling de vérification serveur (mode local ou confirmation différée).
  useEffect(() => {
    if (!verifying || state?.status !== "PROCESSING") return;
    const id = setInterval(() => {
      request<CheckoutState>(`/api/v1/payments/${token}`)
        .then((s) => {
          pollErrors.current = 0;
          setState(s);
          if (s.status !== "PROCESSING") setVerifying(false);
        })
        .catch(() => {
          pollErrors.current += 1;
          if (pollErrors.current >= 5) setVerifying(false);
        });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [verifying, state?.status, token]);

  async function start(method: Method) {
    setBusyMethod(method);
    setActionError(null);
    setNeedLogin(false);
    try {
      const init = await request<CheckoutInit>(`/api/v1/payments/${token}/checkout`, {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      if (init.mode === "REDIRECT") {
        window.location.assign(init.url);
        return;
      }
      setState((prev) => (prev ? { ...prev, status: init.status } : prev));
      if (init.status === "PROCESSING") {
        pollErrors.current = 0;
        setVerifying(true);
      } else if (init.status !== "SUCCESS") {
        await refresh();
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        if (err.code === "UNAUTHORIZED") {
          setNeedLogin(true);
        } else {
          setActionError(err.message);
        }
        if (err.code === "CONFLICT") await refresh().catch(() => undefined);
      } else {
        setActionError(t("pay.network"));
      }
    } finally {
      setBusyMethod(null);
    }
  }

  if (loading) {
    return (
      <Main>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {t("pay.loading")}
        </p>
      </Main>
    );
  }

  if (loadError) {
    return (
      <Main>
        <p className="lux-kicker">{t("pay.kicker")}</p>
        <h1 className="mt-2">{t("pay.kicker")}</h1>
        <div className="mt-6">
          <Alert tone="danger" title={t("pay.unavailable")}>
            {loadError}
          </Alert>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/account/orders" className="lux-btn lux-btn-ghost lux-btn-sm">
            {t("pay.mySpace")}
          </Link>
          <Button variant="ghost" onClick={() => setAttempt((a) => a + 1)}>
            {t("pay.retry")}
          </Button>
        </div>
      </Main>
    );
  }

  if (!state) return null;

  const typeLabel = ["ORDER_PAYMENT", "INITIAL_INSTALLMENT", "INSTALLMENT", "REFUND", "SELLER_REGISTRATION_FEE"].includes(state.type)
    ? t(`pay.type${state.type}` as MessageKey)
    : t("pay.kicker");

  return (
    <Main>
      <Link href={backHref(state)} className="mb-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-[var(--lux-gold-light)]">
        {t("pay.back")}
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="lux-kicker">{t("pay.kicker")}</p>
          <h1 className="mt-2">{typeLabel}</h1>
        </div>
        <StatusBadge status={state.status} />
      </div>

      <div className="lux-glass mt-6 rounded-[24px] p-7">
        <p className="lux-kicker">{t("pay.amount")}</p>
        <p className="lux-serif mt-3 text-[42px] font-bold leading-none text-stone-50 tabular-nums">
          {formatXof(state.amount)}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          {t("pay.reference", { ref: state.paymentNumber })}
        </p>
      </div>

      {actionError && (
        <div className="mt-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}
      {needLogin && (
        <div className="mt-4">
          <Alert tone="warning" title={t("pay.loginTitle")}>
            {t("pay.loginBody")}{" "}
            <Link href="/login" className="font-semibold text-brand underline">
              {t("pay.login")}
            </Link>
          </Alert>
        </div>
      )}

      {state.status === "PENDING" && (
        <div className="mt-6">
          <p className="mb-3 text-sm text-muted">{t("pay.choose")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="flex-1" onClick={() => start("wave")} loading={busyMethod === "wave"} disabled={busyMethod !== null}>
              {t("pay.wave")}
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => start("orange_money")}
              loading={busyMethod === "orange_money"}
              disabled={busyMethod !== null}
            >
              {t("pay.orange")}
            </Button>
          </div>
        </div>
      )}

      {(state.status === "PROCESSING" || verifying) && (
        <div className="mt-6 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-5 text-center" role="status">
          <Spinner className="mx-auto h-5 w-5 text-brand" />
          <p className="mt-3 text-sm font-semibold">{t("pay.verifying")}</p>
          <p className="mt-1 text-xs text-muted">{t("pay.dontClose")}</p>
        </div>
      )}

      {state.status === "FAILED" && (
        <div className="mt-6">
          <Alert tone="danger" title={t("pay.failedTitle")}>
            {t("pay.failedBody")}
          </Alert>
        </div>
      )}
      {state.status === "CANCELLED" && (
        <div className="mt-6">
          <Alert tone="warning" title={t("pay.cancelledTitle")}>
            {t("pay.cancelledBody")}
          </Alert>
        </div>
      )}
      {state.status === "REFUNDED" && (
        <div className="mt-6">
          <Alert tone="info" title={t("pay.refundedTitle")}>
            {t("pay.refundedBody")}
          </Alert>
        </div>
      )}
      {state.status === "SUCCESS" && (
        <div className="mt-6">
          <Alert tone="success" title={t("pay.successTitle")}>
            {t("pay.successBody")}
          </Alert>
        </div>
      )}
    </Main>
  );
}

function Main({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <LuxShell>
      <LuxTopBar
        label={t("pay.secure")}
        links={[
          { href: "/account/orders", label: t("pay.mySpace") },
          { href: "/offres", label: t("pay.catalogue") },
        ]}
      />
      <main className="relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-12 md:px-8">{children}</main>
    </LuxShell>
  );
}
