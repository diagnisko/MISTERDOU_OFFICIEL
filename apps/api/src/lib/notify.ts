import { prisma } from "@misterdou/db";
import type { ManagerPermission, NotificationChannel, NotificationPriority, NotificationType } from "@misterdou/db";
import { logger } from "./logger.js";
import { sendEmail } from "./email.js";
import { EMAIL_TEMPLATES, isCriticalEmailType } from "./email-templates.js";
import { env } from "../env.js";
import { pushToUsers } from "./push.js";
import { isOnShift } from "./shifts.js";

/** « /account/orders » → « https://site/account/orders » pour les e-mails. */
function absoluteUrl(actionUrl: string | undefined): string | undefined {
  if (!actionUrl || !actionUrl.startsWith("/")) return actionUrl;
  return `${env.WEB_ORIGIN[0]?.replace(/\/$/, "") ?? ""}${actionUrl}`;
}

export interface NotifyParams {
  title: string;
  message: string;
  channel?: NotificationChannel;
  priority?: NotificationPriority;
  actionUrl?: string;
}

/**
 * Téléphone : chaque notification part aussi sur les appareils abonnés du
 * membre (préférence push), sauf `push: false`. `emailFallback` (alertes
 * d'équipe) : l'e-mail ne part qu'à ceux qu'aucun appareil n'a atteints.
 */
export interface NotifyOptions {
  push?: false | { tag?: string; emailFallback?: boolean };
}

export interface NotifyBatchEntry {
  userId: string;
  params: NotifyParams;
}

// Crée la(s) notification(s) IN_APP et les e-mails critiques associés (Phase 10).
// - CRITICAL : la ligne IN_APP est TOUJOURS créée, même si la préférence
//   inApp=false (§61 : les notifications critiques ne sont pas désactivables).
// - non critique + inApp=false : aucune ligne IN_APP (choix de l'utilisateur).
// - e-mail : uniquement des types du registre critique, si email !== false.
// Une notification ne doit jamais faire échouer l'action métier.
//
// Version EN LOT : 1 lecture des préférences + 1 createMany + 1 lecture des
// e-mails pour TOUS les destinataires, au lieu d'environ 3 requêtes PAR
// destinataire (l'ancienne boucle `admins.map(notifyUser)` de notifyActiveAdmins
// partait en N+1 dès le premier message d'une nouvelle conversation).
// Les règles de préférence restent évaluées LIGNE PAR LIGNE : une entrée
// CRITICAL n'élève pas la priorité de ses voisines.
//
// Téléphone : voir NotifyOptions (envoyé par défaut aux appareils abonnés).
export async function notifyMany(type: NotificationType, entries: NotifyBatchEntry[], opts: NotifyOptions = {}): Promise<void> {
  if (entries.length === 0) return;
  try {
    const userIds = [...new Set(entries.map((entry) => entry.userId))];
    const emailWanted = isCriticalEmailType(type);

    const [prefs, users] = await Promise.all([
      prisma.notificationPreference.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, inApp: true, email: true, push: true },
      }),
      emailWanted
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
        : Promise.resolve([] as Array<{ id: string; email: string | null }>),
    ]);
    const prefByUser = new Map(prefs.map((pref) => [pref.userId, pref]));
    const userById = new Map(users.map((user) => [user.id, user]));

    const rows: Array<{
      userId: string;
      type: NotificationType;
      title: string;
      message: string;
      channel: NotificationChannel;
      priority: NotificationPriority;
      actionUrl: string | null;
    }> = [];
    const emails: Array<{ userId: string; to: string; params: NotifyParams }> = [];
    const template = EMAIL_TEMPLATES[type];

    for (const { userId, params } of entries) {
      const pref = prefByUser.get(userId);
      const explicitChannel = params.channel !== undefined;
      const priority = params.priority ?? "NORMAL";
      const channel = params.channel ?? "IN_APP";
      if (explicitChannel || priority === "CRITICAL" || pref?.inApp !== false) {
        rows.push({
          userId,
          type,
          title: params.title,
          message: params.message,
          channel,
          priority,
          actionUrl: params.actionUrl ?? null,
        });
      }
      const emailAllowed = explicitChannel ? params.channel === "EMAIL" : pref?.email !== false;
      const email = userById.get(userId)?.email;
      if (emailWanted && email && emailAllowed && template) emails.push({ userId, to: email, params: { ...params, actionUrl: absoluteUrl(params.actionUrl) } });
    }

    if (rows.length > 0) await prisma.notification.createMany({ data: rows });

    // Téléphones : un envoi par message distinct (les entrées d'un lot peuvent différer).
    const reached = new Set<string>();
    const push = opts.push === false ? null : (opts.push ?? {});
    if (push) {
      const groups = new Map<string, { params: NotifyParams; userIds: string[] }>();
      for (const { userId, params } of entries) {
        if (prefByUser.get(userId)?.push === false || params.channel === "EMAIL") continue;
        const key = JSON.stringify([params.title, params.message, params.actionUrl ?? ""]);
        const group = groups.get(key) ?? { params, userIds: [] };
        group.userIds.push(userId);
        groups.set(key, group);
      }
      for (const { params, userIds: ids } of groups.values()) {
        const hit = await pushToUsers(ids, { title: params.title, body: params.message, url: params.actionUrl ?? "/", tag: push.tag });
        for (const id of hit) reached.add(id);
      }
    }

    // Un e-mail en échec n'empêche jamais les suivants.
    await Promise.all(
      emails.filter((mail) => !(push?.emailFallback && reached.has(mail.userId))).map(async (mail) => {
        try {
          await sendEmail({
            to: mail.to,
            subject: template!.subject(mail.params),
            text: template!.text(mail.params),
            template: type,
          });
        } catch (err) {
          logger.warn({ err, type }, "[notify] échec d'envoi d'e-mail de notification");
        }
      }),
    );
  } catch (err) {
    logger.warn({ err, type, count: entries.length }, "[notify] échec de création des notifications");
  }
}

