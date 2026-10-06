// Correction unique de la commission (10 % → 15 %) : appliquée une fois, puis
// un réglage choisi ensuite dans Paramètres est respecté.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { restoreCommissionOnce } from "../src/modules/settings/service.js";

const KEY = "sellerCommissionPercent";
const ACTION = "SETTING_COMMISSION_RESTORED_15";

afterAll(async () => {
  await prisma.settings.update({ where: { key: KEY }, data: { value: 15 } });
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
