import "dotenv/config";
import { prisma } from "@misterdou/db";
import { hashPassword } from "./lib/password.js";

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const firstName = process.env.ADMIN_BOOTSTRAP_FIRST_NAME?.trim() || "Administrateur";
  if (!email) throw new Error("Définissez ADMIN_BOOTSTRAP_EMAIL.");

  const existing = await prisma.user.findUnique({ where: { email }, include: { role: { select: { name: true } } } });
  if (existing) {
    if (existing.role.name !== "ADMIN") throw new Error("Cet e-mail est déjà utilisé par un compte non administrateur. Choisissez un autre e-mail.");
    console.log(`Le compte administrateur existe déjà. MFA ${existing.twoFactorEnabled ? "activée" : "à configurer à la première connexion"}. Aucun mot de passe ni rôle n’a été modifié.`);
    return;
  }
  if (!password || password.length < 14) {
    throw new Error("Pour créer un nouvel administrateur, définissez un ADMIN_BOOTSTRAP_PASSWORD d’au moins 14 caractères.");
  }

  const role = await prisma.role.upsert({
    where: { name: "ADMIN" },
    create: { name: "ADMIN", description: "Administrateur principal", isSystem: true },
    update: {},
  });
  await prisma.user.create({
    data: {
      roleId: role.id,
      email,
      firstName,
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
      twoFactorEnabled: false,
      notificationPreference: { create: {} },
    },
  });
  console.log(`Compte administrateur créé pour ${email}. La première connexion impose la configuration TOTP.`);
}

main()
  .catch((error) => {
    console.error("[admin-bootstrap] Échec de création du compte administrateur.");
    console.error(error instanceof Error ? error.message : "Erreur inconnue");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
