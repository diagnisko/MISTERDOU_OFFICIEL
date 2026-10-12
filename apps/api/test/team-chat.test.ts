// Discussion d'équipe : salon commun et échanges privés entre administrateurs
// et managers ; privés pour de vrai (ni clients, ni modération) ; non lus ;
// notifications sur le téléphone seulement pour l'équipe en service.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createStaff, createUser, track, tracker } from "./helpers.js";
import { registerTeamChatRoutes } from "../src/modules/team-chat/routes.js";
import { registerMessagingRoutes } from "../src/modules/messaging/routes.js";
import { setPushTransport } from "../src/lib/push.js";
import { dakarClock, forgetShifts } from "../src/lib/shifts.js";

const t = tracker();
const pushed: Array<{ endpoint: string; title: string }> = [];
setPushTransport(async (sub, body) => {
  pushed.push({ endpoint: sub.endpoint, title: JSON.parse(body).title });
  return { statusCode: 201 };
});

beforeEach(() => {
  pushed.length = 0;
});

afterAll(async () => {
  await prisma.teamPost.deleteMany({ where: { senderId: { in: t.userIds } } });
  await cleanup(t);
});

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

async function offDuty(userId: string) {
  const profile = await prisma.managerProfile.findUniqueOrThrow({ where: { userId } });
  const tomorrow = DAYS[(DAYS.indexOf(dakarClock().day) + 1) % 7]!;
  await prisma.managerShift.createMany({ data: [{ profileId: profile.id, day: tomorrow, startMinute: 600, endMinute: 660 }] });
  forgetShifts(userId);
}

async function phone(userId: string) {
  const endpoint = `https://push.example.test/${userId}`;
  await prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: "p".repeat(40), auth: "a".repeat(16) } });
  return endpoint;
}

const appFor = (session: Awaited<ReturnType<typeof authFor>>) =>
  buildMiniApp({ auth: session }, async (a) => {
    await a.register(registerTeamChatRoutes, { prefix: "/api/v1" });
    await a.register(registerMessagingRoutes, { prefix: "/api/v1" });
  });

describe("Salon « Toute l'équipe »", () => {
  it("un manager écrit, l'administrateur le voit en non lu puis le lit ; les membres en service sont prévenus", async () => {
    const admin = await createAdmin(t);
    const staff = await createStaff(t, ["KYC"]);
    const sleeping = await createStaff(t, ["ORDERS"]);
    await offDuty(sleeping.user.id);
    const adminPhone = await phone(admin.user.id);
    const sleepingPhone = await phone(sleeping.user.id);

    const staffApp = await appFor(staff.session);
    const sent = await staffApp.inject({ method: "POST", url: "/api/v1/admin/team-chat/room/messages", payload: { content: "Bonjour l'équipe, je prends les vérifications ce matin." } });
    expect(sent.statusCode).toBe(200);
    expect(pushed.some((p) => p.endpoint === adminPhone && p.title.includes("Toute l'équipe"))).toBe(true);
    expect(pushed.some((p) => p.endpoint === sleepingPhone)).toBe(false); // hors créneau : pas dérangé
    // Pas de ligne dans la cloche pour le salon.
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: "NEW_MESSAGE" } })).toBe(0);

    const adminApp = await appFor(admin.session);
    expect((await adminApp.inject({ method: "GET", url: "/api/v1/admin/team-chat/unread" })).json().data.room).toBeGreaterThanOrEqual(1);
    const room = await adminApp.inject({ method: "GET", url: "/api/v1/admin/team-chat/room/messages" });
    expect(room.json().data.items.some((m: { content: string }) => m.content.includes("je prends les vérifications"))).toBe(true);
    expect((await adminApp.inject({ method: "GET", url: "/api/v1/admin/team-chat/unread" })).json().data.room).toBe(0);
    await staffApp.close();
    await adminApp.close();
  });

  it("un client ne peut ni lire ni écrire dans le salon", async () => {
    const client = await createUser(t);
    const app = await appFor(await authFor(client.id));
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/team-chat/room/messages" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/team-chat/room/messages", payload: { content: "x" } })).statusCode).toBe(403);
    await app.close();
  });
});

describe("Échange privé entre membres de l'équipe", () => {
  it("l'administrateur écrit à un manager : une seule conversation, privée, notifiée, lisible par les deux seulement", async () => {
    const admin = await createAdmin(t);
    const staff = await createStaff(t, ["SUPPORT"]);
    const other = await createStaff(t, ["SUPPORT"]);
    const staffPhone = await phone(staff.user.id);

    const adminApp = await appFor(admin.session);
    const opened = await adminApp.inject({ method: "POST", url: "/api/v1/admin/team-chat/direct", payload: { userId: staff.user.id } });
    const conversationId = opened.json().data.conversationId as string;
    track(t, "conversationIds", conversationId);
    const again = await adminApp.inject({ method: "POST", url: "/api/v1/admin/team-chat/direct", payload: { userId: staff.user.id } });
    expect(again.json().data.conversationId).toBe(conversationId);

    const msg = await adminApp.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/messages`, payload: { content: "Peux-tu rappeler le client de la commande MD-123 ?" } });
    expect(msg.statusCode).toBe(200);
    expect(pushed.some((p) => p.endpoint === staffPhone)).toBe(true);
    const notif = await prisma.notification.findFirstOrThrow({ where: { userId: staff.user.id, type: "NEW_MESSAGE" } });
    expect(notif.actionUrl).toBe(`/admin/chat?with=${admin.user.id}`);

    // Le manager le voit dans sa liste, en non lu.
    const staffApp = await appFor(staff.session);
    const overview = (await staffApp.inject({ method: "GET", url: "/api/v1/admin/team-chat" })).json().data;
    const row = overview.members.find((m: { id: string }) => m.id === admin.user.id);
    expect(row).toMatchObject({ conversationId, unread: 1, role: "ADMIN", onDuty: true });

    // Un autre manager (même avec la permission Support) ne peut pas le lire.
    const otherApp = await appFor(other.session);
    expect((await otherApp.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/messages` })).statusCode).toBe(404);
    // Et ces échanges n'apparaissent pas dans la liste des conversations clients.
    expect((await adminApp.inject({ method: "GET", url: "/api/v1/admin/conversations" })).json().data.some((c: { id: string }) => c.id === conversationId)).toBe(false);
    await adminApp.close();
    await staffApp.close();
    await otherApp.close();
  });

  it("impossible d'ouvrir un échange d'équipe avec un client", async () => {
    const admin = await createAdmin(t);
    const client = await createUser(t);
    const app = await appFor(admin.session);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/team-chat/direct", payload: { userId: client.id } })).statusCode).toBe(400);
    await app.close();
  });
});
