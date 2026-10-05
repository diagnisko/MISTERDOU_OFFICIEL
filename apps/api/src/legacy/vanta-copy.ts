import { randomUUID } from "node:crypto";
import { prisma } from "@misterdou/db";
import { isBcryptHash } from "../lib/password.js";
import { encryptString, putFile } from "../lib/storage.js";
import { MEDIA_TYPES, putPublicMedia } from "../lib/media.js";
import { findRef } from "./refs.js";
import { setFollowOldSite } from "./follow.js";
import { importLegacyUsers, type LegacyUser, type UserImportLine } from "./users.js";
import { movToMp4, type LegacyFiles } from "./files.js";
import type { VantaData, VantaPlan, VantaProduct, VantaUser } from "./vanta-read.js";
import {
  chooseKycDocs,
  mimeFromKey,
  normalizeCountry,
  normalizePhone,
  orderNumberFor,
  parseCredentials,
  parseFeatures,
  splitAmounts,
} from "./vanta-map.js";

// ---------------------------------------------------------------------------
// Copie de l'ancien site « Vanta » dans le nouveau site. L'ancien site n'est
// jamais modifié. Relançable : chaque ligne copiée est notée dans LegacyRef,
// un nouveau passage ne crée aucun doublon et rattrape ce qui a changé.
//   - clients (pas l'équipe), mots de passe repris ;
//   - clients vérifiés : leur dossier d'identité (pièces chiffrées) ;
//   - offres : vendues en mensualités → « vendue », en vente → masquée
//     (DRAFT) jusqu'à la bascule, pour ne jamais vendre deux fois un compte ;
//   - mensualités dont l'apport est payé : dates et montants d'origine.
// ---------------------------------------------------------------------------

export const VANTA_SOURCE = "vanta";
const TEAM_ROLES = new Set(["MANAGER", "SUPER_ADMIN"]);
/** Échéanciers repris : en cours (ou en retard) et soldés ; jamais les annulés. */
const COPIED_PLAN_STATUSES = new Set(["ACTIVE", "DEFAULTED", "COMPLETED"]);

export type CopyStep = "identité" | "photo de profil" | "offre" | "média" | "mensualités";

export interface CopyLine {
  step: CopyStep;
  /** Identifiant d'origine (ancien site). */
  ref: string;
  outcome: "créé" | "copié" | "mis à jour" | "inchangé" | "publié" | "ignoré" | "à refaire" | "à vérifier";
  reason?: string;
  detail?: string;
  newId?: string;
}

export interface CopyReport {
  users: UserImportLine[];
  lines: CopyLine[];
}

interface Ctx {
  apply: boolean;
  files: LegacyFiles | null;
  bascule: boolean;
  now: Date;
  /** Étiquette des repères LegacyRef (« vanta » ; autre valeur pour les essais). */
  source: string;
  /** Conversion .mov → .mp4 (ffmpeg par défaut ; remplaçable dans les essais). */
  convertMov?: (input: Buffer) => Promise<Buffer | null>;
  lines: CopyLine[];
}

export function toLegacyUser(u: VantaUser): LegacyUser {
  let skip: string | null = null;
  if (TEAM_ROLES.has(u.role)) skip = "compte de l'équipe de l'ancien site";
  else if (u.accountStatus === "CANCELLED") skip = "compte clôturé sur l'ancien site";
  const phone = normalizePhone(u.phone);
  return {
    legacyId: u.id,
    email: u.email?.trim().toLowerCase() || null,
    passwordHash: isBcryptHash(u.passwordHash) ? u.passwordHash : null,
    emailVerifiedAt: null,
    firstName: u.firstName?.trim().slice(0, 80) || null,
    lastName: u.lastName?.trim().slice(0, 80) || null,
    createdAt: u.createdAt,
    lastLoginAt: null,
    googleSub: u.authProvider === "GOOGLE" && u.providerAccountId ? u.providerAccountId : null,
    suspended: u.accountStatus === "SUSPENDED",
    phoneNumber: phone?.phoneNumber ?? null,
    countryCode: phone?.countryCode ?? null,
    country: normalizeCountry(u.country),
    address: u.address?.trim() || null,
    skip,
  };
}

const fmtDate = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
/** 13 571 (espaces simples : lisibles dans le terminal et le rapport). */
const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ");

