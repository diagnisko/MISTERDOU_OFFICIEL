import { createECDH, hkdfSync } from "node:crypto";
import webpush from "web-push";
import { prisma } from "@misterdou/db";
import { env } from "../env.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Notifications sur le téléphone (Web Push) : elles arrivent dans le centre de
// notifications comme celles d'une application, même site fermé. Sur iPhone,
// le site doit être ajouté à l'écran d'accueil (iOS 16.4+).
//
// Clés VAPID : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY si elles sont réglées,
// sinon dérivées de STORAGE_MASTER_KEY (HKDF, étiquette dédiée) : rien à
// configurer, et les abonnements restent valides d'un redémarrage à l'autre.
// ---------------------------------------------------------------------------

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

const b64url = (buf: Buffer) => buf.toString("base64url");

function deriveVapidKeys(secret: string): { publicKey: string; privateKey: string } {
  for (let i = 0; ; i += 1) {
    const d = Buffer.from(hkdfSync("sha256", secret, "misterdou-web-push", `vapid-p256-${i}`, 32));
    const n = BigInt(`0x${d.toString("hex")}`);
    if (n === 0n || n >= P256_ORDER) continue;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(d);
    return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(d) };
  }
}

let keys: { publicKey: string; privateKey: string } | null = null;

export function vapidKeys(): { publicKey: string; privateKey: string } {
  if (!keys) {
    const fromEnv = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
    keys = fromEnv
      ? { publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! }
      : deriveVapidKeys(env.STORAGE_MASTER_KEY);
  }
  return keys;
}

/** Contact exigé par les services push (Apple refuse « localhost ») : l'adresse d'envoi des e-mails. */
function vapidSubject(): string {
  const address = env.EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env.EMAIL_FROM;
  return address.includes("@") && !address.endsWith(".local") ? `mailto:${address.trim()}` : "mailto:contact@misterdou.com";
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page ouverte au toucher de la notification. */
  url: string;
  /** Même tag : la nouvelle notification remplace la précédente (ex. une conversation). */
  tag?: string;
}

/** Transport réel ; remplaçable dans les tests. */
export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  body: string,
) => Promise<{ statusCode: number }>;

let transport: PushTransport = async (subscription, body) => {
  const { publicKey, privateKey } = vapidKeys();
  const res = await webpush.sendNotification(subscription, body, {
    vapidDetails: { subject: vapidSubject(), publicKey, privateKey },
    TTL: 24 * 3600,
    urgency: "high",
    timeout: 8000,
  });
  return { statusCode: res.statusCode };
};

export function setPushTransport(next: PushTransport): void {
  transport = next;
}

/**
 * Envoie la notification à tous les appareils de ces membres. Renvoie les
 * membres atteints sur au moins un appareil (les autres reçoivent l'e-mail de
 * secours). Un appareil expiré (404/410) est oublié. Ne lève jamais.
 */
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<Set<string>> {
  const reached = new Set<string>();
  if (userIds.length === 0) return reached;
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
    });
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body.length > 180 ? `${payload.body.slice(0, 177)}…` : payload.body,
      url: payload.url,
      tag: payload.tag,
    });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await transport({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
          reached.add(sub.userId);
          await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            logger.warn({ status, err: (err as Error).message }, "[push] envoi refusé");
          }
        }
      }),
    );
  } catch (err) {
    logger.warn({ err }, "[push] échec des notifications sur téléphone");
  }
  return reached;
}
