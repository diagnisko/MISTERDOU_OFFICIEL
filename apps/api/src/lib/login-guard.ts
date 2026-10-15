import { prisma } from "@misterdou/db";
import { ApiError } from "./errors.js";
import { logAudit } from "./audit.js";
import { notifyMany, notifyUser, type NotifyParams } from "./notify.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Protection des connexions.
// • Blocage : après 5 mauvais mots de passe (ou codes de la console) en
//   15 minutes, le compte refuse toute connexion pendant 15 minutes, quelle
//   que soit l'adresse du pirate. Les échecs sont comptés par adresse e-mail
//   (même pour une adresse inconnue : rien ne trahit qu'un compte existe) et
//   repartent de zéro après une connexion réussie. Le propriétaire est
//   prévenu ; l'administration aussi s'il s'agit d'un membre de l'équipe.
// • Nouvel appareil : un administrateur ou un membre de l'équipe qui se
//   connecte depuis un navigateur ou un appareil jamais vu est prévenu, ainsi
//   que les administrateurs (pas pour une toute première connexion).
// ---------------------------------------------------------------------------

export const LOGIN_FAIL_LIMIT = 5;
export const LOGIN_LOCK_MINUTES = 15;
const FAILURE_ACTION = "LOGIN_FAILED";
const FAILURE_RESOURCE = "LoginEmail";

export type LoginContext = { ip?: string; userAgent?: string; country?: string };
export type GuardedUser = { id: string; firstName: string | null; lastName: string | null; lastLoginAt: Date | null; role: { name: string } };

const emailKey = (email: string) => email.trim().toLowerCase().slice(0, 254);

async function recentFailures(email: string, lastLoginAt: Date | null | undefined): Promise<number> {
  const windowStart = new Date(Date.now() - LOGIN_LOCK_MINUTES * 60_000);
  const from = lastLoginAt && lastLoginAt > windowStart ? lastLoginAt : windowStart;
  return prisma.auditLog.count({
    where: { action: FAILURE_ACTION, resourceType: FAILURE_RESOURCE, resourceId: emailKey(email), createdAt: { gt: from } },
  });
}

/** Compte bloqué après trop d'échecs : refus avant même de vérifier le mot de passe. */
export async function assertLoginAllowed(email: string, user?: Pick<GuardedUser, "lastLoginAt"> | null): Promise<void> {
  if ((await recentFailures(email, user?.lastLoginAt)) >= LOGIN_FAIL_LIMIT) {
    throw new ApiError(
      "RATE_LIMITED",
      429,
      `Trop d’essais avec un mauvais mot de passe : ce compte est bloqué ${LOGIN_LOCK_MINUTES} minutes par sécurité. Réessayez ensuite, ou utilisez « Mot de passe oublié ».`,
    );
  }
}

/** Mauvais mot de passe (ou mauvais code) : noté ; au 5e, le compte se bloque et le propriétaire est prévenu. */
export async function recordLoginFailure(email: string, ctx: LoginContext, user?: GuardedUser | null): Promise<void> {
  await logAudit({
    actorId: user?.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    action: FAILURE_ACTION,
    resourceType: FAILURE_RESOURCE,
    resourceId: emailKey(email),
    severity: "WARNING",
  });
  if (!user) return;
  try {
    if ((await recentFailures(email, user.lastLoginAt)) !== LOGIN_FAIL_LIMIT) return;
    await notifyUser(
      user.id,
      "SECURITY_ALERT",
      {
        title: "Tentatives de connexion bloquées",
        message: `${LOGIN_FAIL_LIMIT} essais avec un mauvais mot de passe viennent d’avoir lieu sur votre compte MISTERDOU${where(ctx)}. Par sécurité, il est bloqué ${LOGIN_LOCK_MINUTES} minutes. Si ce n’était pas vous, changez votre mot de passe dès que possible.`,
        actionUrl: "/account/settings",
        priority: "CRITICAL",
      },
      { forceEmail: true },
    );
    if (user.role.name === "ADMIN" || user.role.name === "STAFF") {
      await alertAdmins(user.id, {
        title: "Tentatives de connexion sur un compte de l’équipe",
        message: `${LOGIN_FAIL_LIMIT} mauvais mots de passe en quelques minutes sur le compte de ${fullName(user)} (${roleLabel(user.role.name)})${where(ctx)}. Le compte est bloqué ${LOGIN_LOCK_MINUTES} minutes. Vérifiez auprès de ce membre que ces essais viennent bien de sa part.`,
        actionUrl: "/admin/team",
        priority: "CRITICAL",
      });
    }
  } catch (err) {
    logger.warn({ err }, "[login-guard] alerte de blocage non envoyée");
  }
}

