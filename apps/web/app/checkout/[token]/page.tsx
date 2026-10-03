"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, errorMessage, formatXof, request, uploadFile } from "@/lib/api";
import { Alert, Button, Field, Spinner, StatusBadge, TextInput } from "@/components/ui";
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
  /** Lien Wave Business avec le montant déjà rempli (null : désactivé). */
  waveLink: string | null;
  proof: { status: "PENDING" | "APPROVED" | "REJECTED"; createdAt: string; reviewedAt: string | null; rejectionReason: string | null } | null;
};

// Preuve Wave en vérification par l'équipe : la réponse prend quelques minutes.
const REVIEW_POLL_MS = 15_000;

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
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(async () => {
    setState(await request<CheckoutState>(`/api/v1/payments/${token}`));
  }, [token]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    request<CheckoutState>(`/api/v1/payments/${token}`)
      .then((s) => {
        if (alive) setState(s);
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

  // Paiement en vérification par l'équipe : on guette la validation.
  const underReview = state?.status === "PROCESSING";

  useEffect(() => {
    if (!underReview) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, REVIEW_POLL_MS);
    return () => clearInterval(id);
  }, [underReview, refresh]);

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

  const typeLabel = ["ORDER_PAYMENT", "INITIAL_INSTALLMENT", "INSTALLMENT", "REFUND", "SELLER_REGISTRATION_FEE", "FEATURED"].includes(state.type)
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

      {state.status === "PENDING" && state.waveLink && (
        <WavePayment
          token={token}
          amount={state.amount}
          link={state.waveLink}
          rejection={state.proof?.status === "REJECTED" ? state.proof.rejectionReason : null}
          onSent={refresh}
        />
      )}

      {state.status === "PENDING" && !state.waveLink && (
        <div className="mt-6">
          <Alert tone="warning" title={t("pay.unavailable")}>
            {t("wave.unavailable")}
          </Alert>
        </div>
      )}

      {underReview && (
        <div className="mt-6 rounded-2xl border border-brand/30 bg-brand/10 px-5 py-5" role="status">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Spinner className="h-4 w-4 text-brand" /> {t("wave.reviewTitle")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {state.proof
              ? t("wave.reviewBody", {
                  date: new Date(state.proof.createdAt).toLocaleString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                })
              : t("pay.verifying")}
          </p>
          <Link href={backHref(state)} className="mt-4 inline-flex text-xs font-semibold text-brand underline">
            {t("wave.backToOrder")}
          </Link>
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

// ---------------------------------------------------------------------------
// Paiement par lien Wave Business : le montant est déjà écrit dans le lien.
// Le client paie dans Wave, revient, puis envoie sa preuve (capture du reçu +
// numéro Wave payeur). L'équipe vérifie la réception et valide.
// ---------------------------------------------------------------------------

function WavePayment({
  token,
  amount,
  link,
  rejection,
  onSent,
}: {
  token: string;
  amount: number;
  link: string;
  rejection: string | null;
  onSent: () => Promise<void>;
}) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = formatXof(amount);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError(t("wave.needScreenshot"));
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadFile(file, "payment_proof");
      await request(`/api/v1/payments/${token}/proof`, {
        method: "POST",
        body: JSON.stringify({ proofKey: uploaded.key, senderPhone: phone.trim(), waveReference: reference.trim() || undefined }),
      });
      await onSent();
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === "UNAUTHORIZED" ? t("pay.loginBody") : errorMessage(err, t("wave.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {rejection && (
        <Alert tone="danger" title={t("wave.rejectedTitle")}>
          {t("wave.rejectedBody", { reason: rejection })}
        </Alert>
      )}

      <section className="lux-glass rounded-[24px] p-6">
        <h2 className="text-base font-semibold text-stone-50">{t("wave.title")}</h2>
        <ol className="mt-4 space-y-3 text-sm text-stone-300">
          {(["wave.step1", "wave.step2", "wave.step3"] as const).map((key, i) => (
            <li key={key} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-xs tabular-nums text-stone-200">
                {i + 1}
              </span>
              <span className="pt-0.5 leading-relaxed">{t(key, { amount: price })}</span>
            </li>
          ))}
        </ol>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="lux-btn lux-btn-gold mt-5 flex w-full !min-h-[48px] items-center justify-center text-[12px] uppercase tracking-[0.14em]"
          style={{ borderRadius: 16 }}
        >
          {t("wave.open", { amount: price })}
        </a>
        <p className="mt-2 text-center text-xs text-stone-400">{t("wave.exactAmount", { amount: price })}</p>
      </section>

      <form onSubmit={(e) => void submit(e)} className="lux-glass space-y-4 rounded-[24px] p-6">
        <h2 className="text-base font-semibold text-stone-50">{t("wave.proofTitle")}</h2>
        <Field label={t("wave.screenshot")} hint={t("wave.screenshotHint")} required>
          <TextInput
            required
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-stone-200"
          />
        </Field>
        <Field label={t("wave.phone")} required>
          <TextInput
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t("wave.phonePlaceholder")}
          />
        </Field>
        <Field label={t("wave.reference")} hint={t("wave.referenceHint")}>
          <TextInput dir="ltr" maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy} disabled={busy}>
          {busy ? t("wave.sending") : t("wave.send")}
        </Button>
      </form>
    </div>
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
