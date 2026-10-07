// Créneaux de l'équipe : hors de ses créneaux (heure de Dakar), un manager se
// connecte mais ne peut rien faire dans son espace de gestion (message
// courtois avec la réouverture) ; un administrateur n'est jamais bloqué.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { SESSION_COOKIE_NAME } from "@misterdou/shared";
import { cleanup, createAdmin, createStaff, tracker } from "./helpers.js";
import { buildApp } from "../src/app.js";
import { createSession } from "../src/lib/sessions.js";
import { loginAdmin } from "../src/modules/admin-console/auth.js";
import { closedNotice, dakarClock, forgetShifts, isOnShift, scheduleLabel } from "../src/lib/shifts.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

/** Un créneau d'une minute… qui n'est jamais maintenant (le jour d'après, à cette heure). */
function shiftNotNow() {
  const { day } = dakarClock();
  const other = DAYS[(DAYS.indexOf(day) + 1) % 7]!;
  return { day: other, startMinute: 600, endMinute: 601 };
}

/** Créneau couvrant toute la journée en cours. */
function shiftNow() {
  return { day: dakarClock().day, startMinute: 0, endMinute: 1440 };
}

async function setShifts(userId: string, shifts: Array<{ day: (typeof DAYS)[number]; startMinute: number; endMinute: number }>) {
  const profile = await prisma.managerProfile.findUniqueOrThrow({ where: { userId } });
  await prisma.managerShift.deleteMany({ where: { profileId: profile.id } });
  if (shifts.length) await prisma.managerShift.createMany({ data: shifts.map((s) => ({ ...s, profileId: profile.id })) });
  forgetShifts(userId);
}

describe("Horloge et créneaux", () => {
  it("lit l'heure de Dakar (UTC toute l'année)", () => {
    expect(dakarClock(new Date("2026-10-07T13:45:00Z"))).toEqual({ day: "WEDNESDAY", minute: 13 * 60 + 45 });
  });

  it("ouvert pendant le créneau, fermé avant et à l'heure de fin ; sans créneau : toujours ouvert", () => {
    const shifts = [{ day: "WEDNESDAY" as const, startMinute: 9 * 60, endMinute: 18 * 60 }];
    expect(isOnShift(shifts, new Date("2026-10-07T09:00:00Z"))).toBe(true);
    expect(isOnShift(shifts, new Date("2026-10-07T17:59:00Z"))).toBe(true);
    expect(isOnShift(shifts, new Date("2026-10-07T18:00:00Z"))).toBe(false);
    expect(isOnShift(shifts, new Date("2026-10-08T10:00:00Z"))).toBe(false);
    expect(isOnShift([], new Date("2026-10-08T03:00:00Z"))).toBe(true);
  });

  it("résume les horaires en français", () => {
    const weekdays = DAYS.slice(0, 5).map((day) => ({ day, startMinute: 540, endMinute: 1080 }));
    expect(scheduleLabel([...weekdays, { day: "SATURDAY", startMinute: 600, endMinute: 840 }])).toBe(
      "lundi → vendredi de 09:00 à 18:00 ; samedi de 10:00 à 14:00",
    );
  });
});

describe("Console fermée hors créneaux", () => {
  it("la connexion reste possible hors créneau (c'est l'espace qui est fermé)", async () => {
    const staff = await createStaff(t, ["SUPPORT"]);
    await setShifts(staff.user.id, [shiftNotNow()]);
    await expect(loginAdmin({ email: staff.user.email, password: "MotDePasse123!" }, {})).resolves.toMatchObject({ role: "STAFF" });
  });

  it("message courtois : créneau terminé, pas encore commencé, ou jour sans service", () => {
    const weekdays = DAYS.slice(0, 5).map((day) => ({ day, startMinute: 540, endMinute: 1080 }));
    // Mercredi 19:00 : terminé, reprise demain.
    const ended = closedNotice(weekdays, new Date("2026-10-07T19:00:00Z"));
    expect(ended.title).toBe("Votre créneau de travail est terminé");
    expect(ended.message).toBe(
      "Merci pour votre travail. Votre espace de gestion est accessible uniquement pendant vos heures de travail ; il rouvrira demain à 09:00 (heure de Dakar).",
    );
    // Mercredi 07:30 : pas encore commencé.
    expect(closedNotice(weekdays, new Date("2026-10-07T07:30:00Z"))).toMatchObject({
      title: "Votre créneau n’a pas encore commencé",
      reopens: "aujourd’hui à 09:00",
    });
    // Samedi : pas de service, reprise lundi.
    expect(closedNotice(weekdays, new Date("2026-10-10T12:00:00Z"))).toMatchObject({
      title: "Vous n’êtes pas en service en ce moment",
      reopens: "lundi à 09:00",
      schedule: "lundi → vendredi de 09:00 à 18:00",
    });
  });

  it("session ouverte : la console répond « fermée », le reste du site le voit comme visiteur ; l'admin passe toujours", async () => {
    const app = await buildApp({ logger: false });
    const staff = await createStaff(t, ["SUPPORT", "STATS"]);
    const cookie = (sid: string) => `${SESSION_COOKIE_NAME}=${app.signCookie(sid)}`;
    const sid = await createSession({ userId: staff.user.id, kind: "COOKIE", ttlSeconds: 600 });

    await setShifts(staff.user.id, [shiftNow()]);
    const open = await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: { cookie: cookie(sid) } });
    expect(open.statusCode).toBe(200);

    await setShifts(staff.user.id, [shiftNotNow()]);
    const closed = await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: { cookie: cookie(sid) } });
    expect(closed.statusCode).toBe(403);
    expect(closed.json().error).toMatchObject({ code: "OUTSIDE_SHIFT", details: { reopens: expect.any(String) } });
    // Aucune action possible non plus (ex. répondre au support).
    const write = await app.inject({ method: "GET", url: "/api/v1/admin/support/tickets", headers: { cookie: cookie(sid) } });
    expect(write.json().error.code).toBe("OUTSIDE_SHIFT");

    // Hors console : plus reconnu (messagerie d'équipe impossible) ; « qui suis-je » reste lisible.
    const convos = await app.inject({ method: "GET", url: "/api/v1/conversations", headers: { cookie: cookie(sid) } });
    expect(convos.statusCode).toBe(401);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: cookie(sid) } });
    expect(me.statusCode).toBe(200);

    // L'administrateur n'a jamais de créneau bloquant.
    const admin = await createAdmin(t);
    const adminSid = await createSession({ userId: admin.user.id, kind: "COOKIE", ttlSeconds: 600, isAdminSession: true });
    const adminRes = await app.inject({ method: "GET", url: "/api/v1/admin/me/access", headers: { cookie: cookie(adminSid) } });
    expect(adminRes.statusCode).toBe(200);
    await app.close();
  });
});
