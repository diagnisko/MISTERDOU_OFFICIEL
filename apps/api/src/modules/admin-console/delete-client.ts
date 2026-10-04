import { prisma } from "@misterdou/db";
import type { RoleName } from "@misterdou/db";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { logAudit } from "../../lib/audit.js";
import { deleteMedia } from "../../lib/media.js";

// ---------------------------------------------------------------------------
// Suppression d'un compte client (administrateur, mot de passe confirmé).
//
// Les commandes et paiements restent (comptabilité, litiges) : le compte est
// anonymisé — nom, e-mail, téléphone, photo et accès effacés, sessions coupées,
// offres d'un vendeur retirées. Refusé tant qu'une opération est en cours,
// pour ne jamais perdre l'argent d'un client ou d'un vendeur.
// ---------------------------------------------------------------------------

type Actor = { actorId: string; actorRole?: RoleName; ip?: string };

export async function deleteClientAccount(userId: string, actor: Actor) {
  if (userId === actor.actorId) throw conflict("SELF_ACTION", "Vous ne pouvez pas supprimer votre propre compte.");
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      avatarKey: true,
      role: { select: { name: true } },
      seller: { select: { id: true, sellerBalance: { select: { balancePending: true, balanceAvailable: true } } } },
    },
  });
  if (!user) throw notFound("Client introuvable.");
  if (user.role.name === "ADMIN" || user.role.name === "STAFF") {
    throw forbidden("Un membre de l’équipe se retire depuis la page Équipe.");
  }

  // Rien en cours : commande non terminée, échéancier actif, preuve à vérifier.
  const [openOrders, openPayments, pendingWithdrawals] = await Promise.all([
    prisma.order.count({ where: { buyerId: userId, status: { in: ["PARTIALLY_PAID", "PAID", "DELIVERED"] } } }),
    prisma.payment.count({ where: { userId, status: "PROCESSING" } }),
    user.seller ? prisma.withdrawal.count({ where: { sellerId: user.seller.id, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } } }) : 0,
  ]);
  if (openOrders > 0) throw conflict("ACCOUNT_BUSY", "Ce client a une commande en cours (paiement partiel, livraison ou réception à confirmer). Terminez-la avant de supprimer le compte.");
  if (openPayments > 0) throw conflict("ACCOUNT_BUSY", "Une preuve de paiement de ce client attend votre vérification. Traitez-la avant de supprimer le compte.");
  if (pendingWithdrawals > 0) throw conflict("ACCOUNT_BUSY", "Ce vendeur a un retrait en cours. Terminez-le avant de supprimer le compte.");
  const balance = user.seller?.sellerBalance;
  if (balance && balance.balancePending + balance.balanceAvailable > 0) {
    throw conflict("ACCOUNT_BUSY", "Ce vendeur a encore de l’argent sur son solde. Versez-le avant de supprimer le compte.");
  }

  const now = new Date();
  const short = userId.slice(0, 8);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `supprime-${short}@misterdou.invalid`,
        emailVerifiedAt: null,
        phoneNumber: null,
        passwordHash: null,
        googleSub: null,
        googleEmail: null,
        firstName: "Compte",
        lastName: "supprimé",
        birthDate: null,
        address: null,
        city: null,
        avatarKey: null,
        lastLoginIp: null,
        status: "SUSPENDED",
        deletedAt: now,
      },
    });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    // Commandes jamais payées : libérées (le compte remis en vente).
    await tx.order.updateMany({ where: { buyerId: userId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } });
    await tx.payment.updateMany({ where: { userId, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (user.seller) {
      await tx.seller.update({ where: { id: user.seller.id }, data: { status: "REVOKED" } });
      await tx.product.updateMany({
        where: { sellerId: user.seller.id, deletedAt: null, status: { not: "SOLD" } },
        data: { status: "ARCHIVED", deletedAt: now, featuredUntil: null },
      });
    }
  });
  if (user.avatarKey) await deleteMedia(user.avatarKey).catch(() => undefined);

  await logAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    ip: actor.ip,
    action: "ADMIN_CLIENT_DELETED",
    resourceType: "User",
    resourceId: userId,
    metadata: { formerEmail: user.email, seller: Boolean(user.seller) },
    severity: "CRITICAL",
  });
  return { id: userId, deleted: true };
}
