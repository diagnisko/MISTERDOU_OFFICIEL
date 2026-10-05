import { prisma } from "@misterdou/db";
import { isBcryptHash } from "../lib/password.js";
import { findRef, longTransaction } from "./refs.js";

// ---------------------------------------------------------------------------
// Comptes clients de l'ancien site → nouveau site, quelle que soit la source.
// Les mots de passe restent ceux des clients : l'empreinte bcrypt est reprise
// telle quelle et convertie en scrypt à la première connexion.
// ---------------------------------------------------------------------------

export interface LegacyUser {
  legacyId: string;
  email: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date | null;
  lastLoginAt: Date | null;
  googleSub: string | null;
  suspended: boolean;
  phoneNumber?: string | null;
  countryCode?: string | null;
  country?: string | null;
  address?: string | null;
  /** Ligne à ne pas reprendre, avec la raison (rapport). */
  skip: string | null;
}

export type UserOutcome = "créé" | "fusionné" | "mis à jour" | "inchangé" | "ignoré";

export interface UserImportLine {
  legacyId: string;
  email: string | null;
  outcome: UserOutcome;
  reason?: string;
  newId?: string;
}

/** Un numéro déjà porté par un autre compte n'est pas repris (il est unique). */
async function freePhone(u: LegacyUser, ownerId?: string): Promise<{ phoneNumber?: string; countryCode?: string }> {
  if (!u.phoneNumber) return {};
  const taken = await prisma.user.findUnique({ where: { phoneNumber: u.phoneNumber }, select: { id: true } });
  if (taken && taken.id !== ownerId) return {};
  return { phoneNumber: u.phoneNumber, ...(u.countryCode ? { countryCode: u.countryCode } : {}) };
}

/**
 * Verse les comptes dans la base visée. `apply: false` = simulation : rien
 * n'est écrit, le rapport dit ce qui serait fait.
 */
export async function importLegacyUsers(legacy: LegacyUser[], opts: { apply: boolean; source: string }): Promise<UserImportLine[]> {
  const clientRole = await prisma.role.findUniqueOrThrow({ where: { name: "CLIENT" }, select: { id: true } });
  const lines: UserImportLine[] = [];
  const phonesInRun = new Set<string>();

  for (const u of legacy) {
    const base = { legacyId: u.legacyId, email: u.email };
    if (u.skip || !u.email) {
      lines.push({ ...base, outcome: "ignoré", reason: u.skip ?? "aucune adresse e-mail" });
      continue;
    }
    // Deux comptes de l'ancien site avec le même numéro : seul le premier le garde.
    if (u.phoneNumber && phonesInRun.has(u.phoneNumber)) u.phoneNumber = null;
    if (u.phoneNumber) phonesInRun.add(u.phoneNumber);

    // 1. Déjà repris lors d'un passage précédent : mise à jour prudente.
    const knownId = await findRef(opts.source, "user", u.legacyId);
    if (knownId) {
      const current = await prisma.user.findUnique({
        where: { id: knownId },
        select: { id: true, passwordHash: true, emailVerifiedAt: true, status: true, phoneNumber: true, country: true, address: true },
      });
      if (!current) {
        lines.push({ ...base, outcome: "ignoré", reason: "compte repris puis supprimé sur le nouveau site" });
        continue;
      }
      const data: Record<string, unknown> = {};
      // Le client n'a pas encore changé de mot de passe chez nous : on suit l'ancien site.
      const stillLegacy = current.passwordHash === null || isBcryptHash(current.passwordHash);
      if (stillLegacy && u.passwordHash && u.passwordHash !== current.passwordHash) data.passwordHash = u.passwordHash;
      if (!current.emailVerifiedAt && u.emailVerifiedAt) data.emailVerifiedAt = u.emailVerifiedAt;
      if (u.suspended && current.status === "ACTIVE") data.status = "SUSPENDED";
      if (!current.phoneNumber) Object.assign(data, await freePhone(u, current.id));
      if (!current.country && u.country) data.country = u.country;
      if (!current.address && u.address) data.address = u.address;
      if (Object.keys(data).length === 0) {
        lines.push({ ...base, outcome: "inchangé", newId: current.id });
        continue;
      }
      if (opts.apply) await prisma.user.update({ where: { id: current.id }, data });
      lines.push({ ...base, outcome: "mis à jour", newId: current.id, reason: Object.keys(data).join(", ") });
      continue;
    }

    // 2. Même adresse déjà inscrite sur le nouveau site : un seul compte.
    const existing = await prisma.user.findUnique({
      where: { email: u.email },
      select: { id: true, passwordHash: true, emailVerifiedAt: true, phoneNumber: true, country: true, address: true, role: { select: { name: true } } },
    });
    if (existing) {
      if (existing.role.name === "ADMIN" || existing.role.name === "STAFF") {
        lines.push({ ...base, outcome: "ignoré", reason: "adresse utilisée par un compte de l'équipe" });
        continue;
      }
      if (opts.apply) {
        const phone = existing.phoneNumber ? {} : await freePhone(u, existing.id);
        await longTransaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              // Son mot de passe du nouveau site est gardé ; l'ancien sert s'il n'en a pas.
              ...(existing.passwordHash ? {} : u.passwordHash ? { passwordHash: u.passwordHash } : {}),
              ...(existing.emailVerifiedAt || !u.emailVerifiedAt ? {} : { emailVerifiedAt: u.emailVerifiedAt }),
              ...phone,
              ...(existing.country || !u.country ? {} : { country: u.country }),
              ...(existing.address || !u.address ? {} : { address: u.address }),
            },
          });
          await tx.legacyRef.create({ data: { source: opts.source, entity: "user", legacyId: u.legacyId, newId: existing.id } });
        });
      }
      lines.push({ ...base, outcome: "fusionné", newId: existing.id });
      continue;
    }

    // 3. Nouveau compte client.
    if (!opts.apply) {
      lines.push({ ...base, outcome: "créé" });
      continue;
    }
    const googleTaken = u.googleSub ? await prisma.user.findUnique({ where: { googleSub: u.googleSub }, select: { id: true } }) : null;
    const phone = await freePhone(u);
    const created = await longTransaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          roleId: clientRole.id,
          email: u.email!,
          passwordHash: u.passwordHash,
          emailVerifiedAt: u.emailVerifiedAt,
          firstName: u.firstName,
          lastName: u.lastName,
          googleSub: googleTaken ? null : u.googleSub,
          googleEmail: u.googleSub && !googleTaken ? u.email : null,
          status: u.suspended ? "SUSPENDED" : "ACTIVE",
          lastLoginAt: u.lastLoginAt,
          ...phone,
          country: u.country ?? null,
          address: u.address ?? null,
          ...(u.createdAt ? { createdAt: u.createdAt } : {}),
          notificationPreference: { create: {} },
        },
        select: { id: true },
      });
      await tx.legacyRef.create({ data: { source: opts.source, entity: "user", legacyId: u.legacyId, newId: user.id } });
      return user;
    });
    lines.push({ ...base, outcome: "créé", newId: created.id });
  }
  return lines;
}
