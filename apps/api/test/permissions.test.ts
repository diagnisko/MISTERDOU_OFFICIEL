// PHASE 13 — Permissions et accès non autorisés (§39 : « permissions »,
// « accès non autorisés »). Matrice rôles x garde : anonyme, CLIENT, STAFF
// avec/sans permission, ADMIN avec/sans session renforcée, sur les garde-lib
// et sur de vraies routes admin.
import { afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@misterdou/db";
import {
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createStaff,
  createUser,
  tracker,
} from "./helpers.js";
import { requireAdminSession, requireAuth, requirePermission, requireRoles } from "../src/lib/auth-context.js";
import { registerAdminOpsRoutes } from "../src/modules/admin-ops/routes.js";
import { registerIdentityVerificationRoutes } from "../src/modules/identity-verification/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

type AuthOpt = Awaited<ReturnType<typeof authFor>> | undefined;

async function guardedApp(opts: { auth: AuthOpt }): Promise<FastifyInstance> {
  return buildMiniApp(opts, async (app) => {
    app.get("/guard/auth", async (request, reply) => {
      const auth = requireAuth(request);
      return reply.send({ ok: true, id: auth.user.id });
    });
    app.get("/guard/roles", async (request, reply) => {
      const auth = requireRoles(request, ["ADMIN"]);
      return reply.send({ ok: true, id: auth.user.id });
    });
    app.get("/guard/admin-session", async (request, reply) => {
      const auth = requireAdminSession(request);
      return reply.send({ ok: true, id: auth.user.id });
    });
    app.get("/guard/settings", async (request, reply) => {
      const auth = await requirePermission(request, "SETTINGS");
      return reply.send({ ok: true, id: auth.user.id });
    });
    app.get("/guard/kyc", async (request, reply) => {
      const auth = await requirePermission(request, "KYC");
      return reply.send({ ok: true, id: auth.user.id });
    });
  });
}

describe("Garde-lib authentification / rôles", () => {
  it("exige une authentification puis le bon rôle", async () => {
    const anon = await guardedApp({ auth: undefined });
    expect((await anon.inject({ method: "GET", url: "/guard/auth" })).statusCode).toBe(401);
    expect((await anon.inject({ method: "GET", url: "/guard/roles" })).statusCode).toBe(401);
    expect((await anon.inject({ method: "GET", url: "/guard/admin-session" })).statusCode).toBe(401);
    expect((await anon.inject({ method: "GET", url: "/guard/settings" })).statusCode).toBe(401);
    await anon.close();

    const client = await createUser(t);
    const clientApp = await guardedApp({ auth: await authFor(client.id) });
    expect((await clientApp.inject({ method: "GET", url: "/guard/auth" })).statusCode).toBe(200);
    const roles = await clientApp.inject({ method: "GET", url: "/guard/roles" });
    expect(roles.statusCode).toBe(403);
    expect(roles.json().error.message).toBeDefined();
    await clientApp.close();
  });

  it("ADMIN sans session renforcée reste bloqué par requireAdminSession", async () => {
    const admin = await createAdmin(t);

    const weakApp = await guardedApp({ auth: await authFor(admin.user.id) });
    const weak = await weakApp.inject({ method: "GET", url: "/guard/admin-session" });
    expect(weak.statusCode).toBe(403);
    expect(weak.json().error.message).toContain("renforcée");
    await weakApp.close();

    const strongApp = await guardedApp({ auth: admin.session });
    const strong = await strongApp.inject({ method: "GET", url: "/guard/admin-session" });
    expect(strong.statusCode).toBe(200);
    await strongApp.close();
  });

  it("ADMIN sans MFA est refusé même avec une session admin", async () => {
    const user = await createUser(t, { role: "ADMIN", twoFactorEnabled: false });
    const session = await authFor(user.id, { isAdminSession: true });
    const app = await guardedApp({ auth: session });

    const denied = await app.inject({ method: "GET", url: "/guard/admin-session" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toContain("renforcée");

    const perm = await app.inject({ method: "GET", url: "/guard/settings" });
    expect(perm.statusCode).toBe(403);
    await app.close();
  });
});

describe("Garde-lib permissions (matrice STAFF / ADMIN)", () => {
  it("STAFF n'accède qu'aux permissions portées par son profil manager", async () => {
    const staff = await createStaff(t, ["KYC"]);
    const app = await guardedApp({ auth: staff.session });

    expect((await app.inject({ method: "GET", url: "/guard/kyc" })).statusCode).toBe(200);
    const denied = await app.inject({ method: "GET", url: "/guard/settings" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toBe("Permission requise : Paramètres & équipe");
    await app.close();
  });

  it("STAFF sans profil manager est refusé", async () => {
    const user = await createUser(t, { role: "STAFF" });
    const app = await guardedApp({ auth: await authFor(user.id) });
    const res = await app.inject({ method: "GET", url: "/guard/kyc" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Permission requise");
    await app.close();
  });

  it("CLIENT est systématiquement refusé sur les gardes-lib de permission", async () => {
    const client = await createUser(t);
    const app = await guardedApp({ auth: await authFor(client.id) });
    expect((await app.inject({ method: "GET", url: "/guard/settings" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/guard/kyc" })).statusCode).toBe(403);
    await app.close();
  });

  it("ADMIN avec session renforcée franchit toutes les permissions", async () => {
    const admin = await createAdmin(t);
    const app = await guardedApp({ auth: admin.session });
    expect((await app.inject({ method: "GET", url: "/guard/settings" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/guard/kyc" })).statusCode).toBe(200);
    await app.close();
  });

  it("ADMIN hors session admin est bloqué par requirePermission", async () => {
    const admin = await createAdmin(t);
    const plain = await authFor(admin.user.id);
    const app = await guardedApp({ auth: plain });
    const res = await app.inject({ method: "GET", url: "/guard/settings" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("renforcée");
    await app.close();
  });
});

describe("Routes admin réelles (matrice)", () => {
  async function adminRoutes(auth: AuthOpt): Promise<FastifyInstance> {
    return buildMiniApp({ auth }, async (app) => {
      await app.register(registerAdminOpsRoutes, { prefix: "/api/v1" });
      await app.register(registerIdentityVerificationRoutes, { prefix: "/api/v1" });
    });
  }

  it("les routes Settings / KYC admin suivent la permission, l'anonyme reste 401", async () => {
    const anon = await adminRoutes(undefined);
    for (const url of ["/api/v1/admin/settings", "/api/v1/admin/audit", "/api/v1/admin/kyc"]) {
      const res = await anon.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    await anon.close();

    const client = await createUser(t);
    const clientApp = await adminRoutes(await authFor(client.id));
    for (const url of ["/api/v1/admin/settings", "/api/v1/admin/audit", "/api/v1/admin/kyc"]) {
      const res = await clientApp.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(403);
    }
    await clientApp.close();

    const staffOnlyWithdrawals = await createStaff(t, ["WITHDRAWALS"]);
    const wrongApp = await adminRoutes(staffOnlyWithdrawals.session);
    expect((await wrongApp.inject({ method: "GET", url: "/api/v1/admin/settings" })).statusCode).toBe(403);
    expect((await wrongApp.inject({ method: "GET", url: "/api/v1/admin/kyc" })).statusCode).toBe(403);
    await wrongApp.close();

    const staffKyc = await createStaff(t, ["KYC", "SETTINGS"]);
    const rightApp = await adminRoutes(staffKyc.session);
    expect((await rightApp.inject({ method: "GET", url: "/api/v1/admin/settings" })).statusCode).toBe(200);
    expect((await rightApp.inject({ method: "GET", url: "/api/v1/admin/kyc" })).statusCode).toBe(200);
    await rightApp.close();

    const admin = await createAdmin(t);
    const adminApp = await adminRoutes(admin.session);
    expect((await adminApp.inject({ method: "GET", url: "/api/v1/admin/settings" })).statusCode).toBe(200);
    expect((await adminApp.inject({ method: "GET", url: "/api/v1/admin/audit" })).statusCode).toBe(200);
    await adminApp.close();
  });

  it("l'écriture Settings est réservée à l'ADMIN en session renforcée", async () => {
    const staff = await createStaff(t, ["SETTINGS"]);
    const staffApp = await adminRoutes(staff.session);
    const staffWrite = await staffApp.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/sellerCommissionPercent",
      payload: { value: 12 },
    });
    expect(staffWrite.statusCode).toBe(403);
    await staffApp.close();

    const admin = await createAdmin(t);
    const weakAdmin = await adminRoutes(await authFor(admin.user.id));
    const weakWrite = await weakAdmin.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/sellerCommissionPercent",
      payload: { value: 12 },
    });
    expect(weakWrite.statusCode).toBe(403);
    expect(weakWrite.json().error.message).toContain("renforcée");
    await weakAdmin.close();

    // La valeur n'a pas bougé : le refus est bien monté avant toute écriture.
    const setting = await prisma.settings.findUnique({ where: { key: "sellerCommissionPercent" } });
    expect(setting?.value).toBe(15);
  });

  it("l'équipe (création de manager) refuse STAFF et ADMIN non renforcé", async () => {
    const staff = await createStaff(t, ["SETTINGS"]);
    const staffApp = await adminRoutes(staff.session);
    const staffCreate = await staffApp.inject({
      method: "POST",
      url: "/api/v1/admin/managers",
      payload: {
        email: "p13-forge@x",
        firstName: "P13",
        lastName: "Forge",
        password: "MotDePasse-123",
        permissions: ["SETTINGS"],
      },
    });
    expect(staffCreate.statusCode).toBe(403);
    await staffApp.close();

    const admin = await createAdmin(t);
    const weakApp = await adminRoutes(await authFor(admin.user.id));
    const weakCreate = await weakApp.inject({
      method: "POST",
      url: "/api/v1/admin/managers",
      payload: {
        email: "p13-forge2@x",
        firstName: "P13",
        lastName: "Forge",
        password: "MotDePasse-123",
        permissions: ["SETTINGS"],
      },
    });
    expect(weakCreate.statusCode).toBe(403);
    await weakApp.close();

    expect(await prisma.user.count({ where: { email: { startsWith: "p13-forge" } } })).toBe(0);
  });
});
