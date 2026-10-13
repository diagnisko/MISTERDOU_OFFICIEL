// Échange de comptes : demande (ID + vidéo + code), réponse du vendeur,
// accord du client (identifiants confiés à l'équipe), vérification par
// l'équipe, commande du complément, remise croisée ; refus, expirations,
// annulations et droits de chacun.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@misterdou/db";
import {
  authFor,
  cleanup,
  createAdmin,
  createProduct,
  createSeller,
  createStaff,
  createUser,
  expectApiError,
  track,
  tracker,
  type TestUser,
} from "./helpers.js";
import {
  acceptExchange,
  cancelExchange,
  createExchange,
  decideCustody,
  declineExchange,
  getExchange,
  listSellerExchanges,
  listTeamExchanges,
  prepareExchange,
  provideCustodyCode,
  replyToExchange,
  reportExchange,
  requestCustodyCode,
  revealClientAccount,
  runExchangeJobs,
  exchangeVideoUploadUrl,
} from "../src/modules/exchanges/service.js";
import { notHeldByExchange } from "../src/modules/exchanges/hold.js";
import { createOrder, createOrderSchema } from "../src/modules/orders/service.js";
import { expireUnpaidOrders } from "../src/modules/orders/fulfillment.js";
import { settlePayment } from "../src/modules/payments/service.js";
import { setOfferExchange, updateOffer } from "../src/modules/offers/service.js";
import { deletePrivate, writeLocalPrivate } from "../src/lib/private-media.js";
import { readLocalPrivate } from "../src/lib/private-media.js";
import type { AuthContext } from "../src/lib/auth-context.js";

const t = tracker();
const videoKeys: string[] = [];

afterAll(async () => {
  for (const key of videoKeys) await deletePrivate(key).catch(() => undefined);
  await cleanup(t);
});

const gameId = () => `X${randomUUID().replaceAll("-", "").slice(0, 10)}`.toUpperCase();
// Début d'un MP4 valide (boîte « ftyp ») + contenu unique.
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from(randomUUID())]);

async function setup(opts: { price?: number; installments?: boolean; acceptsExchange?: boolean } = {}) {
  const sellerUser = await createUser(t, { role: "VENDOR", kycVerified: true });
  const seller = await createSeller(t, sellerUser);
  const product = await createProduct(t, {
    sellerId: seller.id,
    basePrice: opts.price ?? 50_000,
    withCredential: true,
    gameAccountId: gameId(),
    acceptsExchange: opts.acceptsExchange ?? true,
    ...(opts.installments ? { paymentMode: "INSTALLMENTS" as const, installmentMonths: 4, installmentDownPayment: 10_000 } : {}),
  });
  const client = await createUser(t, { kycVerified: true });
  return { sellerUser, seller, product, client, sellerAuth: (await authFor(sellerUser.id)) as AuthContext, clientAuth: (await authFor(client.id)) as AuthContext };
}

async function uploadVideo(auth: AuthContext) {
  const upload = await exchangeVideoUploadUrl(auth, "video/mp4", 100);
  await writeLocalPrivate(upload.key, mp4());
  videoKeys.push(upload.key);
  return upload.key;
}

async function request(productId: string, clientAuth: AuthContext, id = gameId()) {
  const prep = await prepareExchange(productId, clientAuth);
  const videoKey = await uploadVideo(clientAuth);
  const created = await createExchange(
    { productId, gameAccountId: id, videoKey, videoMime: "video/mp4", message: "Mon compte : 3 200 OVR.", proofToken: prep.proof.token },
    clientAuth,
  );
  return { ...created, proofCode: prep.proof.code, videoKey, gameAccountId: id };
}

async function team() {
  const staff = await createStaff(t, ["EXCHANGES"]);
  return staff.session as AuthContext;
}

async function payOrder(orderId: string) {
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId, status: "PENDING" } });
  track(t, "paymentIds", payment.id);
  await settlePayment({ id: payment.id }, "SUCCESS", { source: "MANUAL" });
}

const titles = async (user: TestUser | { id: string }) =>
  (await prisma.notification.findMany({ where: { userId: user.id }, select: { title: true } })).map((n) => n.title);

