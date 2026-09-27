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
      update: { value: s.value as never },
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

// ---------------------------------------------------------------------------
// Démo landing — données réelles consommées par GET /api/seed.
// Réinsérable (idempotent) : ne touche que les lignes portant un slug démo.
// ---------------------------------------------------------------------------

interface DemoProduct {
  slug: string;
  title: string;
  division: string;
  teamPower: number;
  coins: number;
  basePrice: number;
  promoPrice: number | null;
  paymentMode: PaymentMode;
  months: number | null;
}

const DEMO_PRODUCTS: DemoProduct[] = [
  { slug: "demo-powerhouse", title: "Compte Élite Or — 3 212 OVR", division: "Division 1", teamPower: 3212, coins: 1850, basePrice: 85000, promoPrice: 69000, paymentMode: "INSTALLMENTS", months: 6 },
  { slug: "demo-legend", title: "Compte Légende — 3 180 OVR", division: "Legend", teamPower: 3180, coins: 1240, basePrice: 64000, promoPrice: null, paymentMode: "ONE_TIME", months: null },
  { slug: "demo-ikon", title: "Compte Ikon — 3 145 OVR", division: "Ikon", teamPower: 3145, coins: 980, basePrice: 52000, promoPrice: 44900, paymentMode: "INSTALLMENTS", months: 4 },
  { slug: "demo-epic", title: "Compte Épic — 3 090 OVR", division: "Epic", teamPower: 3090, coins: 760, basePrice: 41000, promoPrice: null, paymentMode: "ONE_TIME", months: null },
  { slug: "demo-div2-1", title: "Compte Division 2 — 2 880 OVR", division: "Division 2", teamPower: 2880, coins: 350, basePrice: 28000, promoPrice: null, paymentMode: "ONE_TIME", months: null },
  { slug: "demo-div2-2", title: "Compte Division 2 — 2 740 OVR", division: "Division 2", teamPower: 2740, coins: 210, basePrice: 21500, promoPrice: 17800, paymentMode: "INSTALLMENTS", months: 3 },
];

async function seedDemo() {
  const now = new Date();
  for (const [i, p] of DEMO_PRODUCTS.entries()) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        slug: p.slug,
        title: p.title,
        description:
          "Compte eFootball vérifié par l'équipe : historique propre, e-mail de récupération sécurisé, livraison après paiement confirmé serveur.",
        division: p.division,
        teamPower: p.teamPower,
        coins: p.coins,
        basePrice: p.basePrice,
        paymentMode: p.paymentMode,
        installmentMonths: p.months,
        featuredPriceOverride: p.promoPrice,
        status: "ACTIVE",
        publishedAt: new Date(now.getTime() - (i + 1) * 3600_000),
        createdAt: new Date(now.getTime() - (i + 1) * 3600_000),
      },
      create: {
        slug: p.slug,
        title: p.title,
        description: "Compte eFootball de démonstration, paiement confirmé côté serveur.",
        division: p.division,
        teamPower: p.teamPower,
        coins: p.coins,
        basePrice: p.basePrice,
        paymentMode: p.paymentMode,
        installmentMonths: p.months,
        featuredPriceOverride: p.promoPrice,
        status: "ACTIVE",
        publishedAt: new Date(now.getTime() - (i + 1) * 3600_000),
        createdAt: new Date(now.getTime() - (i + 1) * 3600_000),
      },
    });
  }
  console.log(`[seed] catalogue de démonstration : ${DEMO_PRODUCTS.length} produits; aucun compte ni commande créé.`);
}

async function main() {
  await seedRoles();
  await seedSettings();
  await seedDemo();
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