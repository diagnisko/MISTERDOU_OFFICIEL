import type pg from "pg";
import { prisma } from "@misterdou/db";
import { isBcryptHash } from "../lib/password.js";
import { findRef } from "./refs.js";

// ---------------------------------------------------------------------------
// Comptes de l'ancien site (Supabase Auth : auth.users + auth.identities).
// Lecture : to_jsonb(ligne) → aucune dépendance aux colonnes d'une version
// précise de Supabase. Les mots de passe restent ceux des clients : l'empreinte
// bcrypt est reprise telle quelle et convertie en scrypt à la première
// connexion (lib/password.ts).
// ---------------------------------------------------------------------------

export type SupabaseUserRow = Record<string, unknown>;
export type SupabaseIdentityRow = Record<string, unknown>;

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
  /** Ligne à ne pas reprendre, avec la raison (rapport). */
  skip: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const date = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Prénom / nom depuis les métadonnées d'inscription (clés usuelles FR/EN). */
function names(meta: Record<string, unknown>): { firstName: string | null; lastName: string | null } {
  const first = str(meta.first_name) ?? str(meta.firstName) ?? str(meta.prenom) ?? str(meta.given_name);
  const last = str(meta.last_name) ?? str(meta.lastName) ?? str(meta.nom) ?? str(meta.family_name);
  if (first || last) return { firstName: first?.slice(0, 80) ?? null, lastName: last?.slice(0, 80) ?? null };
  const full = str(meta.full_name) ?? str(meta.name) ?? str(meta.username);
  if (!full) return { firstName: null, lastName: null };
  const [head, ...rest] = full.split(/\s+/);
  return { firstName: head!.slice(0, 80), lastName: rest.join(" ").slice(0, 80) || null };
}

export function mapSupabaseUser(row: SupabaseUserRow, identities: SupabaseIdentityRow[], now = new Date()): LegacyUser {
  const legacyId = String(row.id);
  const meta = (row.raw_user_meta_data && typeof row.raw_user_meta_data === "object" ? row.raw_user_meta_data : {}) as Record<string, unknown>;
  const google = identities.find((i) => i.user_id === row.id && i.provider === "google");
  const googleData = (google?.identity_data ?? {}) as Record<string, unknown>;
  const hash = str(row.encrypted_password);
  const bannedUntil = date(row.banned_until);

  let skip: string | null = null;
  if (row.deleted_at) skip = "compte supprimé sur l'ancien site";
  else if (row.is_anonymous === true) skip = "visiteur anonyme";
  else if (!str(row.email)) skip = "aucune adresse e-mail (compte par téléphone)";

  return {
    legacyId,
    email: str(row.email)?.toLowerCase() ?? null,
    passwordHash: isBcryptHash(hash) ? hash : null,
    emailVerifiedAt: date(row.email_confirmed_at) ?? date(row.confirmed_at),
    ...names(meta),
    createdAt: date(row.created_at),
    lastLoginAt: date(row.last_sign_in_at),
    googleSub: str(google?.provider_id) ?? str(googleData.sub) ?? null,
    suspended: Boolean(bannedUntil && bannedUntil > now),
    skip,
  };
}

/** Lecture seule : la transaction est ouverte en READ ONLY puis annulée. */
export async function readSupabaseUsers(client: pg.Client): Promise<LegacyUser[]> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const users = await client.query<{ row: SupabaseUserRow }>("SELECT to_jsonb(u) AS row FROM auth.users u ORDER BY u.created_at");
    const identities = await client.query<{ row: SupabaseIdentityRow }>(
      "SELECT to_jsonb(i) AS row FROM auth.identities i WHERE i.provider = 'google'",
    );
    const ids = identities.rows.map((r) => r.row);
    return users.rows.map((r) => mapSupabaseUser(r.row, ids));
  } finally {
    await client.query("ROLLBACK");
  }
}

export type UserOutcome = "créé" | "fusionné" | "mis à jour" | "inchangé" | "ignoré";

export interface UserImportLine {
  legacyId: string;
  email: string | null;
  outcome: UserOutcome;
  reason?: string;
  newId?: string;
}

/**
 * Verse les comptes dans la base visée. `apply: false` = simulation : rien
 * n'est écrit, le rapport dit ce qui serait fait.
 */
export async function importSupabaseUsers(
  legacy: LegacyUser[],
  opts: { apply: boolean; source: string },
): Promise<UserImportLine[]> {
  const clientRole = await prisma.role.findUniqueOrThrow({ where: { name: "CLIENT" }, select: { id: true } });
  const lines: UserImportLine[] = [];

  for (const u of legacy) {
    const base = { legacyId: u.legacyId, email: u.email };
    if (u.skip || !u.email) {
      lines.push({ ...base, outcome: "ignoré", reason: u.skip ?? "aucune adresse e-mail" });
      continue;
    }

    // 1. Déjà repris lors d'un passage précédent : mise à jour prudente.
    const knownId = await findRef(opts.source, "user", u.legacyId);
    if (knownId) {
      const current = await prisma.user.findUnique({
        where: { id: knownId },
        select: { id: true, passwordHash: true, emailVerifiedAt: true, status: true },
      });
      if (!current) {
        lines.push({ ...base, outcome: "ignoré", reason: "compte repris puis supprimé sur le nouveau site" });
        continue;
      }
      const data: { passwordHash?: string; emailVerifiedAt?: Date; status?: "SUSPENDED" } = {};
      // Le client n'a pas encore changé de mot de passe chez nous : on suit l'ancien site.
      const stillLegacy = current.passwordHash === null || isBcryptHash(current.passwordHash);
      if (stillLegacy && u.passwordHash && u.passwordHash !== current.passwordHash) data.passwordHash = u.passwordHash;
      if (!current.emailVerifiedAt && u.emailVerifiedAt) data.emailVerifiedAt = u.emailVerifiedAt;
      if (u.suspended && current.status === "ACTIVE") data.status = "SUSPENDED";
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
      select: { id: true, passwordHash: true, emailVerifiedAt: true, role: { select: { name: true } } },
    });
    if (existing) {
      if (existing.role.name === "ADMIN" || existing.role.name === "STAFF") {
        lines.push({ ...base, outcome: "ignoré", reason: "adresse utilisée par un compte de l'équipe" });
        continue;
      }
      if (opts.apply) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              // Son mot de passe du nouveau site est gardé ; l'ancien sert s'il n'en a pas.
              ...(existing.passwordHash ? {} : u.passwordHash ? { passwordHash: u.passwordHash } : {}),
              ...(existing.emailVerifiedAt || !u.emailVerifiedAt ? {} : { emailVerifiedAt: u.emailVerifiedAt }),
            },
          });
          await tx.legacyRef.create({ data: { source: opts.source, entity: "user", legacyId: u.legacyId, newId: existing.id } });
        });
      }
      lines.push({ ...base, outcome: "fusionné", newId: existing.id });
      continue;
    }

    // 3. Nouveau compte client.
    const googleTaken = u.googleSub ? await prisma.user.findUnique({ where: { googleSub: u.googleSub }, select: { id: true } }) : null;
    if (!opts.apply) {
      lines.push({ ...base, outcome: "créé" });
      continue;
    }
    const created = await prisma.$transaction(async (tx) => {
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