// Destinataire unique — délègue au lot : une seule implémentation des règles.
export async function notifyUser(
  userId: string,
  type: NotificationType,
  params: NotifyParams,
  opts: NotifyOptions = {},
): Promise<void> {
  await notifyMany(type, [{ userId, params }], opts);
}

// Alerte poussée à TOUS les administrateurs actifs (§58 « notifications des
// administrateurs ») : 2 requêtes au total (liste des admins + lot de
// préférences/insertions). Chaque envoi reste non bloquant.
export async function notifyActiveAdmins(
  type: NotificationType,
  params: NotifyParams,
): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } },
      select: { id: true },
    });
    // Informations (nouveaux inscrits…) : cloche et e-mail, pas le téléphone.
    await notifyMany(
      type,
      admins.map((admin) => ({ userId: admin.id, params })),
      { push: false },
    );
  } catch (err) {
    logger.warn({ err, type }, "[notify] échec d'alerte des administrateurs");
  }
}

/**
 * Membres de l'équipe à prévenir maintenant : les administrateurs actifs
 * (toujours) et les managers qui ont la permission et sont en service (dans
 * un de leurs créneaux, ou sans créneau). Un manager hors créneau n'est pas
 * dérangé : son espace est fermé ; il retrouve le travail en attente au début
 * de son créneau (lib/shift-digest.ts). `null` : administrateurs seuls.
 */
export async function teamOnDuty(permission: ManagerPermission | null, now: Date = new Date()): Promise<string[]> {
  const members = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      OR: [
        { role: { name: "ADMIN" } },
        ...(permission ? [{ role: { name: "STAFF" as const }, managerProfile: { permissions: { has: permission } } }] : []),
      ],
    },
    select: {
      id: true,
      role: { select: { name: true } },
      managerProfile: { select: { managerShift: { select: { day: true, startMinute: true, endMinute: true } } } },
    },
  });
  return members
    .filter((m) => m.role.name === "ADMIN" || isOnShift(m.managerProfile?.managerShift ?? [], now))
    .map((m) => m.id);
}

// Alerte à ceux qui peuvent agir maintenant (voir teamOnDuty) : cloche,
// notification sur le téléphone, e-mail de secours. `tag` regroupe les
// notifications d'un même sujet (ex. une conversation) sur le téléphone.
export async function notifyTeam(
  permission: ManagerPermission | null,
  type: NotificationType,
  params: NotifyParams,
  opts: { tag?: string } = {},
): Promise<void> {
  try {
    const ids = await teamOnDuty(permission);
    await notifyMany(
      type,
      ids.map((userId) => ({ userId, params })),
      { push: { tag: opts.tag, emailFallback: true } },
    );
  } catch (err) {
    logger.warn({ err, type, permission }, "[notify] échec d'alerte de l'équipe");
  }
}
