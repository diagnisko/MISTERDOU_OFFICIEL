// PHASE 13 — Connexion Google (§39 : « connexion Google »). Le client OAuth
// est MOCKÉ : seul le gate de configuration (GOOGLE_OAUTH_CLIENT_ID) et le
// rattachement du compte Google (création, liaison e-mail existant, refus
// hors CLIENT) sont vérifiés contre la base locale.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@misterdou/db";
import { SUITE_STARTED_AT, buildMiniApp, cleanup, createAdmin, createUser, tracker, track } from "./helpers.js";
import { env } from "../src/env.js";
import { loginWithGoogle } from "../src/modules/auth/service.js";
import { registerAuthRoutes } from "../src/modules/auth/routes.js";

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    constructor(public clientId: string) {}
    async verifyIdToken({ idToken }: { idToken: string }): Promise<{ getPayload: () => unknown }> {
      const part = idToken.split(".")[1] ?? "";
      const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
      if (payload.__fail) throw new Error("invalid_grant");
      return { getPayload: () => payload };
    }
  },
}));

const t = tracker();

function tokenFor(payload: Record<string, unknown>): string {
  return `hdr.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

afterAll(async () => {
  await cleanup(t);
});

describe("Connexion Google", () => {
  it("refuse le flux quand GOOGLE_OAUTH_CLIENT_ID est absent", async () => {
    const saved = env.GOOGLE_OAUTH_CLIENT_ID;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (env as Record<string, unknown>).GOOGLE_OAUTH_CLIENT_ID;
    try {
      const err = await loginWithGoogle(tokenFor({ sub: "s", email: "a@b.c" }), {}).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "GOOGLE_OAUTH_NOT_CONFIGURED" });
    } finally {
      (env as Record<string, unknown>).GOOGLE_OAUTH_CLIENT_ID = saved;
    }
  });

  it("crée un compte CLIENT au premier jeton et le reconnait au second", async () => {
    await createAdmin(t);
    const email = `p13-google-${Date.now()}@x`;
    const token = tokenFor({ sub: "p13-sub-1", email, email_verified: true });

    const first = await loginWithGoogle(token, { ip: "127.0.0.1" });
    track(t, "userIds", first.user.id);
    expect(first.phoneRequired).toBe(true);
    expect(first.sid).toBeTruthy();
    expect(first.user.email).toBe(email);
    expect(first.user.role).toBe("CLIENT");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(row.googleSub).toBe("p13-sub-1");
    expect(row.emailVerifiedAt).not.toBeNull();

    const alert = await prisma.notification.findFirst({
      where: { type: "ADMIN_ALERT", message: { contains: email }, createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(alert).not.toBeNull();

    const second = await loginWithGoogle(token, {});
    expect(second.user.id).toBe(first.user.id);
    const count = await prisma.user.count({ where: { googleSub: "p13-sub-1" } });
    expect(count).toBe(1);
  });

  it("rattache un jeton à un compte e-mail existant sans en créer un second", async () => {
    const existing = await createUser(t);
    const before = await prisma.user.count();
    const token = tokenFor({ sub: "p13-sub-link", email: existing.email, email_verified: false });

    const result = await loginWithGoogle(token, {});
    expect(result.user.id).toBe(existing.id);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.googleSub).toBe("p13-sub-link");
    expect(await prisma.user.count()).toBe(before);
    expect(row.emailVerifiedAt).toBeNull();
  });

  it("refuse un jeton sans e-mail, un jeton invalide et un compte d'équipe", async () => {
    await expect(loginWithGoogle(tokenFor({ sub: "no-email" }), {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Jeton Google invalide",
    });

    await expect(loginWithGoogle(tokenFor({ __fail: 1, sub: "x", email: "y@z" }), {})).rejects.toThrow(
      "invalid_grant",
    );

    const staff = await createUser(t, { role: "STAFF" });
    await expect(
      loginWithGoogle(tokenFor({ sub: "p13-sub-staff", email: staff.email }), {}),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", message: "Identifiants invalides" });
  });

  it("accepte un vendeur et renvoie sa connexion précédente", async () => {
    const vendor = await createUser(t, { role: "VENDOR" });
    const first = await loginWithGoogle(tokenFor({ sub: "p13-sub-vendor", email: vendor.email }), {});
    expect(first.user.role).toBe("VENDOR");
    const again = await loginWithGoogle(tokenFor({ sub: "p13-sub-vendor", email: vendor.email }), {});
    expect(again.previousLoginAt).not.toBeNull();
    expect(again.created).toBe(false);
  });
});

describe("Route /auth/google (inject)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildMiniApp({}, async (instance) => {
      await instance.register(import("@fastify/cookie"), { secret: "p13-test-secret" });
      await instance.register(registerAuthRoutes, { prefix: "/api/v1" });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuse un corps absent ou un idToken trop court", async () => {
    const empty = await app.inject({ method: "POST", url: "/api/v1/auth/google", payload: {} });
    expect(empty.statusCode).toBe(400);

    const short = await app.inject({ method: "POST", url: "/api/v1/auth/google", payload: { idToken: "abc" } });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("connecte, pose le cookie de session et journalise LOGIN_GOOGLE", async () => {
    const email = `p13-google-route-${Date.now()}@x`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/google",
      payload: { idToken: tokenFor({ sub: "p13-sub-route", email, email_verified: true }) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user.email).toBe(email);
    expect(body.data.phoneRequired).toBe(true);
    track(t, "userIds", body.data.user.id as string);

    const setCookie = res.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
    expect(cookie).toContain("md_sid=");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "LOGIN_GOOGLE", userId: body.data.user.id, createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(audit).not.toBeNull();
  });

  it("répond GOOGLE_OAUTH_NOT_CONFIGURED si la variable est retirée en cours de route", async () => {
    const saved = env.GOOGLE_OAUTH_CLIENT_ID;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (env as Record<string, unknown>).GOOGLE_OAUTH_CLIENT_ID;
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/google",
        payload: { idToken: tokenFor({ sub: "x", email: "y@z.io" }) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("GOOGLE_OAUTH_NOT_CONFIGURED");
    } finally {
      (env as Record<string, unknown>).GOOGLE_OAUTH_CLIENT_ID = saved;
    }
  });
});