function mediaMime(fileMime: string | null, key: string): string | null {
  const mime = fileMime && MEDIA_TYPES[fileMime] ? fileMime : mimeFromKey(key);
  return mime && MEDIA_TYPES[mime] ? mime : null;
}

export async function copyVanta(
  data: VantaData,
  opts: {
    apply: boolean;
    files: LegacyFiles | null;
    bascule?: boolean;
    now?: Date;
    source?: string;
    convertMov?: (input: Buffer) => Promise<Buffer | null>;
  },
): Promise<CopyReport> {
  const ctx: Ctx = {
    apply: opts.apply,
    files: opts.files,
    bascule: opts.bascule ?? false,
    now: opts.now ?? new Date(),
    source: opts.source ?? VANTA_SOURCE,
    convertMov: opts.convertMov,
    lines: [],
  };
  const legacyUsers = data.users.map(toLegacyUser);

  // 1. Clients.
  const users = await importLegacyUsers(legacyUsers, { apply: ctx.apply, source: ctx.source });
  const userIds = new Map(users.filter((l) => l.newId).map((l) => [l.legacyId, l.newId!]));
  const copiedUser = (id: string) => users.some((l) => l.legacyId === id && l.outcome !== "ignoré");

  // 2. Photos de profil et 3. dossiers d'identité des clients vérifiés.
  for (const u of data.users) {
    if (!copiedUser(u.id)) continue;
    const newId = userIds.get(u.id);
    if (u.avatarUrl) await copyAvatar(u, newId, ctx);
    if (u.verificationStatus === "VERIFIED") await copyKyc(u, newId, data, ctx);
  }

  // 4. Offres (+ médias, + identifiants des comptes vendus).
  const plans = data.plans.filter((p) => COPIED_PLAN_STATUSES.has(p.status) && p.purchaseStatus !== "CANCELLED" && copiedUser(p.userId));
  const planByProduct = new Map(plans.map((p) => [p.productId, p]));
  const productIds = new Map<string, string>();
  for (const p of data.products) {
    const id = await copyProduct(p, planByProduct.get(p.id) ?? null, ctx);
    if (id) productIds.set(p.id, id);
  }

  // 5. Mensualités.
  let copiedPlans = 0;
  for (const plan of data.plans) {
    const done = await copyPlan(plan, plans.includes(plan), userIds.get(plan.userId), productIds.get(plan.productId), ctx);
    if (done) copiedPlans += 1;
  }

  // Tant que l'ancien site encaisse, le nouveau ne relance pas ces échéanciers ;
  // la bascule du nom de domaine lui rend la main.
  if (ctx.apply) {
    if (ctx.bascule) await setFollowOldSite(false);
    else if (copiedPlans > 0) await setFollowOldSite(true);
  }
  return { users, lines: ctx.lines };
}

async function copyAvatar(u: VantaUser, newId: string | undefined, ctx: Ctx) {
  const line = { step: "photo de profil" as const, ref: u.id };
  if (!ctx.apply || !newId) return void ctx.lines.push({ ...line, outcome: "copié", detail: "simulation" });
  if (await findRef(ctx.source, "avatar", u.id)) return void ctx.lines.push({ ...line, outcome: "inchangé" });
  const target = await prisma.user.findUniqueOrThrow({ where: { id: newId }, select: { avatarKey: true } });
  if (target.avatarKey || !ctx.files) return void ctx.lines.push({ ...line, outcome: "inchangé", reason: target.avatarKey ? "déjà une photo" : "fichiers non lus" });
  try {
    const file = await ctx.files.readPublic(u.avatarUrl!);
    const mime = mediaMime(file.mime, u.avatarUrl!);
    if (!mime || MEDIA_TYPES[mime]!.kind !== "image") return void ctx.lines.push({ ...line, outcome: "ignoré", reason: "format d'image non pris en charge" });
    const key = `avatars/${newId}/${randomUUID()}.${MEDIA_TYPES[mime]!.ext}`;
    await putPublicMedia(key, file.buffer, mime);
    await prisma.$transaction([
      prisma.user.update({ where: { id: newId }, data: { avatarKey: key } }),
      prisma.legacyRef.create({ data: { source: ctx.source, entity: "avatar", legacyId: u.id, newId: key } }),
    ]);
    ctx.lines.push({ ...line, outcome: "copié", newId: key });
  } catch (err) {
    ctx.lines.push({ ...line, outcome: "à vérifier", reason: `photo illisible (${err instanceof Error ? err.message : "erreur"})` });
  }
}