/** Navigateur et système, en clair : « Chrome sur Windows », « Safari sur iPhone »… */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Linux|CrOS/.test(ua)
              ? "Linux"
              : "appareil inconnu";
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /FxiOS|Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "navigateur inconnu";
  return `${browser} sur ${os}`;
}

/**
 * Connexion réussie d'un administrateur ou d'un membre de l'équipe : à appeler
 * AVANT de créer la nouvelle session (comparaison avec les connexions passées).
 */
export async function alertIfNewTeamDevice(user: GuardedUser, ctx: LoginContext): Promise<void> {
  if (user.role.name !== "ADMIN" && user.role.name !== "STAFF") return;
  try {
    const previous = await prisma.session.findMany({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 180 * 86_400_000) } },
      select: { userAgent: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    if (previous.length === 0) return; // toute première connexion : rien d'anormal
    const label = deviceLabel(ctx.userAgent);
    if (previous.some((session) => deviceLabel(session.userAgent) === label)) return;

    const when = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Dakar", dateStyle: "short", timeStyle: "short" });
    await logAudit({
      actorId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      action: "NEW_DEVICE_LOGIN",
      resourceType: "User",
      resourceId: user.id,
      metadata: { device: label, country: ctx.country ?? null },
      severity: "WARNING",
    });
    await notifyUser(
      user.id,
      "SECURITY_ALERT",
      {
        title: "Nouvelle connexion à votre compte",
        message: `Connexion à votre compte MISTERDOU depuis ${label}${where(ctx)}, le ${when}. Si ce n’est pas vous, changez votre mot de passe tout de suite et prévenez l’administrateur.`,
        actionUrl: "/account/settings",
        priority: "CRITICAL",
      },
      { forceEmail: true },
    );
    const response =
      user.role.name === "STAFF"
        ? "Si ce n’est pas ce membre, touchez « Déconnecter partout » dans Équipe, puis demandez-lui de changer son mot de passe."
        : "Si ce n’est pas cet administrateur, changez tout de suite le mot de passe de ce compte et refaites sa double authentification.";
    await alertAdmins(user.id, {
      title: "Connexion d’un membre depuis un nouvel appareil",
      message: `Connexion de ${fullName(user)} (${roleLabel(user.role.name)}) depuis ${label}${where(ctx)}, le ${when}. ${response}`,
      actionUrl: "/admin/team",
      priority: "CRITICAL",
    });
  } catch (err) {
    logger.warn({ err }, "[login-guard] alerte de nouvel appareil non envoyée");
  }
}

/** Tous les administrateurs actifs (sauf `exceptId`) : cloche, téléphone et e-mail. */
export async function alertAdmins(exceptId: string | null, params: NotifyParams): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  await notifyMany(
    "ADMIN_ALERT",
    admins.map((admin) => ({ userId: admin.id, params })),
    { forceEmail: true },
  );
}

function where(ctx: LoginContext): string {
  const parts = [ctx.ip ? `adresse ${ctx.ip}` : null, ctx.country && ctx.country !== "XX" ? `pays : ${ctx.country}` : null].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function fullName(user: Pick<GuardedUser, "firstName" | "lastName">): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "un membre";
}

function roleLabel(role: string): string {
  return role === "ADMIN" ? "administrateur" : "équipe";
}
