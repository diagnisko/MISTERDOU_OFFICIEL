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

// Administrateur déterministe : le plus ancien compte ADMIN actif.
export async function pickDefaultAdminId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}