async function copyKyc(u: VantaUser, newId: string | undefined, data: VantaData, ctx: Ctx) {
  const line = { step: "identité" as const, ref: u.id };
  const choice = chooseKycDocs(data.documents.get(u.id) ?? []);
  if (!choice.ok) return void ctx.lines.push({ ...line, outcome: "à refaire", reason: choice.reason });
  if (!ctx.apply || !newId) return void ctx.lines.push({ ...line, outcome: "copié", detail: `${choice.type === "PASSPORT" ? "passeport" : "carte d'identité"} + photo (simulation)` });
  if (await findRef(ctx.source, "kyc", u.id)) return void ctx.lines.push({ ...line, outcome: "inchangé" });
  const already = await prisma.identityVerification.findFirst({ where: { userId: newId, status: "VERIFIED" }, select: { id: true } });
  if (already) {
    await prisma.legacyRef.create({ data: { source: ctx.source, entity: "kyc", legacyId: u.id, newId: already.id } });
    return void ctx.lines.push({ ...line, outcome: "inchangé", reason: "déjà vérifié sur le nouveau site" });
  }
  if (!ctx.files) return void ctx.lines.push({ ...line, outcome: "à vérifier", reason: "fichiers non lus" });

  // Pièces relues sur l'ancien site, puis rangées chiffrées (comme une vérification faite ici).
  const store = async (doc: { fileUrl: string }, purpose: string) => {
    const file = await ctx.files!.readPrivate(doc.fileUrl);
    const mime = file.mime && file.mime !== "application/octet-stream" ? file.mime : (mimeFromKey(doc.fileUrl) ?? "image/jpeg");
    return (await putFile(`kyc/${newId}/${purpose}/${randomUUID()}`, file.buffer, mime)).key;
  };
  try {
    const frontKey = await store(choice.front, choice.type === "PASSPORT" ? "kyc_passport" : "kyc_front");
    const backKey = choice.back ? await store(choice.back, "kyc_back") : null;
    const selfieKey = await store(choice.selfie, "kyc_selfie");
    const dates = data.verifiedAt.get(u.id);
    const reviewedAt = dates?.reviewedAt ?? dates?.submittedAt ?? u.createdAt;
    const verification = await prisma.$transaction(async (tx) => {
      const created = await tx.identityVerification.create({
        data: {
          userId: newId,
          status: "VERIFIED",
          documentType: choice.type,
          documentFrontKey: frontKey,
          documentBackKey: choice.type === "NATIONAL_ID" ? backKey : null,
          passportKey: choice.type === "PASSPORT" ? frontKey : null,
          selfieKey,
          firstName: u.firstName?.trim() || "—",
          lastName: u.lastName?.trim() || "—",
          country: normalizeCountry(u.country),
          address: u.address?.trim() || null,
          submittedAt: dates?.submittedAt ?? reviewedAt,
          reviewedAt,
          reviewerNote: "Vérification reprise de l'ancien site.",
        },
        select: { id: true },
      });
      await tx.user.update({ where: { id: newId }, data: { kycStatus: "VERIFIED", verifiedAt: reviewedAt } });
      await tx.legacyRef.create({ data: { source: ctx.source, entity: "kyc", legacyId: u.id, newId: created.id } });
      return created;
    });
    ctx.lines.push({ ...line, outcome: "copié", newId: verification.id });
  } catch (err) {
    const denied = err instanceof Error && (err.name === "AccessDenied" || /not authorized/i.test(err.message));
    ctx.lines.push({
      ...line,
      outcome: "à vérifier",
      reason: denied ? "Amazon refuse la lecture du dossier privé : il faut une clé autorisée à lire" : `pièces illisibles (${err instanceof Error ? err.message : "erreur"})`,
    });
  }
}

