// Console de l'équipe : recherche et filtres des clients, modules visibles par
// un manager, compte client promu manager puis rendu à la clientèle.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { registerAdminConsoleRoutes } from "../src/modules/admin-console/routes.js";
import { createManager, deleteManager } from "../src/modules/admin-ops/service.js";
import { verifyPassword } from "../src/lib/password.js";
import { authFor, buildMiniApp, cleanup, createAdmin, createStaff, createUser, expectApiError, tracker } from "./helpers.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function consoleApp(session: Awaited<ReturnType<typeof authFor>>) {
  return buildMiniApp({ auth: session }, async (app) => {
    await app.register(registerAdminConsoleRoutes, { prefix: "/api/v1" });
  });
}

describe("Clients : recherche, ordre d'inscription, filtre d'identité", () => {
  it("trouve un membre par nom complet ou e-mail, vendeurs compris, récents d'abord", async () => {
    const { session } = await createAdmin(t);
    const older = await createUser(t);
    const vendor = await createUser(t, { role: "VENDOR" });
    await prisma.user.update({ where: { id: older.id }, data: { lastName: "Sowtest", kycStatus: "VERIFIED", createdAt: new Date(Date.now() - 86_400_000) } });
    await prisma.user.update({ where: { id: vendor.id }, data: { lastName: "Sowtest", kycStatus: "REJECTED" } });
    const app = await consoleApp(session);

    // « Prénom Nom » : chaque mot doit correspondre (avant : aucun résultat).
    const full = await app.inject({ method: "GET", url: `/api/v1/admin/clients?q=${encodeURIComponent(`${older.firstName} Sowtest`)}` });
    expect(full.json().data.map((r: { id: string }) => r.id)).toEqual([older.id]);

    // Les deux « Sowtest » : le vendeur (inscrit après) d'abord.
    const both = await app.inject({ method: "GET", url: "/api/v1/admin/clients?q=sowtest" });
    const rows = both.json().data as Array<{ id: string; role: string }>;
    expect(rows.map((r) => r.id)).toEqual([vendor.id, older.id]);
    expect(rows[0]!.role).toBe("VENDOR");
    expect(both.json().meta.counts).toMatchObject({ all: 2, verified: 1, rejected: 1, pending: 0, none: 0 });

    const verified = await app.inject({ method: "GET", url: "/api/v1/admin/clients?q=sowtest&kyc=verified" });
    expect(verified.json().data.map((r: { id: string }) => r.id)).toEqual([older.id]);
    const rejected = await app.inject({ method: "GET", url: "/api/v1/admin/clients?q=sowtest&kyc=rejected" });
    expect(rejected.json().data.map((r: { id: string }) => r.id)).toEqual([vendor.id]);

    // E-mail complet, depuis la recherche de l'en-tête.
    const quick = await app.inject({ method: "GET", url: `/api/v1/admin/search/members?q=${encodeURIComponent(vendor.email)}` });
    expect(quick.json().data.map((r: { id: string }) => r.id)).toEqual([vendor.id]);
    await app.close();
  });

  it("ne liste jamais l'équipe parmi les clients", async () => {
    const { session } = await createAdmin(t);
    const staff = await createStaff(t, ["SUPPORT"]);
    const app = await consoleApp(session);
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/clients?q=${encodeURIComponent(staff.user.email)}` });
    expect(res.json().data).toEqual([]);
    await app.close();
  });
});

describe("Modules visibles dans la console", () => {
  it("donne tout à l'administrateur, ses seuls modules au manager, rien au client", async () => {
    const admin = await createAdmin(t);
    const adminApp = await consoleApp(admin.session);
    const all = (await adminApp.inject({ method: "GET", url: "/api/v1/admin/me/access" })).json().data;
    expect(all.role).toBe("ADMIN");
    expect(all.permissions).toEqual(expect.arrayContaining(["KYC", "PAYMENTS", "SETTINGS", "STATS"]));
    await adminApp.close();

    const staff = await createStaff(t, ["STATS"]);
    const staffApp = await consoleApp(staff.session);
    const mine = (await staffApp.inject({ method: "GET", url: "/api/v1/admin/me/access" })).json().data;
    expect(mine).toMatchObject({ role: "STAFF", permissions: ["STATS"] });
    await staffApp.close();

    const client = await createUser(t);
    const clientApp = await consoleApp(await authFor(client.id));
    expect((await clientApp.inject({ method: "GET", url: "/api/v1/admin/me/access" })).statusCode).toBe(403);
    await clientApp.close();
  });
});

describe("Compte client promu manager", () => {
  const actor = async () => ({ actorId: (await createAdmin(t)).user.id, actorRole: "ADMIN" as const });

  it("garde son compte et son mot de passe, puis redevient client à la suppression", async () => {
    const client = await createUser(t, { password: "MonMotDePasse1!" });
    const session = await authFor(client.id);
    const created = await createManager(
      { email: client.email.toUpperCase(), firstName: "Autre", lastName: "Nom", permissions: ["ORDERS"], shifts: [] },
      await actor(),
    );
    expect(created.promoted).toBe(true);

    const promoted = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, include: { role: true, managerProfile: true } });
    expect(promoted.role.name).toBe("STAFF");
    expect(promoted.managerProfile?.previousRole).toBe("CLIENT");
    expect(promoted.firstName).toBe(client.firstName); // son nom reste le sien
    expect(await verifyPassword("MonMotDePasse1!", promoted.passwordHash!)).toBe(true);
    expect(await prisma.user.count({ where: { email: { equals: client.email, mode: "insensitive" } } })).toBe(1);

    const removed = await deleteManager(created.id, await actor());
    expect(removed.restoredRole).toBe("CLIENT");
    const back = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, include: { role: true } });
    expect(back.role.name).toBe("CLIENT");
    expect(back.deletedAt).toBeNull();
    expect(back.status).toBe("ACTIVE");
    // Ses sessions d'équipe sont coupées.
    expect(await prisma.session.count({ where: { id: session!.id } })).toBe(0);
  });

  it("refuse un vendeur, exige un mot de passe pour un nouveau compte, accepte des plages de jours", async () => {
    const vendor = await createUser(t, { role: "VENDOR" });
    const asSeller = await expectApiError(async () =>
      createManager({ email: vendor.email, firstName: "V", lastName: "V", permissions: ["ORDERS"] }, await actor()),
    );
    expect(asSeller.code).toBe("SELLER_CANNOT_BE_MANAGER");

    const email = `p13-new-${Date.now()}@example.com`;
    const noPassword = await expectApiError(async () =>
      createManager({ email, firstName: "N", lastName: "N", permissions: ["ORDERS"] }, await actor()),
    );
    expect(noPassword.code).toBe("PASSWORD_REQUIRED");

    // Du lundi au mercredi 09:00–12:00 + du jeudi au vendredi 14:00–18:00 : 5 lignes.
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY"] as const;
    const created = await createManager(
      {
        email,
        firstName: "N",
        lastName: "N",
        password: "MotDePasse123!",
        permissions: ["ORDERS"],
        shifts: [
          ...days.map((day) => ({ day, startMinute: 540, endMinute: 720 })),
          { day: "THURSDAY" as const, startMinute: 840, endMinute: 1080 },
          { day: "FRIDAY" as const, startMinute: 840, endMinute: 1080 },
        ],
      },
      await actor(),
    );
    t.userIds.push(created.userId);
    expect(created.promoted).toBe(false);
    expect(await prisma.managerShift.count({ where: { profileId: created.id } })).toBe(5);

    // Un compte créé pour l'équipe est désactivé à la suppression (pas rendu client).
    const removed = await deleteManager(created.id, await actor());
    expect(removed.restoredRole).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.userId } })).deletedAt).not.toBeNull();
  });
});
