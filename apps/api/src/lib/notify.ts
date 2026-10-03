import { prisma } from "@misterdou/db";
import type { ManagerPermission, NotificationChannel, NotificationPriority, NotificationType } from "@misterdou/db";
import { logger } from "./logger.js";
import { sendEmail } from "./email.js";
import { EMAIL_TEMPLATES, isCriticalEmailType } from "./email-templates.js";
import { env } from "../env.js";

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
export async function notifyMany(type: NotificationType, entries: NotifyBatchEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const userIds = [...new Set(entries.map((entry) => entry.userId))];
    const emailWanted = isCriticalEmailType(type);

    const [prefs, users] = await Promise.all([
      prisma.notificationPreference.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, inApp: true, email: true },
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
    const emails: Array<{ to: string; params: NotifyParams }> = [];
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
      if (emailWanted && email && emailAllowed && template) emails.push({ to: email, params: { ...params, actionUrl: absoluteUrl(params.actionUrl) } });
    }

    if (rows.length > 0) await prisma.notification.createMany({ data: rows });

    // Un e-mail en échec n'empêche jamais les suivants.
    await Promise.all(
      emails.map(async (mail) => {
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
): Promise<void> {
  await notifyMany(type, [{ userId, params }]);
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
    await notifyMany(
      type,
      admins.map((admin) => ({ userId: admin.id, params })),
    );
  } catch (err) {
    logger.warn({ err, type }, "[notify] échec d'alerte des administrateurs");
  }
}

// Alerte à ceux qui peuvent agir : administrateurs actifs et managers qui ont
// la permission demandée (ex. PAYMENTS pour valider une preuve de paiement).
export async function notifyTeam(
  permission: ManagerPermission,
  type: NotificationType,
  params: NotifyParams,
): Promise<void> {
  try {
    const team = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        OR: [{ role: { name: "ADMIN" } }, { role: { name: "STAFF" }, managerProfile: { permissions: { has: permission } } }],
      },
      select: { id: true },
    });
    await notifyMany(
      type,
      team.map((member) => ({ userId: member.id, params })),
    );
  } catch (err) {
    logger.warn({ err, type, permission }, "[notify] échec d'alerte de l'équipe");
  }
}
