// PHASE 13 — Retraits vendeurs (§39 : « retraits »). Approbation, refus
// avec recrédit du solde, double traitement concurrent, journal CRITICAL et
// routes admin protégées par la permission WITHDRAWALS.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  SUITE_STARTED_AT,
  authFor,
  buildMiniApp,
  cleanup,
  createAdmin,
  createSeller,
  createStaff,
  createUser,
  tracker,
  track,
} from "./helpers.js";
import {
  approveWithdrawal,
  listWithdrawals,
  rejectWithdrawal,
} from "../src/modules/admin-ops/service.js";
import { registerAdminOpsRoutes } from "../src/modules/admin-ops/routes.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

async function pendingWithdrawal(amount = 25_000) {
  const owner = await createUser(t, { role: "VENDOR" });
  const seller = await createSeller(t, owner, { balanceAvailable: amount });
  const row = await prisma.withdrawal.create({
    data: { sellerId: seller.id, requestedById: owner.id, amount },
  });
  track(t, "withdrawalIds", row.id);
  return { owner, seller, id: row.id, amount };
}

describe("Approbation d'un retrait", () => {
  it("approuve un retrait en attente sans débiter le solde (journal CRITICAL)", async () => {
    const admin = await createAdmin(t);
    const { owner, seller, id, amount } = await pendingWithdrawal(40_000);
    const actor = { actorId: admin.user.id, actorRole: "ADMIN" as const, ip: "127.0.0.1" };

    const result = await approveWithdrawal(id, "WAVE-REF-7788", actor);
    expect(result).toEqual({ id, status: "APPROVED" });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("APPROVED");
    expect(row.paymentReference).toBe("WAVE-REF-7788");
    expect(row.processedById).toBe(admin.user.id);
    expect(row.processedAt).not.toBeNull();

    // L'approbation ne touche PAS le solde (débit actuel non implémenté).
    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(balance.balanceAvailable).toBe(amount);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "WITHDRAWAL_APPROVED", resourceId: id },
    });
    expect(audit?.severity).toBe("CRITICAL");
    expect(audit?.userId).toBe(admin.user.id);

    const notification = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "SELLER_PAYOUT_AVAILABLE", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.title).toBe("Retrait payé");
    expect(notification?.message).toContain((40_000).toLocaleString("fr-FR"));
  });

  it("refuse un identifiant inconnu ou un retrait déjà traité", async () => {
    const admin = await createAdmin(t);
    const actor = { actorId: admin.user.id, actorRole: "ADMIN" as const };

    await expect(
      approveWithdrawal("00000000-0000-4000-8000-000000000000", "REF-1", actor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { id } = await pendingWithdrawal(10_000);
    await approveWithdrawal(id, "REF-FIRST", actor);
    await expect(approveWithdrawal(id, "REF-SECOND", actor)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("ne traite qu'UNE des deux demandes concurrentes (garde idempotente)", async () => {
    const admin = await createAdmin(t);
    const { id } = await pendingWithdrawal(15_000);
    const actor = { actorId: admin.user.id, actorRole: "ADMIN" as const };

    const results = await Promise.allSettled([
      approveWithdrawal(id, "REF-A", actor),
      approveWithdrawal(id, "REF-B", actor),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INVALID_STATE" });

    const audits = await prisma.auditLog.count({ where: { action: "WITHDRAWAL_APPROVED", resourceId: id } });
    expect(audits).toBe(1);
  });
});

describe("Refus d'un retrait", () => {
  it("refuse, recrédite le solde et journalise en CRITICAL", async () => {
    const admin = await createAdmin(t);
    const { owner, seller, id, amount } = await pendingWithdrawal(30_000);

    const result = await rejectWithdrawal(id, "Coordonnées bancaires invalides.", {
      actorId: admin.user.id,
      actorRole: "ADMIN",
      ip: "127.0.0.1",
    });
    expect(result).toEqual({ id, status: "REJECTED" });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(row.rejectionReason).toBe("Coordonnées bancaires invalides.");
    expect(row.processedById).toBe(admin.user.id);

    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(balance.balanceAvailable).toBe(amount * 2);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "WITHDRAWAL_REJECTED", resourceId: id },
    });
    expect(audit?.severity).toBe("CRITICAL");
    expect(audit?.metadata).toMatchObject({ amount, reason: "Coordonnées bancaires invalides." });

    const notification = await prisma.notification.findFirst({
      where: { userId: owner.id, title: "Retrait refusé", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notification?.message).toBe("Coordonnées bancaires invalides.");
    expect(notification?.priority).toBe("CRITICAL");

    // Le refus après refus ou après approbation est bloqué.
    await expect(rejectWithdrawal(id, "Encore un refus.", { actorId: admin.user.id })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const second = await pendingWithdrawal(12_000);
    await approveWithdrawal(second.id, "REF-OK", { actorId: admin.user.id });
    await expect(rejectWithdrawal(second.id, "Trop tard.", { actorId: admin.user.id })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("refuse un identifiant inconnu", async () => {
    const admin = await createAdmin(t);
    await expect(
      rejectWithdrawal("00000000-0000-4000-8000-000000000000", "Motif.", { actorId: admin.user.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recrédite un vendeur qui n'a aucune ligne de solde (création à la volée)", async () => {
    const admin = await createAdmin(t);
    const owner = await createUser(t, { role: "VENDOR" });
    const seller = await createSeller(t, owner, { balanceAvailable: 5_000 });
    const row = await prisma.withdrawal.create({
      data: { sellerId: seller.id, requestedById: owner.id, amount: 7_500 },
    });
    track(t, "withdrawalIds", row.id);
    await prisma.sellerBalance.delete({ where: { sellerId: seller.id } });

    await rejectWithdrawal(row.id, "Refus test solde absent.", { actorId: admin.user.id });

    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    expect(balance.balanceAvailable).toBe(7_500);
  });

  it("refuse un refus concurrent avec une approbation simultanée (une seule gagne)", async () => {
    const admin = await createAdmin(t);
    const { seller, id, amount } = await pendingWithdrawal(9_000);
    const actor = { actorId: admin.user.id, actorRole: "ADMIN" as const };

    const results = await Promise.allSettled([
      approveWithdrawal(id, "REF-RACE", actor),
      rejectWithdrawal(id, "Refus en course.", actor),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    const balance = await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } });
    if (row.status === "REJECTED") {
      expect(balance.balanceAvailable).toBe(amount * 2);
    } else {
      expect(balance.balanceAvailable).toBe(amount);
    }
  });
});

describe("Liste des retraits", () => {
  it("pagine, filtre par statut et par e-mail vendeur", async () => {
    const admin = await createAdmin(t);
    const { owner, id } = await pendingWithdrawal(11_000);
    await approveWithdrawal(id, "REF-LIST", { actorId: admin.user.id });

    const pending = await listWithdrawals({ page: 1, perPage: 10, status: "PENDING" });
    expect(pending.items.every((row) => row.status === "PENDING")).toBe(true);

    const approved = await listWithdrawals({ page: 1, perPage: 100, status: "APPROVED" });
    const found = approved.items.find((row) => row.id === id);
    expect(found).toBeDefined();
    expect(found?.paymentReference).toBe("REF-LIST");
    expect(found?.requestedBy?.id).toBe(owner.id);
    expect(found?.seller.user.id).toBeDefined();

    const filtered = await listWithdrawals({ page: 1, perPage: 100, q: owner.email });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.id).toBe(id);

    const page1 = await listWithdrawals({ page: 1, perPage: 1 });
    const page2 = await listWithdrawals({ page: 2, perPage: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(page1.total).toBe(page2.total);
    expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
  });
});

describe("Routes retraits (inject)", () => {
  it("exige la permission puis approuve et refuse", async () => {
    const client = await createUser(t);
    const clientApp = await buildMiniApp({ auth: await authFor(client.id) }, async (app) => {
      await app.register(registerAdminOpsRoutes, { prefix: "/api/v1" });
    });
    expect((await clientApp.inject({ method: "GET", url: "/api/v1/admin/withdrawals" })).statusCode).toBe(403);
    await clientApp.close();

    const wrongStaff = await createStaff(t, ["PRODUCTS"]);
    const wrongApp = await buildMiniApp({ auth: wrongStaff.session }, async (app) => {
      await app.register(registerAdminOpsRoutes, { prefix: "/api/v1" });
    });
    expect((await wrongApp.inject({ method: "GET", url: "/api/v1/admin/withdrawals" })).statusCode).toBe(403);
    await wrongApp.close();

    const staff = await createStaff(t, ["WITHDRAWALS"]);
    const app = await buildMiniApp({ auth: staff.session }, async (instance) => {
      await instance.register(registerAdminOpsRoutes, { prefix: "/api/v1" });
    });

    const { id, owner } = await pendingWithdrawal(20_000);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/withdrawals?status=PENDING" });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((row: { id: string }) => row.id === id)).toBe(true);

    const badStatus = await app.inject({ method: "GET", url: "/api/v1/admin/withdrawals?status=WHATEVER" });
    expect(badStatus.statusCode).toBe(400);

    const badBody = await app.inject({ method: "POST", url: `/api/v1/admin/withdrawals/${id}/approve`, payload: {} });
    expect(badBody.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/withdrawals/00000000-0000-4000-8000-000000000000/approve",
      payload: { paymentReference: "REF-X" },
    });
    expect(missing.statusCode).toBe(404);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/admin/withdrawals/${id}/approve`,
      payload: { paymentReference: "WAVE-123456" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toEqual({ id, status: "APPROVED" });

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/admin/withdrawals/${id}/approve`,
      payload: { paymentReference: "WAVE-123456" },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("INVALID_STATE");

    const second = await pendingWithdrawal(8_000);
    const shortReason = await app.inject({
      method: "POST",
      url: `/api/v1/admin/withdrawals/${second.id}/reject`,
      payload: { reason: "ok" },
    });
    expect(shortReason.statusCode).toBe(400);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/admin/withdrawals/${second.id}/reject`,
      payload: { reason: "RIB du vendeur illisible." },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data).toEqual({ id: second.id, status: "REJECTED" });

    const notified = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "SELLER_PAYOUT_AVAILABLE", createdAt: { gte: SUITE_STARTED_AT } },
    });
    expect(notified).not.toBeNull();
    await app.close();
  });
});
