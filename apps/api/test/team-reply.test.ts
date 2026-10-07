// L'équipe répond au support (message dans la messagerie du membre), écrit la
// première à un membre, et le journal d'activité ne montre que ce qui compte.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import { authFor, buildMiniApp, cleanup, createAdmin, createUser, track, tracker } from "./helpers.js";
import { registerSupportRoutes } from "../src/modules/support/routes.js";
import { registerMessagingRoutes } from "../src/modules/messaging/routes.js";
import { listAuditLogs } from "../src/modules/admin-ops/service.js";
import { logAudit } from "../src/lib/audit.js";

const t = tracker();

afterAll(async () => {
  await cleanup(t);
});

describe("Réponse de l'équipe au support", () => {
  it("la réponse arrive dans les messages du client, qui est prévenu ; la demande passe « En cours »", async () => {
    const admin = await createAdmin(t);
    const client = await createUser(t);
    const ticket = await prisma.supportTicket.create({
      data: { reporterId: client.id, category: "PAYMENT_ISSUE", subject: "i need help", description: "Mon paiement Wave ne passe pas." },
    });
    const app = await buildMiniApp({ auth: admin.session }, async (a) => {
      await a.register(registerSupportRoutes, { prefix: "/api/v1" });
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/support/tickets/${ticket.id}/reply`,
      payload: { message: "Bonjour, renvoyez la capture Wave et nous validons." },
    });
    expect(res.statusCode).toBe(200);
    const { conversationId } = res.json().data as { conversationId: string };
    track(t, "conversationIds", conversationId);

    const messages = await prisma.message.findMany({ where: { conversationId } });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain("renvoyez la capture Wave");
    expect(messages[0]!.content).toContain("MD-");
    expect(await prisma.notification.count({ where: { userId: client.id, title: "Réponse du support" } })).toBe(1);
    expect(await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ status: "IN_PROGRESS", assignedToId: admin.user.id });

    // Seconde réponse : même conversation.
    const again = await app.inject({ method: "POST", url: `/api/v1/admin/support/tickets/${ticket.id}/reply`, payload: { message: "Merci, c'est validé." } });
    expect(again.json().data.conversationId).toBe(conversationId);
    await app.close();
  });

  it("un client ne peut pas utiliser la réponse de l'équipe", async () => {
    const client = await createUser(t);
    const ticket = await prisma.supportTicket.create({
      data: { reporterId: client.id, category: "OTHER", subject: "Question", description: "Une question sur une offre." },
    });
    const app = await buildMiniApp({ auth: await authFor(client.id) }, async (a) => {
      await a.register(registerSupportRoutes, { prefix: "/api/v1" });
    });
    const res = await app.inject({ method: "POST", url: `/api/v1/admin/support/tickets/${ticket.id}/reply`, payload: { message: "x" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("L'équipe écrit la première", () => {
  it("trouve un membre et ouvre une conversation (une seule par membre)", async () => {
    const admin = await createAdmin(t);
    const client = await createUser(t);
    const app = await buildMiniApp({ auth: admin.session }, async (a) => {
      await a.register(registerMessagingRoutes, { prefix: "/api/v1" });
    });

    const found = await app.inject({ method: "GET", url: `/api/v1/admin/conversations/recipients?q=${encodeURIComponent(client.email!)}` });
    expect(found.json().data.map((u: { id: string }) => u.id)).toEqual([client.id]);

    const first = await app.inject({ method: "POST", url: "/api/v1/admin/conversations/start", payload: { userId: client.id } });
    expect(first.statusCode).toBe(200);
    const convo = first.json().data as { id: string; kind: string };
    track(t, "conversationIds", convo.id);
    expect(convo.kind).toBe("CLIENT_TO_ADMIN");

    const second = await app.inject({ method: "POST", url: "/api/v1/admin/conversations/start", payload: { userId: client.id } });
    expect(second.json().data.id).toBe(convo.id);

    // Un membre de l'équipe n'est pas un destinataire.
    const other = await createAdmin(t);
    const refused = await app.inject({ method: "POST", url: "/api/v1/admin/conversations/start", payload: { userId: other.user.id } });
    expect(refused.statusCode).toBe(400);
    await app.close();
  });
});

describe("Journal d'activité", () => {
  it("« Tout » masque les connexions et les consultations ; chaque catégorie filtre ; recherche en français", async () => {
    const admin = await createAdmin(t);
    const actorId = admin.user.id;
    await logAudit({ actorId, action: "OFFER_REMOVED", resourceType: "Product" });
    await logAudit({ actorId, action: "LOGIN" });
    await logAudit({ actorId, action: "ADMIN_ORDERS_LISTED" });

    const all = await listAuditLogs({ page: 1, perPage: 100, q: admin.user.email! });
    const actions = all.items.map((row) => row.action);
    expect(actions).toContain("OFFER_REMOVED");
    expect(actions).not.toContain("LOGIN");
    expect(actions).not.toContain("ADMIN_ORDERS_LISTED");

    const logins = await listAuditLogs({ page: 1, perPage: 100, category: "logins", q: admin.user.email! });
    expect(logins.items.map((row) => row.action)).toEqual(["LOGIN"]);

    const offers = await listAuditLogs({ page: 1, perPage: 100, category: "offers", from: new Date(Date.now() - 60_000) });
    expect(offers.items.some((row) => row.action === "OFFER_REMOVED" && row.user?.id === actorId)).toBe(true);

    const search = await listAuditLogs({ page: 1, perPage: 100, q: "offre supprimée", from: new Date(Date.now() - 60_000) });
    expect(search.items.some((row) => row.action === "OFFER_REMOVED" && row.user?.id === actorId)).toBe(true);
  });
});
