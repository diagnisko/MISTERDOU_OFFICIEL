// Notifications : un membre masque (sélection ou toutes), seul l'administrateur
// supprime définitivement ; on n'agit jamais sur les notifications d'un autre.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createStaff, createUser, tracker } from "./helpers.js";
import { registerNotificationRoutes } from "../src/modules/notifications/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function seed(userId: string, count: number, read = false) {
  const now = Date.now();
  await prisma.notification.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      type: "SYSTEM" as const,
      title: `Notification ${i + 1}`,
      message: "Essai",
      readAt: read ? new Date() : null,
      createdAt: new Date(now - i * 1000),
    })),
  });
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
}

async function appFor(session: Awaited<ReturnType<typeof authFor>>) {
  return buildMiniApp({ auth: session }, async (a) => {
    await a.register(registerNotificationRoutes, { prefix: "/api/v1" });
  });
}

describe("Masquer des notifications", () => {
  it("un client masque sa sélection : elle quitte sa liste et ne compte plus comme non lue", async () => {
    const client = await createUser(t);
    const rows = await seed(client.id, 5);
    const other = await createUser(t);
    const [foreign] = await seed(other.id, 1);
    const app = await appFor(await authFor(client.id));

    const res = await app.inject({ method: "POST", url: "/api/v1/notifications/hide", payload: { ids: [rows[0]!.id, rows[1]!.id, foreign!.id] } });
    expect(res.json().data.hidden).toBe(2); // celle d'un autre membre n'est pas touchée

    const list = await app.inject({ method: "GET", url: "/api/v1/notifications" });
    expect(list.json().meta).toMatchObject({ total: 3, unread: 3 });
    expect(await prisma.notification.count({ where: { id: foreign!.id, hiddenAt: null } })).toBe(1);

    const del = await app.inject({ method: "POST", url: "/api/v1/notifications/delete", payload: { all: true } });
    expect(del.statusCode).toBe(403);
    expect(await prisma.notification.count({ where: { userId: client.id } })).toBe(5); // masquées, pas supprimées
    await app.close();
  });

  it("« tout » masque toutes les pages ; un membre de l'équipe masque aussi (sans supprimer)", async () => {
    const staff = await createStaff(t, ["SUPPORT"]);
    await seed(staff.user.id, 30);
    const app = await appFor(staff.session);
    const res = await app.inject({ method: "POST", url: "/api/v1/notifications/hide", payload: { all: true } });
    expect(res.json().data.hidden).toBe(30);
    expect((await app.inject({ method: "GET", url: "/api/v1/notifications" })).json().meta.total).toBe(0);
    expect((await app.inject({ method: "POST", url: "/api/v1/notifications/delete", payload: { all: true } })).statusCode).toBe(403);
    await app.close();
  });

  it("onglet « non lues » : « tout » ne vise que les non lues", async () => {
    const client = await createUser(t);
    await seed(client.id, 3);
    await seed(client.id, 2, true);
    const app = await appFor(await authFor(client.id));
    const res = await app.inject({ method: "POST", url: "/api/v1/notifications/hide", payload: { all: true, unreadOnly: true } });
    expect(res.json().data.hidden).toBe(3);
    expect((await app.inject({ method: "GET", url: "/api/v1/notifications" })).json().meta.total).toBe(2);
    await app.close();
  });

  it("sélection vide refusée", async () => {
    const client = await createUser(t);
    const app = await appFor(await authFor(client.id));
    expect((await app.inject({ method: "POST", url: "/api/v1/notifications/hide", payload: { ids: [] } })).statusCode).toBe(400);
    await app.close();
  });
});

describe("Supprimer (administrateur)", () => {
  it("l'administrateur supprime définitivement sa sélection, puis tout", async () => {
    const admin = await createAdmin(t);
    const rows = await seed(admin.user.id, 4);
    const app = await appFor(admin.session);
    const one = await app.inject({ method: "POST", url: "/api/v1/notifications/delete", payload: { ids: [rows[0]!.id] } });
    expect(one.json().data.deleted).toBe(1);
    expect(await prisma.notification.count({ where: { userId: admin.user.id } })).toBe(3);
    const all = await app.inject({ method: "POST", url: "/api/v1/notifications/delete", payload: { all: true } });
    expect(all.json().data.deleted).toBe(3);
    expect(await prisma.notification.count({ where: { userId: admin.user.id } })).toBe(0);
    await app.close();
  });
});