async function copyProduct(p: VantaProduct, plan: VantaPlan | null, ctx: Ctx): Promise<string | null> {
  const line = { step: "offre" as const, ref: p.id };
  // Vendue en mensualités → vendue ; en vente → masquée jusqu'à la bascule.
  const target = plan ? "SOLD" : p.status === "AVAILABLE" ? "DRAFT" : null;
  const knownId = await findRef(ctx.source, "product", p.id);

  if (knownId) {
    const current = await prisma.product.findUnique({ where: { id: knownId }, select: { id: true, status: true } });
    if (!current) {
      ctx.lines.push({ ...line, outcome: "ignoré", reason: "offre reprise puis supprimée sur le nouveau site" });
      return null;
    }
    if (target === "SOLD" && current.status !== "SOLD") {
      if (ctx.apply) await prisma.product.update({ where: { id: current.id }, data: { status: "SOLD" } });
      ctx.lines.push({ ...line, outcome: "mis à jour", detail: "vendue en mensualités", newId: current.id });
    } else if (ctx.bascule && target === "DRAFT" && current.status === "DRAFT") {
      if (ctx.apply) await prisma.product.update({ where: { id: current.id }, data: { status: "ACTIVE", publishedAt: ctx.now } });
      ctx.lines.push({ ...line, outcome: "publié", detail: "toujours en vente sur l'ancien site", newId: current.id });
    } else {
      ctx.lines.push({ ...line, outcome: "inchangé", newId: current.id });
    }
    if (ctx.apply) {
      // Médias manqués au passage précédent (fichier illisible, format converti depuis).
      await copyMedia(p, current.id, ctx);
      if (plan) await saveCredential(current.id, plan, ctx);
    }
    return current.id;
  }

  if (!target) {
    ctx.lines.push({ ...line, outcome: "ignoré", reason: "masquée sur l'ancien site et non vendue en mensualités" });
    return null;
  }
  const features = parseFeatures(p.features);
  const detail = `${p.title} · ${target === "SOLD" ? "vendue" : "masquée jusqu'à la bascule"} · ${p.media.length} média(s)`;
  if (!ctx.apply) {
    ctx.lines.push({ ...line, outcome: "créé", detail });
    return null;
  }

  const slugTaken = await prisma.product.findUnique({ where: { slug: p.slug }, select: { id: true } });
  const extraInfo = [p.importantInfo?.trim(), features.platform ? `Plateforme : ${features.platform}` : null].filter(Boolean).join("\n") || null;
  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        ownerType: "ADMIN",
        title: p.title.trim(),
        slug: slugTaken ? `${p.slug}-${p.id.slice(0, 6)}` : p.slug,
        description: p.description?.trim() || p.title.trim(),
        division: features.division,
        teamPower: features.teamPower,
        coins: features.coins,
        extraInfo,
        basePrice: Math.round(p.priceTotal),
        paymentMode: "INSTALLMENTS",
        installmentDownPayment: Math.round(p.initialDepositAmount),
        installmentMonths: p.installmentsCount,
        status: target,
        publishedAt: target === "SOLD" ? p.createdAt : null,
        createdAt: p.createdAt,
      },
      select: { id: true },
    });
    await tx.legacyRef.create({ data: { source: ctx.source, entity: "product", legacyId: p.id, newId: product.id } });
    return product;
  });
  ctx.lines.push({ ...line, outcome: "créé", detail, newId: created.id });
  await copyMedia(p, created.id, ctx);
  if (plan) await saveCredential(created.id, plan, ctx);
  return created.id;
}

/** Identifiants remis au client sur l'ancien site, rangés chiffrés sur l'offre. */
async function saveCredential(productId: string, plan: VantaPlan, ctx: Ctx) {
  if (await prisma.productCredential.findUnique({ where: { productId }, select: { id: true } })) return;
  const creds = parseCredentials(plan.access);
  if (!creds) {
    ctx.lines.push({ step: "offre", ref: plan.productId, outcome: "à vérifier", reason: "identifiants introuvables ou illisibles : à saisir dans la console" });
    return;
  }
  await prisma.productCredential.create({
    data: { productId, encryptedEmail: encryptString(creds.email), encryptedPassword: encryptString(creds.password) },
  });
}

