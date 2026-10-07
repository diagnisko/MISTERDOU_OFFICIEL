// PHASE 13 — KYC (§39 : « vérification d'identité (upload, revue admin,
// décisions) »). Exercé en service + routes in-process (app.inject).
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createUser,
  expectApiError,
  multipartBody,
  putStorageFile,
  tracker,
} from "./helpers.js";
import {
  createUploadKey,
  getMyVerification,
  getVerificationFile,
  listPendingVerifications,
  reviewVerification,
  submitVerification,
  validateUploadPurpose,
} from "../src/modules/identity-verification/service.js";
import { registerIdentityVerificationRoutes } from "../src/modules/identity-verification/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

interface Keys {
  front: string;
  back: string;
  selfie: string;
}

async function kycFiles(userId: string): Promise<Keys> {
  const front = createUploadKey(userId, "kyc_front");
  const back = createUploadKey(userId, "kyc_back");
  const selfie = createUploadKey(userId, "kyc_selfie");
  await putStorageFile(t, front, "recto-p13");
  await putStorageFile(t, back, "verso-p13");
  await putStorageFile(t, selfie, "selfie-p13");
  return { front, back, selfie };
}

async function submitCni(userId: string, override: Record<string, unknown> = {}) {
  const keys = await kycFiles(userId);
  return submitVerification(
    {
      documentType: "NATIONAL_ID",
      firstName: "P13",
      lastName: "Dossier",
      birthDate: "1990-05-04",
      country: "SN",
      city: "Dakar",
      address: "Carré 12",
      documentFrontKey: keys.front,
      documentBackKey: keys.back,
      selfieKey: keys.selfie,
      ...override,
    },
    { actorId: userId, actorRole: "CLIENT", ip: "127.0.0.1" },
  );
}

describe("Souscription du dossier KYC", () => {
  it("soumet un dossier CNI, passe l'utilisateur en PENDING et alerte les administrateurs", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t, { phone: true });

    const record = await submitCni(user.id);

    expect(record.status).toBe("PENDING");
    expect(record.birthDate).toBe("1990-05-04");
    // La réponse de soumission ne renvoie pas l'historique (lu via /kyc/me).
    expect(record.history).toHaveLength(0);

    const myView = await getMyVerification(user.id);
    expect(myView.records[0]?.history).toHaveLength(1);
    expect(myView.records[0]?.history[0]).toMatchObject({ status: "PENDING", reason: "Dossier soumis" });

    const row = await prisma.identityVerification.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.status).toBe("PENDING");
    expect(row.reviewedAt).toBeNull();
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(userRow.kycStatus).toBe("PENDING");
    expect(userRow.verifiedAt).toBeNull();

    const alert = await prisma.notification.findFirst({
      where: {
        userId: admin.user.id,
        type: "ADMIN_ALERT",
        title: "Nouvelle vérification",
        createdAt: { gte: SUITE_STARTED_AT },
      },
    });
    expect(alert).not.toBeNull();
  });

  it("refuse un second dossier tant que le premier est en cours", async () => {
    const user = await createUser(t, { phone: true });
    await submitCni(user.id);
    const err = await expectApiError(() => submitCni(user.id));
    expect(err.code).toBe("KYC_ALREADY_PENDING");
    expect(err.statusCode).toBe(409);
  });

  it("refuse un document appartenant à un autre compte", async () => {
    const owner = await createUser(t, { phone: true });
    const intruder = await createUser(t, { phone: true });
    const keys = await kycFiles(owner.id);

    const err = await expectApiError(() =>
      submitVerification(
        {
          documentType: "NATIONAL_ID",
          firstName: "P13",
          lastName: "Intrus",
          documentFrontKey: keys.front,
          documentBackKey: keys.back,
          selfieKey: keys.selfie,
        },
        { actorId: intruder.id, actorRole: "CLIENT", ip: "127.0.0.1" },
      ),
    );
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("ne correspond pas à votre compte");
  });

  it("accepte un dépôt sans téléphone vérifié (exigence supprimée)", async () => {
    const user = await createUser(t);
    const keys = await kycFiles(user.id);
    const record = await submitVerification(
      {
        documentType: "NATIONAL_ID",
        firstName: "P13",
        lastName: "SansTel",
        documentFrontKey: keys.front,
        documentBackKey: keys.back,
        selfieKey: keys.selfie,
      },
      { actorId: user.id, actorRole: "CLIENT", ip: "127.0.0.1" },
    );
    expect(record.status).toBe("PENDING");
  });

  it("exige le verso pour une CNI (contrôle du schéma)", async () => {
    const user = await createUser(t, { phone: true });
    const keys = await kycFiles(user.id);
    await expect(
      submitVerification(
        {
          documentType: "NATIONAL_ID",
          firstName: "P13",
          lastName: "NoVerso",
          documentFrontKey: keys.front,
          selfieKey: keys.selfie,
        },
        { actorId: user.id, actorRole: "CLIENT", ip: "127.0.0.1" },
      ),
    ).rejects.toThrow(/verso/i);
  });

  it("refuse un nouveau dossier après vérification réussie", async () => {
    const user = await createUser(t, { phone: true, kycVerified: true });
    const keys = await kycFiles(user.id);
    const err = await expectApiError(() =>
      submitVerification(
        {
          documentType: "NATIONAL_ID",
          firstName: "P13",
          lastName: "DejaValide",
          documentFrontKey: keys.front,
          documentBackKey: keys.back,
          selfieKey: keys.selfie,
        },
        { actorId: user.id, actorRole: "CLIENT", ip: "127.0.0.1" },
      ),
    );
    expect(err.code).toBe("KYC_ALREADY_VERIFIED");
  });
});

