import { prisma } from "@misterdou/db";
import type { ManagerPermission } from "@misterdou/db";
import { SHIFT_DAYS, type ShiftDay } from "@misterdou/shared";
import { logger } from "./logger.js";
import { notifyMany } from "./notify.js";
import { dakarClock, shiftsVersion } from "./shifts.js";

// ---------------------------------------------------------------------------
// Rappel au début du créneau : un manager hors service n'est pas dérangé ;
// quand son créneau commence, il reçoit le travail en attente dans ses
// domaines (« En attente : 3 messages, 2 paiements Wave à vérifier… »).
// Les créneaux sont gardés en mémoire (relus seulement quand l'équipe change) :
// le contrôle de chaque minute ne réveille pas la base Neon.
// ---------------------------------------------------------------------------

type Shift = { day: ShiftDay; startMinute: number; endMinute: number };
type Member = { userId: string; permissions: ManagerPermission[]; shifts: Shift[] };

let schedule: Member[] | null = null;
let loadedVersion = -1;
let lastTick: number | null = null;

async function loadSchedule(): Promise<Member[]> {
  const rows = await prisma.managerProfile.findMany({
    where: { user: { status: "ACTIVE", deletedAt: null, role: { name: "STAFF" } }, managerShift: { some: {} } },
    select: { userId: true, permissions: true, managerShift: { select: { day: true, startMinute: true, endMinute: true } } },
  });
  return rows.map((r) => ({ userId: r.userId, permissions: r.permissions, shifts: r.managerShift as Shift[] }));
}

/** Minute absolue de la semaine (lundi 00:00 = 0). */
const weekMinute = (day: ShiftDay, minute: number) => SHIFT_DAYS.indexOf(day) * 1440 + minute;

/** Début d'un créneau qui ne prolonge pas un autre (09–12 puis 12–18 : un seul rappel, à 9 h). */
export function shiftStartsAt(shifts: Shift[], at: number): boolean {
  const week = 7 * 1440;
  const starts = shifts.some((s) => weekMinute(s.day, s.startMinute) === at);
  if (!starts) return false;
  return !shifts.some((s) => weekMinute(s.day, s.endMinute) % week === at);
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Ce qui attend l'équipe dans les domaines de ce manager. */
export async function pendingWork(permissions: ManagerPermission[]): Promise<string[]> {
  const has = (p: ManagerPermission) => permissions.includes(p);
  const parts: string[] = [];
  if (has("SUPPORT")) {
    const [conversations, tickets, threads] = await Promise.all([
      prisma.conversation.count({ where: { message: { some: { readAt: null, user: { role: { name: { in: ["CLIENT", "VENDOR"] } } } } } } }),
      prisma.supportTicket.count({ where: { status: { in: ["CREATED", "PENDING"] } } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM "ProductThread" t JOIN "Product" p ON p.id = t."productId"
        WHERE p."sellerId" IS NULL AND (t."teamLastReadAt" IS NULL OR t."teamLastReadAt" < t."lastMessageAt")`,
    ]);
    const messages = conversations + Number(threads[0]?.count ?? 0);
    if (messages > 0) parts.push(plural(messages, "discussion non lue", "discussions non lues"));
    if (tickets > 0) parts.push(plural(tickets, "demande au support", "demandes au support"));
  }
  if (has("PAYMENTS")) {
    const n = await prisma.paymentProof.count({ where: { status: "PENDING" } });
    if (n > 0) parts.push(plural(n, "paiement Wave à vérifier", "paiements Wave à vérifier"));
  }
  if (has("KYC")) {
    const n = await prisma.identityVerification.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } });
    if (n > 0) parts.push(plural(n, "identité à vérifier", "identités à vérifier"));
  }
  if (has("WITHDRAWALS")) {
    const n = await prisma.withdrawal.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } });
    if (n > 0) parts.push(plural(n, "retrait à traiter", "retraits à traiter"));
  }
  if (has("PRODUCTS")) {
    const [offers, featured] = await Promise.all([
      prisma.product.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
      prisma.featuredProduct.count({ where: { status: "PENDING" } }),
    ]);
    if (offers + featured > 0) parts.push(plural(offers + featured, "offre à valider", "offres à valider"));
  }
  if (has("ORDERS")) {
    const n = await prisma.verificationCodeRequest.count({ where: { status: "PENDING" } });
    if (n > 0) parts.push(plural(n, "code de vérification demandé", "codes de vérification demandés"));
  }
  return parts;
}

/** Une minute : rappel aux managers dont le créneau commence. */
export async function runShiftDigest(now: Date = new Date()): Promise<number> {
  if (!schedule || loadedVersion !== shiftsVersion()) {
    loadedVersion = shiftsVersion();
    schedule = await loadSchedule();
  }
  const { day, minute } = dakarClock(now);
  const current = weekMinute(day, minute);
  // Minutes écoulées depuis le dernier passage (au plus 10, si la machine a pris du retard).
  const week = 7 * 1440;
  const elapsed = lastTick === null ? 1 : Math.min(10, (current - lastTick + week) % week);
  lastTick = current;
  const minutes = Array.from({ length: elapsed }, (_, i) => (current - i + week) % week);

  let sent = 0;
  for (const member of schedule) {
    if (!minutes.some((at) => shiftStartsAt(member.shifts, at))) continue;
    const parts = await pendingWork(member.permissions);
    if (parts.length === 0) continue;
    await notifyMany(
      "ADMIN_ALERT",
      [{ userId: member.userId, params: { title: "Début de votre créneau", message: `En attente : ${parts.join(", ")}.`, actionUrl: "/admin", priority: "NORMAL" } }],
      { push: { tag: "shift-start" } },
    );
    sent += 1;
  }
  return sent;
}

export function startShiftDigestJob(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runShiftDigest().catch((err) => logger.warn({ err }, "[shift-digest] échec du rappel de début de créneau"));
  }, 60_000);
  timer.unref();
  return timer;
}

/** Tests : repartir d'un état neuf. */
export function resetShiftDigest(): void {
  schedule = null;
  loadedVersion = -1;
  lastTick = null;
}