async function copyMedia(p: VantaProduct, productId: string, ctx: Ctx) {
  const files = ctx.files;
  if (!files) return;
  // Couverture : l'image marquée principale, sinon la première image.
  const images = p.media.filter((m) => m.mediaType === "IMAGE");
  const cover = images.find((m) => m.isMain) ?? images[0] ?? null;
  // Nouveau passage : les médias déjà là gardent leur place et leur couverture.
  const present = await prisma.productImage.findMany({ where: { productId }, select: { isPrimary: true } });
  const hasCover = present.some((i) => i.isPrimary);
  let position = present.length;
  for (const m of p.media) {
    const line = { step: "média" as const, ref: m.id };
    if (await findRef(ctx.source, "media", m.id)) {
      ctx.lines.push({ ...line, outcome: "inchangé" });
      continue;
    }
    try {
      const file = await files.readPublic(m.url);
      // Vidéo d'iPhone (.mov) : convertie en .mp4, le format lu partout.
      if ((file.mime ?? mimeFromKey(m.url)) === "video/quicktime") {
        const mp4 = await (ctx.convertMov ?? movToMp4)(file.buffer);
        if (mp4) Object.assign(file, { buffer: mp4, mime: "video/mp4" });
      }
      const mime = mediaMime(file.mime, m.url);
      if (!mime) {
        ctx.lines.push({ ...line, outcome: "ignoré", reason: `format non pris en charge (${file.mime ?? m.url.split(".").pop()})` });
        continue;
      }
      const key = `products/${productId}/${randomUUID()}.${MEDIA_TYPES[mime]!.ext}`;
      await putPublicMedia(key, file.buffer, mime);
      await prisma.$transaction([
        prisma.productImage.create({
          data: { productId, objectKey: key, mimeType: mime, sizeBytes: file.buffer.length, isPrimary: !hasCover && m === cover, position: position++ },
        }),
        prisma.legacyRef.create({ data: { source: ctx.source, entity: "media", legacyId: m.id, newId: key } }),
      ]);
      ctx.lines.push({ ...line, outcome: "copié", newId: key });
    } catch (err) {
      ctx.lines.push({ ...line, outcome: "à vérifier", reason: `média illisible (${err instanceof Error ? err.message : "erreur"})` });
    }
  }
}

async function copyPlan(
  plan: VantaPlan,
  eligible: boolean,
  buyerId: string | undefined,
  productId: string | undefined,
  ctx: Ctx,
): Promise<boolean> {
  const line = { step: "mensualités" as const, ref: plan.id };
  const knownPlanId = await findRef(ctx.source, "plan", plan.id);

  if (knownPlanId) {
    if (plan.status === "CANCELLED" || plan.purchaseStatus === "CANCELLED") {
      ctx.lines.push({ ...line, outcome: "à vérifier", reason: "annulé sur l'ancien site depuis la copie", newId: knownPlanId });
      return false;
    }
    return syncPlan(plan, knownPlanId, ctx);
  }
  if (!eligible) return false;
  const deposit = Math.round(plan.initialDepositAmount);
  const remaining = Math.round(plan.remainingAmount);
  const total = deposit + remaining;
  const schedules = plan.schedules;
  const amounts = splitAmounts(schedules.map((s) => s.amount), remaining);
  const firstDue = schedules[0]?.dueDate;
  const detail =
    `${fmt(total)} FCFA · apport ${fmt(deposit)} payé · ` +
    `${schedules.length} × ${amounts[0] !== undefined ? fmt(amounts[0]) : "—"} · 1re échéance ${firstDue ? fmtDate(firstDue) : "—"}`;
  if (!ctx.apply) {
    ctx.lines.push({ ...line, outcome: "créé", detail });
    return false;
  }
  if (!buyerId || !productId || schedules.length === 0) {
    ctx.lines.push({ ...line, outcome: "ignoré", reason: !buyerId ? "client non copié" : !productId ? "offre non copiée" : "aucune échéance" });
    return false;
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { title: true, division: true, teamPower: true, coins: true },
  });
  let orderNumber = orderNumberFor(plan.purchaseId, plan.purchaseCreatedAt);
  if (await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } })) orderNumber = `${orderNumber}-${plan.id.slice(0, 4)}`;
  const paidLines = schedules.map((s, i) => ({ s, amount: amounts[i]! })).filter(({ s }) => s.status === "PAID");
  const totalPaid = deposit + paidLines.reduce((sum, l) => sum + l.amount, 0);
  const completed = plan.status === "COMPLETED" || totalPaid >= total;
  const depositAt = plan.depositPaidAt ?? plan.startDate ?? plan.purchaseCreatedAt;

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        buyerId,
        status: completed ? "DELIVERED" : "PARTIALLY_PAID",
        paymentMode: "INSTALLMENTS",
        totalAmount: total,
        createdAt: plan.purchaseCreatedAt,
        deliveredAt: completed ? ctx.now : null,
        items: { create: { productId, ...product, unitPrice: total, quantity: 1, sellerId: null } },
      },
      select: { id: true },
    });
    const newPlan = await tx.installmentPlan.create({
      data: {
        orderId: order.id,
        totalAmount: total,
        downPaymentAmount: deposit,
        remainingAmount: remaining,
        monthCount: schedules.length,
        monthlyAmount: amounts[0]!,
        lastMonthAmount: amounts[amounts.length - 1]!,
        totalPaid,
        paidCount: paidLines.length,
        status: completed ? "COMPLETED" : "ACTIVE",
        dueDay: firstDue ? firstDue.getUTCDate() : null,
        installments: {
          create: schedules.map((s, i) => ({
            index: s.installmentNumber,
            amountDue: amounts[i]!,
            amountPaid: s.status === "PAID" ? amounts[i]! : 0,
            dueDate: s.dueDate,
            paidAt: s.status === "PAID" ? (s.paidAt ?? s.dueDate) : null,
            status: s.status === "PAID" ? ("PAID" as const) : ("PENDING" as const),
          })),
        },
      },
      select: { id: true },
    });
    // L'apport, encaissé sur l'ancien site (tracé, sans prestataire de paiement ici).
    await tx.payment.create({
      data: {
        paymentNumber: `PAY-${orderNumber}`,
        userId: buyerId,
        orderId: order.id,
        type: "INITIAL_INSTALLMENT",
        amount: deposit,
        provider: "SYSTEM",
        providerReference: `vanta:${plan.id}:apport`,
        status: "SUCCESS",
        paidAt: depositAt,
        verifiedAt: depositAt,
        installmentPlanId: newPlan.id,
      },
    });
    await tx.product.update({ where: { id: productId }, data: { status: "SOLD" } });
    await tx.legacyRef.createMany({
      data: [
        { source: ctx.source, entity: "order", legacyId: plan.purchaseId, newId: order.id },
        { source: ctx.source, entity: "plan", legacyId: plan.id, newId: newPlan.id },
      ],
    });
    return newPlan;
  });
  ctx.lines.push({ ...line, outcome: "créé", detail, newId: created.id });
  return true;
}