describe("Demande d'échange", () => {
  it("refusée sans identité vérifiée, sur une offre sans échange, sur sa propre offre, avec un compte déjà en vente", async () => {
    const { product, sellerAuth, seller } = await setup();
    const noKyc = await createUser(t);
    expect((await expectApiError(async () => prepareExchange(product.id, (await authFor(noKyc.id)) as AuthContext))).code).toBe("KYC_REQUIRED");

    const closed = await createProduct(t, { sellerId: seller.id, gameAccountId: gameId(), acceptsExchange: false });
    const client = (await authFor((await createUser(t, { kycVerified: true })).id)) as AuthContext;
    expect((await expectApiError(() => prepareExchange(closed.id, client))).code).toBe("EXCHANGE_UNAVAILABLE");
    expect((await expectApiError(() => prepareExchange(product.id, sellerAuth))).code).toBe("OWN_OFFER");

    // Compte proposé déjà en vente sur le site : refusé, l'équipe est prévenue.
    const admin = await createAdmin(t);
    const listed = await createProduct(t, { gameAccountId: gameId() });
    const listedId = (await prisma.product.findUniqueOrThrow({ where: { id: listed.id } })).gameAccountId!;
    expect((await expectApiError(() => request(product.id, client, listedId))).code).toBe("GAME_ID_IN_USE");
    expect(await titles(admin.user)).toContain("Échange refusé : compte déjà en ligne");
  });

  it("le code de la vidéo et la vidéo appartiennent au client", async () => {
    const { product, clientAuth } = await setup();
    const prep = await prepareExchange(product.id, clientAuth);
    expect(prep.proof.code).toMatch(/^MD-[A-Z2-9]{4}$/);
    const videoKey = await uploadVideo(clientAuth);
    const base = { productId: product.id, gameAccountId: gameId(), videoKey, videoMime: "video/mp4" as const };
    // Code falsifié.
    expect((await expectApiError(() => createExchange({ ...base, proofToken: prep.proof.token.replace(/.$/, "x") }, clientAuth))).code).toBe("VALIDATION_ERROR");
    // Vidéo envoyée par quelqu'un d'autre.
    const other = (await authFor((await createUser(t, { kycVerified: true })).id)) as AuthContext;
    const otherPrep = await prepareExchange(product.id, other);
    expect((await expectApiError(() => createExchange({ ...base, proofToken: otherPrep.proof.token }, other))).code).toBe("VALIDATION_ERROR");
    // Fichier qui n'est pas une vidéo : refusé et effacé.
    const fake = await exchangeVideoUploadUrl(clientAuth, "video/mp4", 100);
    await writeLocalPrivate(fake.key, Buffer.from("pas une video du tout"));
    const err = await expectApiError(() => createExchange({ ...base, videoKey: fake.key, proofToken: prep.proof.token }, clientAuth));
    expect(err.code).toBe("FILE_TYPE_INVALID");
    await expect(readLocalPrivate(fake.key)).rejects.toBeTruthy();
    // Une seule demande en cours par client et par offre.
    await createExchange({ ...base, proofToken: prep.proof.token }, clientAuth);
    expect((await expectApiError(() => request(product.id, clientAuth))).code).toBe("INVALID_STATE");
  });
});