describe("Lecture du dossier et file d'attente", () => {
  it("getMyVerification renvoie NOT_SUBMITTED puis le dossier complet", async () => {
    const user = await createUser(t, { phone: true });
    const before = await getMyVerification(user.id);
    expect(before.status).toBe("NOT_SUBMITTED");
    expect(before.records).toHaveLength(0);

    await submitCni(user.id);

    const after = await getMyVerification(user.id);
    expect(after.status).toBe("PENDING");
    expect(after.records).toHaveLength(1);
    expect(after.records[0]?.status).toBe("PENDING");
    expect(after.records[0]?.history.some((h) => h.reason === "Dossier soumis")).toBe(true);
  });

  it("listPendingVerifications contient nos dossiers en attente", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t, { phone: true });
    const record = await submitCni(user.id);

    const queue = await listPendingVerifications({ actorId: admin.user.id, actorRole: "ADMIN", ip: "127.0.0.1" });
    expect(queue.some((row) => row.id === record.id)).toBe(true);
    expect(queue.find((row) => row.id === record.id)?.user.id).toBe(user.id);

    // Consulter la file n'est plus inscrit au journal (routine, sans intérêt pour l'équipe).
    const audit = await prisma.auditLog.findFirst({
      where: { userId: admin.user.id, action: "KYC_QUEUE_VIEWED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(audit).toBeNull();
  });
});

describe("Revue administrateur", () => {
  it("approuve un dossier : VERIFIED sur le dossier et le compte, historique et notification", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t, { phone: true });
    const record = await submitCni(user.id);

    const result = await reviewVerification(record.id, "VERIFIED", "Documents conformes", {
      actorId: admin.user.id,
      actorRole: "ADMIN",
      ip: "127.0.0.1",
    });
    expect(result).toMatchObject({ id: record.id, status: "VERIFIED" });

    const row = await prisma.identityVerification.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.status).toBe("VERIFIED");
    expect(row.rejectionReason).toBeNull();
    expect(row.reviewedById).toBe(admin.user.id);
    expect(row.reviewedAt).not.toBeNull();

    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(userRow.kycStatus).toBe("VERIFIED");
    expect(userRow.verifiedAt).not.toBeNull();

    const history = await prisma.verificationHistory.findFirst({
      where: { verificationId: record.id, newStatus: "VERIFIED" },
    });
    expect(history?.reason).toBe("Documents conformes");

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, type: "KYC_VERIFIED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { userId: admin.user.id, action: "KYC_VERIFIED", resourceId: record.id },
    });
    expect(audit?.severity).toBe("WARNING");
  });

  it("rejette un dossier : motif conservé et compte passé en REJECTED", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t, { phone: true });
    const record = await submitCni(user.id);

    const result = await reviewVerification(record.id, "REJECTED", "Photo illisible, merci de recommencer", {
      actorId: admin.user.id,
      actorRole: "ADMIN",
      ip: "127.0.0.1",
    });
    expect(result.status).toBe("REJECTED");

    const row = await prisma.identityVerification.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.rejectionReason).toBe("Photo illisible, merci de recommencer");
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(userRow.kycStatus).toBe("REJECTED");
    expect(userRow.verifiedAt).toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, type: "KYC_REJECTED", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.message).toContain("Photo illisible");
  });

  it("impossible de revoir un dossier déjà traité", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t, { phone: true });
    const record = await submitCni(user.id);
    await reviewVerification(record.id, "VERIFIED", "OK", { actorId: admin.user.id, actorRole: "ADMIN" });

    const err = await expectApiError(() =>
      reviewVerification(record.id, "REJECTED", "Trop tard", { actorId: admin.user.id, actorRole: "ADMIN" }),
    );
    expect(err.code).toBe("INVALID_STATE");
  });

  it("rejet d'un dossier introuvable → 404", async () => {
    const admin = await createAdmin(t);
    const err = await expectApiError(() =>
      reviewVerification("00000000-0000-4000-8000-000000000000", "VERIFIED", "OK", {
        actorId: admin.user.id,
        actorRole: "ADMIN",
      }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("getVerificationFile rend le document et journalise l'accès (SENSITIVE_DATA_ACCESS)", async () => {
    const admin = await createAdmin(t);
    const user = await createUser(t, { phone: true });
    const record = await submitCni(user.id);

    const file = await getVerificationFile(record.id, "front", { actorId: admin.user.id, actorRole: "ADMIN" });
    expect(file.mime).toBe("image/png");
    expect(file.buffer.toString("utf8")).toContain("recto-p13");

    const audit = await prisma.auditLog.findFirst({
      where: { userId: admin.user.id, action: "SENSITIVE_DATA_ACCESS", resourceId: record.id },
    });
    expect(audit?.severity).toBe("WARNING");
    expect(audit?.metadata).toMatchObject({ document: "front" });

    await expect(
      getVerificationFile(record.id, "passport", { actorId: admin.user.id, actorRole: "ADMIN" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getVerificationFile("00000000-0000-4000-8000-000000000000", "front", {
        actorId: admin.user.id,
        actorRole: "ADMIN",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validateUploadPurpose n'accepte que les quatre finalités KYC", () => {
    for (const purpose of ["kyc_front", "kyc_back", "kyc_passport", "kyc_selfie"]) {
      expect(validateUploadPurpose(purpose)).toBe(purpose);
    }
    expect(() => validateUploadPurpose("kyc_versement")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});

describe("Routes KYC (inject)", () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("image-de-test")]);
  const opts = { auth: null as null | Awaited<ReturnType<typeof createAdmin>>["session"] };

  async function build(auth: (typeof opts)["auth"]) {
    opts.auth = auth;
    return buildMiniApp(opts, async (app) => {
      await app.register(registerIdentityVerificationRoutes, { prefix: "/api/v1" });
    });
  }

  it("GET /kyc/me → NOT_SUBMITTED pour un compte sans dossier", async () => {
    const user = await createUser(t, { phone: true });
    const session = await authFor(user.id);
    const app = await build(session);
    const res = await app.inject({ method: "GET", url: "/api/v1/kyc/me" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("NOT_SUBMITTED");
    await app.close();
  });

  it("POST /uploads : finalité inconnue, fichier invalide, puis téléversement valide", async () => {
    const user = await createUser(t, { phone: true });
    const session = await authFor(user.id);
    const app = await build(session);

    const badPurpose = multipartBody([
      { name: "purpose", value: "kyc_portefeuille" },
      { name: "file", filename: "c.png", contentType: "image/png", data: png },
    ]);
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: badPurpose.headers,
      payload: badPurpose.payload,
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().error.code).toBe("VALIDATION_ERROR");

    const badFile = multipartBody([
      { name: "purpose", value: "kyc_front" },
      { name: "file", filename: "c.txt", contentType: "text/plain", data: Buffer.from("du texte") },
    ]);
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: badFile.headers,
      payload: badFile.payload,
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error.code).toBe("FILE_TYPE_INVALID");

    const noFile = multipartBody([{ name: "purpose", value: "kyc_front" }]);
    const res3 = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: noFile.headers,
      payload: noFile.payload,
    });
    expect(res3.statusCode).toBe(400);
    expect(res3.json().error.code).toBe("VALIDATION_ERROR");

    const ok = multipartBody([
      { name: "purpose", value: "kyc_front" },
      { name: "file", filename: "c.png", contentType: "image/png", data: png },
    ]);
    const res4 = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: ok.headers,
      payload: ok.payload,
    });
    expect(res4.statusCode).toBe(200);
    const key = res4.json().data.key as string;
    expect(key).toContain(`kyc/${user.id}/kyc_front/`);
    t.fileKeys.push(key);
    await app.close();
  });

  it("POST /uploads accepte un compte sans téléphone vérifié (exigence supprimée)", async () => {
    const user = await createUser(t);
    const session = await authFor(user.id);
    const app = await build(session);
    const body = multipartBody([
      { name: "purpose", value: "kyc_front" },
      { name: "file", filename: "c.png", contentType: "image/png", data: png },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: body.headers,
      payload: body.payload,
    });
    expect(res.statusCode).toBe(200);
    t.fileKeys.push(res.json().data.key as string);
    await app.close();
  });

  it("POST /kyc : corps invalide → 400 ; puis dossier créé et relisible via /kyc/me", async () => {
    const user = await createUser(t, { phone: true });
    const session = await authFor(user.id);
    const app = await build(session);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/kyc",
      payload: { documentType: "PISCINE", firstName: "X", lastName: "Y" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

    const keys = await kycFiles(user.id);
    const valid = await app.inject({
      method: "POST",
      url: "/api/v1/kyc",
      payload: {
        documentType: "NATIONAL_ID",
        firstName: "P13",
        lastName: "Route",
        documentFrontKey: keys.front,
        documentBackKey: keys.back,
        selfieKey: keys.selfie,
      },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().data.status).toBe("PENDING");

    const me = await app.inject({ method: "GET", url: "/api/v1/kyc/me" });
    expect(me.json().data.status).toBe("PENDING");
    await app.close();
  });

  it("routes /admin/kyc : permission exigée, file consultable, décision et documents", async () => {
    const client = await createUser(t, { phone: true });
    const clientSession = await authFor(client.id);
    const app = await build(clientSession);

    const denied = await app.inject({ method: "GET", url: "/api/v1/admin/kyc" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
    await app.close();

    const admin = await createAdmin(t);
    const adminApp = await build(admin.session);
    const record = await submitCni(client.id);

    const queue = await adminApp.inject({ method: "GET", url: "/api/v1/admin/kyc" });
    expect(queue.statusCode).toBe(200);
    expect(Array.isArray(queue.json().data)).toBe(true);

    const badDecision = await adminApp.inject({
      method: "POST",
      url: `/api/v1/admin/kyc/${record.id}/review`,
      payload: { status: "CANCELLED", reason: "trop court" },
    });
    expect(badDecision.statusCode).toBe(400);

    const shortReason = await adminApp.inject({
      method: "POST",
      url: `/api/v1/admin/kyc/${record.id}/review`,
      payload: { status: "REJECTED", reason: "ok" },
    });
    expect(shortReason.statusCode).toBe(400);

    const decision = await adminApp.inject({
      method: "POST",
      url: `/api/v1/admin/kyc/${record.id}/review`,
      payload: { status: "VERIFIED", reason: "Dossier conforme (test)" },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().data.status).toBe("VERIFIED");

    const document = await adminApp.inject({
      method: "GET",
      url: `/api/v1/admin/kyc/${record.id}/files/front`,
    });
    expect(document.statusCode).toBe(200);
    expect(document.headers["content-type"]).toBe("image/png");
    expect(document.headers["cache-control"]).toBe("private, no-store");

    const unknownKind = await adminApp.inject({
      method: "GET",
      url: `/api/v1/admin/kyc/${record.id}/files/brut`,
    });
    expect(unknownKind.statusCode).toBe(404);

    const missingKind = await adminApp.inject({
      method: "GET",
      url: `/api/v1/admin/kyc/${record.id}/files/passport`,
    });
    expect(missingKind.statusCode).toBe(404);

    await adminApp.close();
  });
});