/** Nouveau passage : reporte les mensualités payées sur l'ancien site depuis la copie. */
async function syncPlan(plan: VantaPlan, planId: string, ctx: Ctx): Promise<boolean> {
  const line = { step: "mensualités" as const, ref: plan.id, newId: planId };
  const current = await prisma.installmentPlan.findUnique({
    where: { id: planId },
    include: { installments: true, order: { select: { id: true, status: true } } },
  });
  if (!current) {
    ctx.lines.push({ ...line, outcome: "ignoré", reason: "échéancier repris puis supprimé sur le nouveau site" });
    return false;
  }
  const newlyPaid = plan.schedules.filter((s) => {
    const mine = current.installments.find((i) => i.index === s.installmentNumber);
    return s.status === "PAID" && mine && mine.status !== "PAID";
  });
  if (newlyPaid.length === 0) {
    ctx.lines.push({ ...line, outcome: "inchangé" });
    return true;
  }
  const added = newlyPaid.reduce((sum, s) => sum + current.installments.find((i) => i.index === s.installmentNumber)!.amountDue, 0);
  const totalPaid = current.totalPaid + added;
  const completed = totalPaid >= current.totalAmount;
  if (ctx.apply) {
    await prisma.$transaction(async (tx) => {
      for (const s of newlyPaid) {
        const mine = current.installments.find((i) => i.index === s.installmentNumber)!;
        await tx.installment.update({
          where: { id: mine.id },
          data: { status: "PAID", amountPaid: mine.amountDue, paidAt: s.paidAt ?? ctx.now },
        });
      }
      await tx.installmentPlan.update({
        where: { id: planId },
        data: { totalPaid, paidCount: { increment: newlyPaid.length }, status: completed ? "COMPLETED" : "ACTIVE" },
      });
      // Soldé sur l'ancien site : le client y a déjà ses identifiants.
      if (completed && current.order.status === "PARTIALLY_PAID") {
        await tx.order.update({ where: { id: current.order.id }, data: { status: "DELIVERED", deliveredAt: ctx.now } });
      }
    });
  }
  ctx.lines.push({
    ...line,
    outcome: "mis à jour",
    detail: `${newlyPaid.length} mensualité(s) payée(s) sur l'ancien site${completed ? " · échéancier soldé" : ""}`,
  });
  return true;
}