describe("Parcours complet", () => {
  it("complément de 20 000 F : réponse, accord, vérification par l'équipe, paiement, remise croisée", async () => {
    const { product, client, clientAuth, sellerUser, sellerAuth, seller } = await setup();
    const exchanges = await team();
    const ex = await request(product.id, clientAuth);
    expect(await titles(sellerUser)).toContain("Nouvelle demande d’échange 🔁");

    // Le vendeur voit la vidéo et le code ; un inconnu ne voit rien ; seul le vendeur répond.
    const sellerView = await getExchange(ex.id, sellerAuth);
    expect(sellerView).toMatchObject({ side: "seller", status: "PENDING", proofCode: ex.proofCode, gameAccountId: ex.gameAccountId });
    expect(sellerView.video?.url).toContain("/api/v1/private-media/file/");
    expect(sellerView.actions.reply).toBe(true);
    const stranger = (await authFor((await createUser(t)).id)) as AuthContext;
    expect((await expectApiError(() => getExchange(ex.id, stranger))).code).toBe("NOT_FOUND");
    expect((await expectApiError(() => replyToExchange(ex.id, { decision: "quote", topUpAmount: 1 }, clientAuth))).code).toBe("FORBIDDEN");
    expect((await expectApiError(() => replyToExchange(ex.id, { decision: "quote", topUpAmount: 1 }, exchanges))).code).toBe("FORBIDDEN");
    expect((await listSellerExchanges(sellerAuth)).map((e) => e.id)).toContain(ex.id);

    await replyToExchange(ex.id, { decision: "quote", topUpAmount: 20_000, message: "Ton compte est un peu plus faible." }, sellerAuth);
    expect(await titles(client)).toContain("Échange possible : réponse reçue");

    // Le client accepte et confie son compte : l'offre est tenue.
    const accepted = await acceptExchange(ex.id, { paymentMode: "ONE_TIME", login: "client@jeu.com", password: "mdp-client" }, clientAuth);
    expect(accepted.status).toBe("ACCEPTED");
    expect(await prisma.product.count({ where: { id: product.id, ...notHeldByExchange() } })).toBe(0);
    const buyer = await createUser(t, { kycVerified: true });
    expect((await expectApiError(() => createOrder(createOrderSchema.parse({ productId: product.id }), { actorId: buyer.id }))).code).toBe("PRODUCT_RESERVED");
    const err = await expectApiError(() =>
      updateOffer(
        product.id,
        { title: "x".repeat(5), description: "y".repeat(12), division: "D", teamPower: 1, coins: 1, basePrice: 9000, paymentMode: "ONE_TIME", gameAccountId: gameId(), acceptsExchange: true },
        { kind: "seller", sellerId: seller.id },
        { actorId: sellerUser.id },
      ),
    );
    expect(err.code).toBe("PRODUCT_RESERVED");
    // Le vendeur ne lit pas encore le compte du client ; l'équipe, oui.
    expect((await expectApiError(() => revealClientAccount(ex.id, sellerAuth))).code).toBe("FORBIDDEN");
    expect((await listTeamExchanges("todo")).items.map((e) => e.id)).toContain(ex.id);

    // L'équipe demande un code, le client le donne, l'équipe lit tout.
    await requestCustodyCode(ex.id, exchanges);
    expect(await titles(client)).toContain("Code de connexion demandé");
    expect((await getExchange(ex.id, exchanges)).custody).toMatchObject({ codeRequested: true, codeProvided: false, code: null });
    await provideCustodyCode(ex.id, "482913", clientAuth);
    // Le code apparaît directement chez l'équipe, jamais chez le vendeur ni dans la vue du client.
    expect((await getExchange(ex.id, exchanges)).custody).toMatchObject({ codeProvided: true, code: "482913" });
    expect((await getExchange(ex.id, sellerAuth)).custody.code).toBeNull();
    expect((await getExchange(ex.id, clientAuth)).custody.code).toBeNull();
    expect(await revealClientAccount(ex.id, exchanges)).toMatchObject({ login: "client@jeu.com", password: "mdp-client", code: "482913" });
    expect(await prisma.auditLog.count({ where: { action: "EXCHANGE_CLIENT_ACCOUNT_REVEALED", resourceId: ex.id } })).toBe(1);

    // Compte validé : commande du complément.
    const confirmed = await decideCustody(ex.id, { decision: "confirm", note: "Conforme à la vidéo." }, exchanges);
    expect(confirmed.status).toBe("AWAITING_PAYMENT");
    const row = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: ex.id }, include: { order: { include: { items: true } } } });
    expect(row.order).toMatchObject({ totalAmount: 20_000, status: "PENDING_PAYMENT", buyerId: client.id });
    expect(row.order!.items[0]).toMatchObject({ productId: product.id, unitPrice: 20_000 });
    expect((await getExchange(ex.id, clientAuth)).order?.checkoutUrl).toMatch(/^\/checkout\/mdpay_/);

    // Paiement validé : livraison, échange conclu, commission sur le complément seulement.
    await payOrder(row.orderId!);
    const done = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: ex.id } });
    expect(done.status).toBe("COMPLETED");
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: "SOLD" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: row.orderId! } })).toMatchObject({ status: "DELIVERED" });
    const commission = await prisma.commission.findFirstOrThrow({ where: { orderItem: { orderId: row.orderId! } } });
    expect(commission).toMatchObject({ orderAmount: 20_000, commissionRate: 15, commissionAmount: 3_000, netToSeller: 17_000 });
    expect((await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).balancePending).toBe(17_000);
    expect(await titles(sellerUser)).toContain("🔁 Échange conclu");

    // Le vendeur lit maintenant le compte reçu, et peut le signaler.
    expect(await revealClientAccount(ex.id, sellerAuth)).toMatchObject({ login: "client@jeu.com", code: null });
    const report = await reportExchange(ex.id, "Le client a repris son compte par l’e-mail de récupération.", sellerAuth);
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: report.ticketId } });
    expect(ticket).toMatchObject({ orderId: row.orderId, reporterId: sellerUser.id });
  });

  it("échange direct (0 F) : livré dès la validation du compte, sans commission", async () => {
    const { product, clientAuth, sellerAuth, seller } = await setup();
    const exchanges = await team();
    const ex = await request(product.id, clientAuth);
    await replyToExchange(ex.id, { decision: "quote", topUpAmount: 0 }, sellerAuth);
    // Rien à payer : pas de mensualités possibles.
    expect((await expectApiError(() => acceptExchange(ex.id, { paymentMode: "INSTALLMENTS", login: "a@b.c", password: "x" }, clientAuth))).code).toBe("INSTALLMENTS_UNAVAILABLE");
    await acceptExchange(ex.id, { paymentMode: "ONE_TIME", login: "a@b.c", password: "x" }, clientAuth);
    const done = await decideCustody(ex.id, { decision: "confirm" }, exchanges);
    expect(done.status).toBe("COMPLETED");
    const row = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: ex.id }, include: { order: true } });
    expect(row.order).toMatchObject({ status: "DELIVERED", totalAmount: 0 });
    expect(await prisma.payment.count({ where: { orderId: row.orderId! } })).toBe(0);
    expect(await prisma.commission.count({ where: { orderItem: { orderId: row.orderId! } } })).toBe(0);
    expect(await prisma.pendingCredit.count({ where: { orderId: row.orderId! } })).toBe(0);
    expect((await prisma.sellerBalance.findUniqueOrThrow({ where: { sellerId: seller.id } })).balancePending).toBe(0);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: "SOLD" });
  });

  it("complément en mensualités : apport au prorata, l'apport validé conclut l'échange", async () => {
    const { product, clientAuth, sellerAuth } = await setup({ installments: true });
    const exchanges = await team();
    const ex = await request(product.id, clientAuth);
    await replyToExchange(ex.id, { decision: "quote", topUpAmount: 20_000 }, sellerAuth);
    expect((await getExchange(ex.id, clientAuth)).product.canSplit).toBe(true);
    await acceptExchange(ex.id, { paymentMode: "INSTALLMENTS", login: "a@b.c", password: "x" }, clientAuth);
    await decideCustody(ex.id, { decision: "confirm" }, exchanges);
    const row = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: ex.id } });
    const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { orderId: row.orderId! } });
    // Offre : 10 000 d'apport sur 50 000 → 20 % du complément de 20 000.
    expect(plan).toMatchObject({ totalAmount: 20_000, downPaymentAmount: 4_000, monthCount: 4 });
    await payOrder(row.orderId!);
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe("COMPLETED");
    expect(await prisma.order.findUniqueOrThrow({ where: { id: row.orderId! } })).toMatchObject({ status: "PARTIALLY_PAID" });
  });
});

