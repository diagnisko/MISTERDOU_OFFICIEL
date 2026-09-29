// Compte membre : profil, mot de passe (changement / création pour un compte
// Google), photo de profil, et informations de connexion (connexion précédente).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createUser, tracker } from "./helpers.js";
import { registerAccountRoutes } from "../src/modules/account/routes.js";
import { login } from "../src/modules/auth/service.js";
import { writeLocalMedia } from "../src/lib/media.js";

const t = tracker();
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

afterAll(async () => {
  await cleanup(t);
});

async function appFor(userId: string): Promise<{ app: FastifyInstance; sessionId: string }> {
  const session = await authFor(userId);
  const app = await buildMiniApp({ auth: session }, async (instance) => {
    await instance.register(registerAccountRoutes, { prefix: "/api/v1" });
  });
  return { app, sessionId: session!.id };
}

describe("Profil", () => {
  it("met à jour prénom, nom, pays et ville sans toucher à l'e-mail", async () => {
    const user = await createUser(t);
    const { app } = await appFor(user.id);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/account/profile",
      payload: { firstName: "Awa", lastName: "Diop", country: "Sénégal", city: "Dakar" },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ firstName: "Awa", lastName: "Diop", country: "Sénégal", city: "Dakar", email: user.email });
    const audit = await prisma.auditLog.findFirst({ where: { userId: user.id, action: "PROFILE_UPDATED" } });
    expect(audit).not.toBeNull();
    await app.close();
  });

  it("refuse un prénom vide", async () => {
    const user = await createUser(t);
    const { app } = await appFor(user.id);
    const res = await app.inject({ method: "PATCH", url: "/api/v1/account/profile", payload: { firstName: "  " } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("Mot de passe", () => {
  it("refuse un mot de passe actuel incorrect", async () => {
    const user = await createUser(t, { password: "Ancien123!" });
    const { app } = await appFor(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/account/password",
      payload: { currentPassword: "Faux1234!", newPassword: "Nouveau123!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
    await app.close();
  });

  it("change le mot de passe, ferme les autres sessions et alerte le membre", async () => {
    const user = await createUser(t, { password: "Ancien123!" });
    const other = await authFor(user.id);
    const { app, sessionId } = await appFor(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/account/password",
      payload: { currentPassword: "Ancien123!", newPassword: "Nouveau123!" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.otherSessionsClosed).toBeGreaterThanOrEqual(1);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.find((s) => s.id === other!.id)?.revokedAt).not.toBeNull();
    expect(sessions.find((s) => s.id === sessionId)?.revokedAt).toBeNull();

    const alert = await prisma.notification.findFirst({ where: { userId: user.id, type: "SECURITY_ALERT" } });
    expect(alert?.priority).toBe("CRITICAL");

    await expect(login({ email: user.email, password: "Nouveau123!" }, {})).resolves.toMatchObject({ user: { id: user.id } });
    await app.close();
  });

  it("permet à un compte Google sans mot de passe d'en créer un, puis de se connecter par e-mail", async () => {
    const user = await createUser(t);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null, googleSub: `g-${user.id}` } });
    const { app } = await appFor(user.id);
    const res = await app.inject({ method: "POST", url: "/api/v1/account/password", payload: { newPassword: "Choisi123!" } });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { userId: user.id, action: "PASSWORD_SET" } });
    expect(audit).not.toBeNull();
    await expect(login({ email: user.email, password: "Choisi123!" }, {})).resolves.toMatchObject({ user: { id: user.id } });
    await app.close();
  });

  it("refuse un nouveau mot de passe trop court", async () => {
    const user = await createUser(t);
    const { app } = await appFor(user.id);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/account/password",
      payload: { currentPassword: "MotDePasse123!", newPassword: "court" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("Photo de profil", () => {
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    const user = await createUser(t);
    userId = user.id;
    ({ app } = await appFor(user.id));
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuse une vidéo et une image de plus de 2 Mo", async () => {
    const video = await app.inject({
      method: "POST",
      url: "/api/v1/account/avatar/upload-url",
      payload: { mimeType: "video/mp4", sizeBytes: 1000 },
    });
    expect(video.statusCode).toBe(400);
    const big = await app.inject({
      method: "POST",
      url: "/api/v1/account/avatar/upload-url",
      payload: { mimeType: "image/png", sizeBytes: 3 * 1024 * 1024 },
    });
    expect(big.statusCode).toBe(400);
    expect(big.json().error.code).toBe("FILE_TOO_LARGE");
  });

  it("enregistre la photo après vérification du fichier, puis la retire", async () => {
    const ticket = await app.inject({
      method: "POST",
      url: "/api/v1/account/avatar/upload-url",
      payload: { mimeType: "image/png", sizeBytes: PNG.length },
    });
    expect(ticket.statusCode).toBe(200);
    const key = ticket.json().data.key as string;
    expect(key.startsWith(`avatars/${userId}/`)).toBe(true);
    await writeLocalMedia(key, PNG);

    const saved = await app.inject({ method: "POST", url: "/api/v1/account/avatar", payload: { key, mimeType: "image/png" } });
    expect(saved.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).avatarKey).toBe(key);

    const removed = await app.inject({ method: "DELETE", url: "/api/v1/account/avatar", payload: {} });
    expect(removed.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).avatarKey).toBeNull();
  });

  it("refuse une clé qui n'appartient pas au membre", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/account/avatar",
      payload: { key: "avatars/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001.png", mimeType: "image/png" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Connexion", () => {
  it("accepte un vendeur et renvoie la date de la connexion précédente", async () => {
    const vendor = await createUser(t, { role: "VENDOR", password: "Vendeur123!" });
    const first = await login({ email: vendor.email, password: "Vendeur123!" }, {});
    expect(first.previousLoginAt).toBeNull();
    const second = await login({ email: vendor.email, password: "Vendeur123!" }, {});
    expect(second.previousLoginAt).not.toBeNull();
    expect(second.user.role).toBe("VENDOR");
  });
});
