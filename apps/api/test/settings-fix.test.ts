// Correction unique de la commission (10 % → 15 %) : appliquée une fois, puis
// un réglage choisi ensuite dans Paramètres est respecté.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { restoreCommissionOnce } from "../src/modules/settings/service.js";
import { updateSetting } from "../src/modules/admin-ops/service.js";
import { cleanup, createUser, expectApiError, tracker } from "./helpers.js";

const KEY = "sellerCommissionPercent";
const ACTION = "SETTING_COMMISSION_RESTORED_15";

const t = tracker();

afterAll(async () => {
  await prisma.settings.update({ where: { key: KEY }, data: { value: 15 } });
  await cleanup(t);
});

describe("Commission remise à 15 %", () => {
  it("corrige une seule fois, puis respecte un nouveau réglage", async () => {
    // Base de test : on rejoue la situation de production (10 %, correction jamais faite).
    await prisma.auditLog.deleteMany({ where: { action: ACTION } });
    await prisma.settings.update({ where: { key: KEY }, data: { value: 10 } });

    expect(await restoreCommissionOnce()).toBe(true);
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: KEY } })).value).toBe(15);
    const trace = await prisma.auditLog.findFirstOrThrow({ where: { action: ACTION } });
    expect(trace.metadata).toMatchObject({ before: 10, after: 15 });

    // Plus tard, l'administrateur choisit 12 % : le démarrage suivant n'y touche pas.
    await prisma.settings.update({ where: { key: KEY }, data: { value: 12 } });
    expect(await restoreCommissionOnce()).toBe(false);
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: KEY } })).value).toBe(12);
  });
});

describe("Limites des réglages", () => {
  it("refuse une valeur impossible avec un message clair sous le champ", async () => {
    const admin = await createUser(t, { role: "ADMIN" });
    const actor = { actorId: admin.id, actorRole: "ADMIN" as const };
    const fields = (err: { details?: unknown }) => (err.details as { fields: Record<string, string> }).fields;

    const tooHigh = await expectApiError(() => updateSetting(KEY, 150, actor));
    expect(tooHigh.code).toBe("VALIDATION_ERROR");
    expect(fields(tooHigh).value).toBe("Entre 0 et 100 %.");
    expect(fields(await expectApiError(() => updateSetting("minWithdrawalAmount", -500, actor))).value).toBe("0 FCFA au minimum.");
    expect(fields(await expectApiError(() => updateSetting("installmentRounding", "MILIEU", actor))).value).toMatch(/liste/);

    await updateSetting(KEY, 20, actor);
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: KEY } })).value).toBe(20);
  });
});
