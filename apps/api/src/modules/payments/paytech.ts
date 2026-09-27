// Adaptateur fournisseur de paiement (Wave / Orange Money agrégés).
// L'UI n'affiche JAMAIS l'agrégateur : uniquement « Wave » et « Orange Money ».
// Sans clé API (dev/sandbox) → mode local : le checkout est hébergé par nos soins
// et la confirmation arrive par le poll serveur / le stub dev (mêmes règles de
// règlement que le webhook réel — voir settlePayment).
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import { logger } from "../../lib/logger.js";

export type CheckoutMethod = "wave" | "orange_money";

export const CHECKOUT_METHODS: CheckoutMethod[] = ["wave", "orange_money"];

export const CHECKOUT_METHOD_LABELS: Record<CheckoutMethod, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
};

export function isProviderConfigured(): boolean {
  return Boolean(env.PAYTECH_API_KEY && env.PAYTECH_API_SECRET);
}

// ---------------------------------------------------------------------------
// Signature webhook — HMAC-SHA256(corps brut, PAYTECH_WEBHOOK_SECRET)
// ---------------------------------------------------------------------------

export function signWebhookBody(rawBody: string): string {
  if (!env.PAYTECH_WEBHOOK_SECRET) {
    throw new Error("PAYTECH_WEBHOOK_SECRET non configuré");
  }
  return createHmac("sha256", env.PAYTECH_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!env.PAYTECH_WEBHOOK_SECRET || !signature) return false;
  const expected = Buffer.from(signWebhookBody(rawBody), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

// Fenêtre anti-replay : horodatage unix (secondes) à ± maxSkewSeconds.
export function verifyWebhookTimestamp(header: string | undefined, maxSkewSeconds = 300): boolean {
  if (!header) return false;
  const ts = Number(header);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - ts) <= maxSkewSeconds;
}

export function isAllowedWebhookIp(ip: string): boolean {
  const raw = env.PAYTECH_WEBHOOK_IPS;
  if (!raw) return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(ip);
}

// ---------------------------------------------------------------------------
// Appels fournisseur (mode réel, sandbox) — chemins best-effort à confirmer
// avec la doc fournisseur (docs/06 §4) ; jamais appelés sans clé API.
// ---------------------------------------------------------------------------

export async function createProviderCheckout(input: {
  reference: string;
  amount: number;
  currency: string;
  method: CheckoutMethod;
  customerPhone?: string | null;
  callbackUrl: string;
}): Promise<{ url: string; reference: string }> {
  const res = await fetch(`${env.PAYTECH_BASE_URL}/api/payments/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.PAYTECH_API_KEY}`,
    },
    body: JSON.stringify({
      api_key: env.PAYTECH_API_KEY,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      method: input.method,
      customer_phone: input.customerPhone ?? undefined,
      callback_url: input.callbackUrl,
      sandbox: env.PAYTECH_SANDBOX,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, reference: input.reference }, "[payments] createCheckout fournisseur échoué");
    throw new Error(`Création du paiement fournisseur refusée (${res.status}) ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { payment_url?: string; url?: string; reference?: string };
  const url = data.payment_url ?? data.url;
  if (!url) throw new Error("Réponse fournisseur invalide (payment_url manquant)");
  return { url, reference: data.reference ?? input.reference };
}

export async function fetchProviderStatus(reference: string): Promise<"SUCCESS" | "FAILED" | "CANCELLED" | null> {
  if (!isProviderConfigured()) return null;
  try {
    const res = await fetch(`${env.PAYTECH_BASE_URL}/api/payments/transactions/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYTECH_API_KEY}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string };
    const s = (data.status ?? "").toUpperCase();
    if (s === "SUCCESS" || s === "FAILED" || s === "CANCELLED") return s;
    return null;
  } catch (err) {
    logger.warn({ err, reference }, "[payments] statut fournisseur injoignable (réessaiera)");
    return null;
  }
}