describe("Refus, expirations, annulations", () => {
  it("compte refusé par l'équipe : identifiants effacés, offre de nouveau disponible", async () => {
    const { product, client, clientAuth, sellerAuth } = await setup();
    const exchanges = await team();
    const ex = await request(product.id, clientAuth);
    await replyToExchange(ex.id, { decision: "quote", topUpAmount: 5_000 }, sellerAuth);
    await acceptExchange(ex.id, { paymentMode: "ONE_TIME", login: "a@b.c", password: "x" }, clientAuth);
    const refused = await decideCustody(ex.id, { decision: "refuse", reason: "Le compte ne correspond pas à la vidéo." }, exchanges);
    expect(refused.status).toBe("CUSTODY_REFUSED");
    expect(await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: ex.id } })).toMatchObject({ encryptedLogin: null, encryptedPassword: null });
    expect(await prisma.product.count({ where: { id: product.id, ...notHeldByExchange() } })).toBe(1);
    expect(await titles(client)).toContain(`Échange ${ex.number} : compte refusé`);
    expect((await expectApiError(() => revealClientAccount(ex.id, exchanges))).code).toBe("FORBIDDEN");
  });

  it("le vendeur refuse ; le client décline ; sans réponse, tout expire ; vidéo effacée après conservation", async () => {
    const { product, clientAuth, sellerAuth } = await setup();
    const rejected = await request(product.id, clientAuth);
    await replyToExchange(rejected.id, { decision: "reject", message: "Je garde ce compte." }, sellerAuth);
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe("REJECTED");

    const declined = await request(product.id, clientAuth);
    await replyToExchange(declined.id, { decision: "quote", topUpAmount: 3_000 }, sellerAuth);
    await declineExchange(declined.id, clientAuth);
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: declined.id } })).status).toBe("DECLINED");

    const silent = await request(product.id, clientAuth);
    await prisma.exchangeRequest.update({ where: { id: silent.id }, data: { replyDeadline: new Date(Date.now() - 1000) } });
    expect((await expectApiError(() => replyToExchange(silent.id, { decision: "quote", topUpAmount: 0 }, sellerAuth))).code).toBe("EXCHANGE_EXPIRED");
    await runExchangeJobs();
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: silent.id } })).status).toBe("EXPIRED");

    const late = await request(product.id, clientAuth);
    await replyToExchange(late.id, { decision: "quote", topUpAmount: 1_000 }, sellerAuth);
    await prisma.exchangeRequest.update({ where: { id: late.id }, data: { quoteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await expectApiError(() => acceptExchange(late.id, { paymentMode: "ONE_TIME", login: "a@b.c", password: "x" }, clientAuth))).code).toBe("EXCHANGE_EXPIRED");
    await runExchangeJobs();
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("EXPIRED");

    // Fin + 31 jours : la vidéo est effacée.
    await prisma.exchangeRequest.update({ where: { id: rejected.id }, data: { closedAt: new Date(Date.now() - 31 * 86_400_000) } });
    await runExchangeJobs();
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: rejected.id } })).videoPurgedAt).not.toBeNull();
    await expect(readLocalPrivate(rejected.videoKey)).rejects.toBeTruthy();
    expect((await getExchange(rejected.id, clientAuth)).video).toBeNull();
  });

  it("complément non réglé : le client annule, ou la commande expire ; l'offre revient", async () => {
    const { product, clientAuth, sellerAuth } = await setup();
    const exchanges = await team();
    const first = await request(product.id, clientAuth);
    await replyToExchange(first.id, { decision: "quote", topUpAmount: 7_000 }, sellerAuth);
    await acceptExchange(first.id, { paymentMode: "ONE_TIME", login: "a@b.c", password: "x" }, clientAuth);
    await decideCustody(first.id, { decision: "confirm" }, exchanges);
    const cancelled = await cancelExchange(first.id, clientAuth);
    expect(cancelled.status).toBe("CANCELLED");
    const firstRow = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: first.id }, include: { order: true } });
    expect(firstRow.order?.status).toBe("CANCELLED");
    expect(firstRow.encryptedLogin).toBeNull();

    const second = await request(product.id, clientAuth);
    await replyToExchange(second.id, { decision: "quote", topUpAmount: 7_000 }, sellerAuth);
    await acceptExchange(second.id, { paymentMode: "ONE_TIME", login: "a@b.c", password: "x" }, clientAuth);
    await decideCustody(second.id, { decision: "confirm" }, exchanges);
    const orderId = (await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: second.id } })).orderId!;
    await prisma.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - 48 * 3_600_000) } });
    await expireUnpaidOrders();
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("CANCELLED");
    expect(await prisma.product.count({ where: { id: product.id, status: "ACTIVE", ...notHeldByExchange() } })).toBe(1);
  });

  it("vente classique ou échange coupé par le vendeur : les demandes en attente sont closes", async () => {
    const { product, clientAuth, sellerAuth, seller, sellerUser } = await setup();
    const pending = await request(product.id, clientAuth);
    await setOfferExchange(product.id, false, { kind: "seller", sellerId: seller.id }, { actorId: sellerUser.id });
    expect((await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("CANCELLED");

    await setOfferExchange(product.id, true, { kind: "seller", sellerId: seller.id }, { actorId: sellerUser.id });
    const quoted = await request(product.id, clientAuth);
    await replyToExchange(quoted.id, { decision: "quote", topUpAmount: 2_000 }, sellerAuth);
    const buyer = await createUser(t, { kycVerified: true });
    const order = await createOrder(createOrderSchema.parse({ productId: product.id }), { actorId: buyer.id });
    track(t, "orderIds", order.orderId);
    await payOrder(order.orderId);
    expect(await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: quoted.id } })).toMatchObject({
      status: "CANCELLED",
      closeReason: "Ce compte vient d’être vendu.",
    });
  });

  it("un manager sans la permission « Échanges » ne voit ni ne valide rien", async () => {
    const { product, clientAuth, sellerAuth } = await setup();
    const ex = await request(product.id, clientAuth);
    await replyToExchange(ex.id, { decision: "quote", topUpAmount: 0 }, sellerAuth);
    await acceptExchange(ex.id, { paymentMode: "ONE_TIME", login: "a@b.c", password: "x" }, clientAuth);
    const support = (await createStaff(t, ["SUPPORT", "PRODUCTS"])).session as AuthContext;
    expect((await expectApiError(() => getExchange(ex.id, support))).code).toBe("NOT_FOUND");
    expect((await expectApiError(() => decideCustody(ex.id, { decision: "confirm" }, support))).code).toBe("NOT_FOUND");
    expect((await expectApiError(() => revealClientAccount(ex.id, support))).code).toBe("NOT_FOUND");
  });
});
