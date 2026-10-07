import { prisma } from "@misterdou/db";
import type { ConversationKind, RoleName } from "@misterdou/db";
import { badRequest, conflict, forbidden } from "../../lib/errors.js";
import { publicUrl } from "../../lib/media.js";

// ---------------------------------------------------------------------------
// Règles de séparation des conversations (§43) — un client ne discute JAMAIS
// directement avec un vendeur : toute paire passe par un administrateur.
// ---------------------------------------------------------------------------

export type ParticipantSide = "CLIENT" | "VENDOR" | "ADMIN";

export interface ParticipantInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: RoleName;
  hasSeller: boolean;
  status: string;
}

export const USER_NAME_SELECT = { id: true, firstName: true, lastName: true, avatarKey: true, role: { select: { name: true } } } as const;

export type NamedUser = { id: string; firstName: string | null; lastName: string | null; avatarKey: string | null; role: { name: RoleName } };

/** Participant affiché : nom, rôle et photo de profil du compte (null : initiales). */
export function toUserDto(user: NamedUser) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.name,
    avatarUrl: user.avatarKey ? publicUrl(user.avatarKey) : null,
  };
}

export function displayName(user: { firstName: string | null; lastName: string | null }): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}

export async function loadParticipant(id: string): Promise<ParticipantInfo | null> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      role: { select: { name: true } },
      seller: { select: { id: true } },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.name,
    hasSeller: user.seller !== null,
    status: user.status,
  };
}

// Un vendeur = détenteur d'une ligne Seller (son rôle peut rester CLIENT).
export function sideOf(participant: ParticipantInfo): ParticipantSide {
  if (participant.role === "ADMIN" || participant.role === "STAFF") return "ADMIN";
  if (participant.hasSeller || participant.role === "VENDOR") return "VENDOR";
  return "CLIENT";
}

// Garde-fou serveur : les deux participants doivent correspondre au kind.
// Paire client ↔ vendeur sans administrateur → interdite (acceptation P10).
export function assertKindParticipants(
  kind: ConversationKind,
  a: ParticipantInfo,
  b: ParticipantInfo,
): void {
  const sides: ParticipantSide[] = [sideOf(a), sideOf(b)];
  if (a.id === b.id) throw conflict("SELF_ACTION", "Vous ne pouvez pas vous écrire à vous-même.");
  if (sides.includes("CLIENT") && sides.includes("VENDOR") && !sides.includes("ADMIN")) {
    throw forbidden("Conversation client↔vendeur interdite.");
  }
  const required = kind === "CLIENT_TO_ADMIN" ? "CLIENT" : "VENDOR";
  if (!sides.includes(required) || !sides.includes("ADMIN")) {
    throw badRequest("VALIDATION_ERROR", "Type de conversation incompatible avec les participants.");
  }
}

/**
 * L'équipe écrit la première à un membre : conversation existante réutilisée
 * (une seule par paire), sinon créée — « client » ou « vendeur » selon le membre.
 */
export async function openStaffConversation(staffId: string, memberId: string): Promise<{ id: string; created: boolean }> {
  const [staff, member] = await Promise.all([loadParticipant(staffId), loadParticipant(memberId)]);
  if (!staff || sideOf(staff) !== "ADMIN") throw forbidden("Réservé à l'équipe.");
  if (!member) throw badRequest("VALIDATION_ERROR", "Membre introuvable.");
  if (sideOf(member) === "ADMIN") throw badRequest("VALIDATION_ERROR", "Ce compte fait partie de l'équipe.");
  const kind: ConversationKind = sideOf(member) === "VENDOR" ? "VENDOR_TO_ADMIN" : "CLIENT_TO_ADMIN";
  assertKindParticipants(kind, staff, member);
  const [first, second] = [staff.id, member.id].sort() as [string, string];
  const existing = await prisma.conversation.findFirst({
    where: {
      kind,
      OR: [
        { participantAUserId: first, participantBUserId: second },
        { participantAUserId: second, participantBUserId: first },
      ],
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  const created = await prisma.conversation.create({
    data: { kind, participantAUserId: first, participantBUserId: second },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/** Message de l'équipe dans une conversation (la conversation remonte en tête). */
export async function postStaffMessage(conversationId: string, staffId: string, content: string) {
  const message = await prisma.message.create({
    data: { conversationId, senderId: staffId, content },
    select: { id: true, createdAt: true },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  return message;
}

// Administrateur déterministe : le plus ancien compte ADMIN actif.
export async function pickDefaultAdminId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}
