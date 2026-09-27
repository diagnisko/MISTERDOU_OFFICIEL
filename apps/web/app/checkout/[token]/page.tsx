"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, formatXof, request } from "@/lib/api";
import { Alert, Button, Spinner, StatusBadge } from "@/components/ui";
import { LuxShell, LuxTopBar } from "@/components/lux/lux-shell";

type CheckoutState = {
  status: string;
  amount: number;
  currency: string;
  type: string;
  paymentNumber: string;
  paidAt: string | null;
};

type CheckoutInit =
  | { mode: "REDIRECT"; url: string; status: string }
  | { mode: "LOCAL"; status: string }
  | { mode: "POLL"; status: string }
  | { mode: "DONE"; status: string };

type Method = "wave" | "orange_money";

const POLL_MS = 2500;

const TYPE_LABELS: Record<string, string> = {
  ORDER_PAYMENT: "Paiement de commande",
  INITIAL_INSTALLMENT: "Première mensualité",
  INSTALLMENT: "Mensualité",
  REFUND: "Remboursement",
};

export default function CheckoutPage() {
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
          setLoadError(err.code === "NOT_FOUND" ? "Transaction introuvable ou expirée." : err.message);
        } else {
          setLoadError("Erreur réseau");
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
    if (state?.status === "SUCCESS") {
      router.replace("/account");
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
        setActionError("Erreur réseau");
      }
    } finally {
      setBusyMethod(null);
    }
  }

  if (loading) {
    return (
      <Main>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Chargement du paiement…
        </p>
      </Main>
    );
  }

  if (loadError) {
    return (
      <Main>
        <p className="lux-kicker">Paiement</p>
        <h1 className="mt-2">Paiement</h1>
        <div className="mt-6">
          <Alert tone="danger" title="Paiement indisponible">
            {loadError}
          </Alert>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/account" className="lux-btn lux-btn-ghost lux-btn-sm">
            Mon espace
          </Link>
          <Button variant="ghost" onClick={() => setAttempt((a) => a + 1)}>
            Réessayer
          </Button>
        </div>
      </Main>
    );
  }

  if (!state) return null;

  const typeLabel = TYPE_LABELS[state.type] ?? "Paiement";

  return (
    <Main>
      <Link href="/account" className="mb-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-[var(--lux-gold-light)]">
        ← Mon espace
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="lux-kicker">Paiement</p>
          <h1 className="mt-2">{typeLabel}</h1>
        </div>
        <StatusBadge status={state.status} />
      </div>

      <div className="lux-glass mt-6 rounded-[24px] p-7">
        <p className="lux-kicker">Montant à régler</p>
        <p className="lux-serif mt-3 text-[42px] font-bold leading-none text-stone-50 tabular-nums">
          {formatXof(state.amount)}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Référence <span className="font-mono text-stone-200">{state.paymentNumber}</span> — la confirmation
          arrive toujours du serveur, jamais de votre navigateur.
        </p>
      </div>

      {actionError && (
        <div className="mt-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}
      {needLogin && (
        <div className="mt-4">
          <Alert tone="warning" title="Connexion requise">
            Connectez-vous pour régler ce paiement, puis revenez sur cette page.{" "}
            <Link href="/login" className="font-semibold text-brand underline">
              Se connecter
            </Link>
          </Alert>
        </div>
      )}

      {state.status === "PENDING" && (
        <div className="mt-6">
          <p className="mb-3 text-sm text-muted">Choisissez votre canal de paiement :</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="flex-1" onClick={() => start("wave")} loading={busyMethod === "wave"} disabled={busyMethod !== null}>
              Payer avec Wave
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => start("orange_money")}
              loading={busyMethod === "orange_money"}
              disabled={busyMethod !== null}
            >
              Payer avec Orange Money
            </Button>
          </div>
        </div>
      )}

      {(state.status === "PROCESSING" || verifying) && (
        <div className="mt-6 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-5 text-center" role="status">
          <Spinner className="mx-auto h-5 w-5 text-brand" />
          <p className="mt-3 text-sm font-semibold">Paiement en cours de vérification…</p>
          <p className="mt-1 text-xs text-muted">Ne fermez pas cette page, la confirmation arrive sous quelques instants.</p>
        </div>
      )}

      {state.status === "FAILED" && (
        <div className="mt-6">
          <Alert tone="danger" title="Paiement échoué">
            Le règlement n&apos;a pas abouti. Faites une nouvelle demande depuis votre espace.
          </Alert>
        </div>
      )}
      {state.status === "CANCELLED" && (
        <div className="mt-6">
          <Alert tone="warning" title="Paiement annulé">
            Cette transaction est clôturée. Vous pouvez relancer une nouvelle demande.
          </Alert>
        </div>
      )}
      {state.status === "REFUNDED" && (
        <div className="mt-6">
          <Alert tone="info" title="Paiement remboursé">
            Ce paiement a été remboursé. Les fonds suivent le canal utilisé à l&apos;origine.
          </Alert>
        </div>
      )}
      {state.status === "SUCCESS" && (
        <div className="mt-6">
          <Alert tone="success" title="Paiement confirmé">
            Redirection vers votre espace…
          </Alert>
        </div>
      )}
    </Main>
  );
}

function Main({ children }: { children: React.ReactNode }) {
  return (
    <LuxShell>
      <LuxTopBar
        label="Paiement sécurisé"
        links={[
          { href: "/account", label: "Mon espace" },
          { href: "/catalogue", label: "Catalogue" },
        ]}
      />
      <main className="relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-12 md:px-8">{children}</main>
    </LuxShell>
  );
}
