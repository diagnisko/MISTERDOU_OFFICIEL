import "dotenv/config";
import { createInterface } from "node:readline";
import { prisma } from "@misterdou/db";
import { hashPassword } from "./lib/password.js";

// ---------------------------------------------------------------------------
// Réinitialiser l'accès d'un administrateur, depuis un terminal de confiance :
//   pnpm --filter @misterdou/api admin:reset
// Demande l'e-mail, puis le nouveau mot de passe (saisie masquée, jamais
// affichée ni journalisée). Peut aussi remettre à zéro la double
// authentification : la prochaine connexion affichera un nouveau QR code.
// Toutes les sessions ouvertes du compte sont fermées.
// ---------------------------------------------------------------------------

const MIN_LENGTH = 14;

// Un seul lecteur pour tout le script : le fermer entre deux questions
// arrêterait la lecture de l'entrée standard.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
type Writer = { _writeToOutput: (s: string) => void };
const writeOut = (rl as unknown as Writer)._writeToOutput.bind(rl);
let masking = false;
// Saisie masquée : chaque caractère tapé s'affiche « * ».
(rl as unknown as Writer)._writeToOutput = (s: string) => {
  if (!masking || s === "\r\n" || s === "\n") writeOut(s);
  else writeOut("*".repeat(s.length));
};

// File de lignes : en saisie redirigée, les lignes peuvent arriver avant la question.
const lines: string[] = [];
const waiting: Array<{ resolve: (s: string) => void; reject: (e: Error) => void }> = [];
rl.on("line", (line) => {
  masking = false;
  const next = waiting.shift();
  if (next) next.resolve(line);
  else lines.push(line);
});
rl.on("close", () => {
  for (const w of waiting.splice(0)) w.reject(new Error("Saisie interrompue."));
});

function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  const ready = lines.shift();
  if (ready !== undefined) {
    if (hidden) process.stdout.write("\n");
    return Promise.resolve(ready);
  }
  masking = hidden;
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? (await ask("E-mail de l’administrateur : "))).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, include: { role: { select: { name: true } } } });
  if (!user || (user.role.name !== "ADMIN" && user.role.name !== "STAFF")) {
    throw new Error("Aucun compte administrateur ou équipe avec cet e-mail.");
  }

  const password = await ask(`Nouveau mot de passe (${MIN_LENGTH} caractères minimum) : `, true);
  if (password.length < MIN_LENGTH) throw new Error(`Mot de passe trop court : ${MIN_LENGTH} caractères minimum.`);
  const confirm = await ask("Confirmez le mot de passe : ", true);
  if (confirm !== password) throw new Error("Les deux saisies ne correspondent pas.");

  const resetMfa =
    user.role.name === "ADMIN" &&
    /^o(ui)?$/i.test((await ask("Remettre à zéro la double authentification (application perdue ou changée) ? [o/N] : ")).trim());

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), status: "ACTIVE", ...(resetMfa ? { twoFactorEnabled: false } : {}) },
    }),
    ...(resetMfa ? [prisma.settings.deleteMany({ where: { key: `adminTotpSecret:${user.id}` } })] : []),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        actorRole: user.role.name,
        action: resetMfa ? "ADMIN_ACCESS_RESET_WITH_MFA" : "ADMIN_PASSWORD_RESET",
        resourceType: "User",
        resourceId: user.id,
        severity: "CRITICAL",
        metadata: { source: "cli" },
      },
    }),
  ]);

  console.log(`\nAccès mis à jour pour ${email}.`);
  console.log(
    resetMfa
      ? "À la prochaine connexion sur /console/sign-in, un QR code s’affichera : scannez-le avec votre application d’authentification."
      : "Connectez-vous sur /console/sign-in avec ce mot de passe, puis le code de votre application d’authentification.",
  );
}

main()
  .catch((error) => {
    console.error("\n[admin-reset] " + (error instanceof Error ? error.message : "Erreur inconnue"));
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
