// Notifications sur le téléphone de l'équipe : seule l'équipe en service est
// prévenue (créneaux), l'e-mail ne part qu'en secours, appareils expirés oubliés,
// rappel du travail en attente au début d'un créneau.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createStaff, createUser, tracker } from "./helpers.js";

const sentEmails: string[] = [];
vi.mock("../src/lib/email.js", () => ({
  sendEmail: vi.fn(async (input: { to: string }) => {
    sentEmails.push(input.to);
    return { queued: true };
  }),
}));

const { notifyTeam, teamOnDuty } = await import("../src/lib/notify.js");
const { setPushTransport, vapidKeys } = await import("../src/lib/push.js");
const { dakarClock, forgetShifts } = await import("../src/lib/shifts.js");
const { resetShiftDigest, runShiftDigest, shiftStartsAt } = await import("../src/lib/shift-digest.js");
const { registerPushRoutes } = await import("../src/modules/push/routes.js");

const t = tracker();
const pushed: Array<{ endpoint: string; body: { title: string; body: string; url: string; tag?: string } }> = [];
let failWith: number | null = null;

setPushTransport(async (sub, body) => {
  if (failWith) throw Object.assign(new Error("refusé"), { statusCode: failWith });
  pushed.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
  return { statusCode: 201 };
});

beforeEach(() => {
  pushed.length = 0;
  sentEmails.length = 0;
  failWith = null;
});

afterAll(async () => {
  await cleanup(t);
});

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

async function setShifts(userId: string, shifts: Array<{ day: (typeof DAYS)[number]; startMinute: number; endMinute: number }>) {
  const profile = await prisma.managerProfile.findUniqueOrThrow({ where: { userId } });
  await prisma.managerShift.deleteMany({ where: { profileId: profile.id } });
  if (shifts.length) await prisma.managerShift.createMany({ data: shifts.map((s) => ({ ...s, profileId: profile.id })) });
  forgetShifts(userId);
}

async function subscribe(userId: string) {
  const endpoint = `https://push.example.test/${userId}-${Math.random().toString(36).slice(2)}`;
  await prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: "p".repeat(40), auth: "a".repeat(16) } });
  return endpoint;
}

describe("Clés VAPID", () => {
  it("dérivées du secret : stables et valides (clé publique P-256 non compressée)", () => {
    const { publicKey, privateKey } = vapidKeys();
    expect(vapidKeys().publicKey).toBe(publicKey);
    const pub = Buffer.from(publicKey, "base64url");
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(4);
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    expect(ecdh.getPublicKey().equals(pub)).toBe(true);
  });
});

describe("Alerte d'équipe selon les créneaux", () => {
  it("administrateur toujours ; manager en service oui ; hors créneau non ; sans la permission non", async () => {
    const admin = await createAdmin(t);
    const onDuty = await createStaff(t, ["PAYMENTS"]);
    const offDuty = await createStaff(t, ["PAYMENTS"]);
    const otherArea = await createStaff(t, ["KYC"]);
    const { day } = dakarClock();
    const tomorrow = DAYS[(DAYS.indexOf(day) + 1) % 7]!;
    await setShifts(onDuty.user.id, [{ day, startMinute: 0, endMinute: 1440 }]);
    await setShifts(offDuty.user.id, [{ day: tomorrow, startMinute: 600, endMinute: 660 }]);

    const ids = await teamOnDuty("PAYMENTS");
    expect(ids).toContain(admin.user.id);
    expect(ids).toContain(onDuty.user.id);
    expect(ids).not.toContain(offDuty.user.id);
    expect(ids).not.toContain(otherArea.user.id);
  });

  it("téléphone abonné : notification, pas d'e-mail ; sans téléphone : e-mail de secours", async () => {
    const withPhone = await createStaff(t, ["WITHDRAWALS"]);
    const withoutPhone = await createStaff(t, ["WITHDRAWALS"]);
    const endpoint = await subscribe(withPhone.user.id);

    await notifyTeam("WITHDRAWALS", "ADMIN_ALERT", { title: "Nouvelle demande de retrait", message: "40 000 FCFA à envoyer.", actionUrl: "/admin/withdrawals" }, { tag: "w-1" });

    const mine = pushed.find((p) => p.endpoint === endpoint);
    expect(mine?.body).toMatchObject({ title: "Nouvelle demande de retrait", url: "/admin/withdrawals", tag: "w-1" });
    const emails = await prisma.user.findMany({ where: { id: { in: [withPhone.user.id, withoutPhone.user.id] } }, select: { id: true, email: true } });
    const emailOf = (id: string) => emails.find((u) => u.id === id)!.email!;
    expect(sentEmails).not.toContain(emailOf(withPhone.user.id));
    expect(sentEmails).toContain(emailOf(withoutPhone.user.id));
    // La cloche reste remplie pour tous.
    expect(await prisma.notification.count({ where: { userId: { in: [withPhone.user.id, withoutPhone.user.id] }, title: "Nouvelle demande de retrait" } })).toBe(2);
  });

  it("appareil expiré (410) : oublié, et l'e-mail part en secours", async () => {
    const staff = await createStaff(t, ["KYC"]);
    const endpoint = await subscribe(staff.user.id);
    failWith = 410;
    await notifyTeam("KYC", "ADMIN_ALERT", { title: "Nouvelle vérification", message: "Un dossier attend.", actionUrl: "/admin/verifications" });
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id }, select: { email: true } });
    expect(sentEmails).toContain(email);
  });
});

describe("Abonnement d'un appareil", () => {
  it("l'équipe s'abonne puis se désabonne ; un client ne peut pas s'abonner", async () => {
    const admin = await createAdmin(t);
    const app = await buildMiniApp({ auth: admin.session }, async (a) => {
      await a.register(registerPushRoutes, { prefix: "/api/v1" });
    });
    const key = await app.inject({ method: "GET", url: "/api/v1/push/key" });
    expect(key.json().data.publicKey).toBe(vapidKeys().publicKey);

    const endpoint = `https://push.example.test/admin-${Date.now()}`;
    const sub = await app.inject({ method: "POST", url: "/api/v1/push/subscribe", payload: { endpoint, keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } } });
    expect(sub.json().data).toMatchObject({ subscribed: true, devices: 1 });

    await app.inject({ method: "DELETE", url: "/api/v1/push/subscribe", payload: { endpoint } });
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
    await app.close();

    const client = await createUser(t);
    const clientApp = await buildMiniApp({ auth: await authFor(client.id) }, async (a) => {
      await a.register(registerPushRoutes, { prefix: "/api/v1" });
    });
    const refused = await clientApp.inject({ method: "POST", url: "/api/v1/push/subscribe", payload: { endpoint: "https://push.example.test/x", keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } } });
    expect(refused.statusCode).toBe(403);
    await clientApp.close();
  });
});

describe("Rappel au début du créneau", () => {
  it("un créneau qui en prolonge un autre ne déclenche pas de second rappel", () => {
    const shifts = [
      { day: "MONDAY" as const, startMinute: 540, endMinute: 720 },
      { day: "MONDAY" as const, startMinute: 720, endMinute: 1080 },
    ];
    expect(shiftStartsAt(shifts, 540)).toBe(true);
    expect(shiftStartsAt(shifts, 720)).toBe(false);
  });

  it("le manager dont le créneau commence reçoit le travail en attente de ses domaines", async () => {
    const staff = await createStaff(t, ["KYC"]);
    const endpoint = await subscribe(staff.user.id);
    const user = await createUser(t);
    await prisma.identityVerification.create({
      data: { userId: user.id, documentType: "NATIONAL_ID", status: "PENDING", documentFrontKey: "kyc/test-front", selfieKey: "kyc/test-selfie", firstName: "Test", lastName: "Rappel" },
    });

    // Créneau qui commence à la minute suivante.
    const now = new Date();
    const next = new Date(now.getTime() + 60_000);
    const { day, minute } = dakarClock(next);
    await setShifts(staff.user.id, [{ day, startMinute: minute, endMinute: Math.min(1440, minute + 60) }]);

    resetShiftDigest();
    await runShiftDigest(now); // charge les créneaux, rien ne commence encore
    pushed.length = 0;
    await runShiftDigest(next);

    const mine = pushed.find((p) => p.endpoint === endpoint);
    expect(mine?.body.title).toBe("Début de votre créneau");
    expect(mine?.body.body).toMatch(/identités? à vérifier/);
    expect(mine?.body.body).not.toMatch(/paiement/); // hors de ses domaines

    // Même minute repassée : pas de second rappel.
    pushed.length = 0;
    await runShiftDigest(next);
    expect(pushed.some((p) => p.endpoint === endpoint)).toBe(false);
  });
});
