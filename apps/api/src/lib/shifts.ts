import { prisma } from "@misterdou/db";
import { SHIFT_DAYS, SHIFT_DAY_LABELS, type ShiftDay } from "@misterdou/shared";
import { ApiError } from "./errors.js";

// ---------------------------------------------------------------------------
// Créneaux de l'équipe : un manager (STAFF) qui a des créneaux peut se
// connecter à toute heure, mais n'utilise son espace de gestion que pendant
// ces créneaux, à l'heure de Dakar. En dehors, l'API refuse tout (OUTSIDE_SHIFT)
// avec un message courtois : créneau terminé ou pas encore commencé, et quand
// l'accès reprend. Sans créneau : accès à toute heure. Les administrateurs ne
// sont jamais bloqués.
// ---------------------------------------------------------------------------

export const SHIFT_TIME_ZONE = "Africa/Dakar";

type Shift = { day: ShiftDay; startMinute: number; endMinute: number };

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: SHIFT_TIME_ZONE,
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Jour et minute de la journée à Dakar. */
export function dakarClock(now: Date = new Date()): { day: ShiftDay; minute: number } {
  const parts = Object.fromEntries(clock.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    day: String(parts.weekday).toUpperCase() as ShiftDay,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isOnShift(shifts: Shift[], now: Date = new Date()): boolean {
  if (shifts.length === 0) return true;
  const { day, minute } = dakarClock(now);
  return shifts.some((s) => s.day === day && minute >= s.startMinute && minute < s.endMinute);
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** « lundi → vendredi de 09:00 à 18:00 ; samedi de 10:00 à 14:00 ». */
export function scheduleLabel(shifts: Shift[]): string {
  const byHours = new Map<string, number[]>();
  for (const s of shifts) {
    const key = `${s.startMinute}-${s.endMinute}`;
    byHours.set(key, [...(byHours.get(key) ?? []), SHIFT_DAYS.indexOf(s.day)]);
  }
  const parts: Array<{ order: number; text: string }> = [];
  for (const [key, days] of byHours) {
    const [start, end] = key.split("-").map(Number) as [number, number];
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    let first = sorted[0]!;
    let prev = first;
    const flush = () => {
      const from = SHIFT_DAY_LABELS[SHIFT_DAYS[first]!].toLowerCase();
      const to = SHIFT_DAY_LABELS[SHIFT_DAYS[prev]!].toLowerCase();
      parts.push({ order: first * 10_000 + start, text: `${first === prev ? from : `${from} → ${to}`} de ${hhmm(start)} à ${hhmm(end)}` });
    };
    for (const day of sorted.slice(1)) {
      if (day === prev + 1) {
        prev = day;
        continue;
      }
      flush();
      first = day;
      prev = day;
    }
    flush();
  }
  return parts.sort((a, b) => a.order - b.order).map((p) => p.text).join(" ; ");
}

// Créneaux relus au plus une fois par minute et par membre : une modification
// faite dans « Équipe » s'applique dans la minute.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; shifts: Shift[] }>();

async function shiftsOf(userId: string): Promise<Shift[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.shifts;
  const profile = await prisma.managerProfile.findUnique({
    where: { userId },
    select: { managerShift: { select: { day: true, startMinute: true, endMinute: true } } },
  });
  const shifts = (profile?.managerShift ?? []) as Shift[];
  cache.set(userId, { at: Date.now(), shifts });
  return shifts;
}

/** Après une modification des créneaux d'un membre (prise en compte immédiate). */
export function forgetShifts(userId: string): void {
  cache.delete(userId);
}

/** Prochaine ouverture : dans combien de jours, quel jour, à quelle heure. */
function nextOpening(shifts: Shift[], now: Date): { inDays: number; day: ShiftDay; startMinute: number } | null {
  const { day, minute } = dakarClock(now);
  const today = SHIFT_DAYS.indexOf(day);
  for (let inDays = 0; inDays <= 7; inDays += 1) {
    const target = SHIFT_DAYS[(today + inDays) % 7]!;
    const starts = shifts
      .filter((s) => s.day === target && (inDays > 0 || s.startMinute > minute))
      .map((s) => s.startMinute);
    if (starts.length > 0) return { inDays, day: target, startMinute: Math.min(...starts) };
  }
  return null;
}

/** Ce que voit un manager hors de ses créneaux (titre, message, horaires). */
export function closedNotice(shifts: Shift[], now: Date = new Date()) {
  const { day, minute } = dakarClock(now);
  const next = nextOpening(shifts, now);
  const when = !next
    ? null
    : next.inDays === 0
      ? `aujourd’hui à ${hhmm(next.startMinute)}`
      : next.inDays === 1
        ? `demain à ${hhmm(next.startMinute)}`
        : `${SHIFT_DAY_LABELS[next.day].toLowerCase()} à ${hhmm(next.startMinute)}`;
  const endedToday = shifts.some((s) => s.day === day && s.endMinute <= minute);
  const title = endedToday
    ? "Votre créneau de travail est terminé"
    : next?.inDays === 0
      ? "Votre créneau n’a pas encore commencé"
      : "Vous n’êtes pas en service en ce moment";
  const lead = endedToday ? "Merci pour votre travail. " : "";
  const message = `${lead}Votre espace de gestion est accessible uniquement pendant vos heures de travail${when ? ` ; il rouvrira ${when} (heure de Dakar)` : ""}.`;
  return { title, message, schedule: scheduleLabel(shifts), reopens: when };
}

export function outsideShiftError(shifts: Shift[], now: Date = new Date()): ApiError {
  const notice = closedNotice(shifts, now);
  return new ApiError("OUTSIDE_SHIFT", 403, `${notice.title}. ${notice.message}`, notice);
}

/** Lève OUTSIDE_SHIFT si ce manager est hors de ses créneaux (sans effet pour les autres rôles). */
export async function assertOnShift(user: { id: string; role?: { name: string } | null }, now: Date = new Date()): Promise<void> {
  if (user.role?.name !== "STAFF") return;
  const shifts = await shiftsOf(user.id);
  if (!isOnShift(shifts, now)) throw outsideShiftError(shifts, now);
}
