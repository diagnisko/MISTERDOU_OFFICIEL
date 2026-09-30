import "dotenv/config";
import { PrismaClient, RoleName, PaymentMode } from "../generated/client/index.js";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Valeurs par défaut des paramètres configurables (Phase 1)
// Paramètres minimaux utilisés par le parcours client.
// ---------------------------------------------------------------------------

interface SeedSetting {
  key: string;
  value: unknown;
  valueType: "int" | "string" | "bool" | "json";
  group: string;
  description: string;
}

const DEFAULT_SETTINGS: SeedSetting[] = [
  { key: "maxInstallments", value: 8, valueType: "int", group: "payments", description: "Nombre maximum de mensualités (plafond serveur : 8)" },
  { key: "installmentRounding", value: "FIRST", valueType: "string", group: "payments", description: "Répartition des arrondis d'échéances : FIRST | LAST | BALANCED" },
  { key: "currency", value: "XOF", valueType: "string", group: "platform", description: "Devise de la plateforme" },
  { key: "platformName", value: "MISTERDOU", valueType: "string", group: "platform", description: "Nom public de la plateforme" },
  { key: "sellerCommissionPercent", value: 15, valueType: "int", group: "sellers", description: "Commission de la plateforme sur chaque vente vendeur (%)" },
  { key: "payoutHoldDays", value: 3, valueType: "int", group: "sellers", description: "Jours avant libération automatique des fonds si le client n'a pas confirmé la réception" },
  { key: "sellerRegistrationFee", value: 1000, valueType: "int", group: "sellers", description: "Frais d'adhésion pour devenir vendeur (FCFA)" },
  { key: "minWithdrawalAmount", value: 1000, valueType: "int", group: "sellers", description: "Montant minimum d'un retrait vendeur (FCFA)" },
  { key: "verificationCodeTtlMinutes", value: 10, valueType: "int", group: "orders", description: "Durée de validité d'un code de vérification fourni au client (minutes)" },
];

async function seedRoles() {
  const roles: { name: RoleName; description: string }[] = [
    { name: "CLIENT", description: "Peut consulter le catalogue et acheter." },
    { name: "VENDOR", description: "Client vérifié autorisé à vendre ses produits." },
    { name: "STAFF", description: "Personnel autorisé aux tâches de modération." },
    { name: "ADMIN", description: "Administrateur de la plateforme." },
  ];
  for (const r of roles) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: { name: r.name, description: r.description, isSystem: true },
    });
  }
  console.log("[seed] rôles prêts :", roles.map((r) => r.name).join(", "));
}

async function seedSettings() {
  for (const s of DEFAULT_SETTINGS) {
    await prisma.settings.upsert({
      where: { key: s.key },
      // Ne jamais écraser une valeur réglée par l'administrateur.
      update: {},
      create: {
        key: s.key,
        value: s.value as never,
        valueType: s.valueType,
        group: s.group,
        description: s.description,
      },
    });
  }
  console.log(`[seed] settings prêts : ${DEFAULT_SETTINGS.length} paramètres`);
}

async function main() {
  await seedRoles();
  await seedSettings();
}

main()
  .then(() => {
    console.log("[seed] terminé.");
  })
  .catch((err) => {
    console.error("[seed] échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });