import { z } from "zod";
import type { core } from "zod";
import { ApiError } from "./errors.js";

// ---------------------------------------------------------------------------
// Messages de saisie en français simple, pour tout le site : chaque erreur dit
// quel champ est en cause (son nom affiché, jamais le nom technique) et quoi
// corriger. Les messages écrits dans un schéma (« ID eFootball obligatoire »)
// restent prioritaires ; tous les autres passent par ici.
// ---------------------------------------------------------------------------

/** Nom affiché des champs (dernier élément du chemin). */
const FIELD_LABELS: Record<string, string> = {
  title: "Titre",
  description: "Description",
  division: "Division",
  teamPower: "Puissance d’équipe",
  coins: "Pièces",
  extraInfo: "Points forts",
  basePrice: "Prix",
  price: "Prix",
  promoPrice: "Prix en promotion",
  discountPercent: "Réduction",
  paymentMode: "Mode de paiement",
  installmentMonths: "Nombre de mensualités",
  installmentDownPayment: "Apport",
  gameAccountId: "ID eFootball",
  acceptsExchange: "Échange accepté",
  loginId: "Identifiant de connexion",
  login: "Identifiant du compte",
  password: "Mot de passe",
  currentPassword: "Mot de passe actuel",
  newPassword: "Nouveau mot de passe",
  email: "E-mail",
  firstName: "Prénom",
  lastName: "Nom",
  birthDate: "Date de naissance",
  country: "Pays",
  city: "Ville",
  address: "Adresse",
  phone: "Téléphone",
  phoneNumber: "Téléphone",
  senderPhone: "Numéro Wave",
  waveReference: "Référence Wave",
  amount: "Montant",
  topUpAmount: "Montant à ajouter",
  months: "Durée",
  days: "Nombre de jours",
  content: "Message",
  message: "Message",
  reason: "Motif",
  note: "Note",
  code: "Code",
  subject: "Objet",
  category: "Sujet",
  status: "Statut",
  value: "Valeur",
  startsAt: "Date de début",
  endsAt: "Date de fin",
  documentType: "Type de pièce",
  method: "Moyen de paiement",
  images: "Photos",
  videoKey: "Vidéo",
  quantity: "Quantité",
};

/** Champs exprimés en francs CFA (le minimum s'affiche « 500 FCFA »). */
const MONEY_FIELDS = new Set(["basePrice", "price", "promoPrice", "installmentDownPayment", "amount", "topUpAmount"]);

const fmt = (n: number | bigint) => new Intl.NumberFormat("fr-FR").format(Number(n));

function fieldOf(path: readonly PropertyKey[] | undefined): string | null {
  const last = [...(path ?? [])].reverse().find((p) => typeof p === "string");
  return typeof last === "string" ? last : null;
}

/** Nom affiché d'un champ ; null s'il n'est pas connu (on ne montre jamais le nom technique). */
export function fieldLabel(path: readonly PropertyKey[] | undefined): string | null {
  const field = fieldOf(path);
  return field ? (FIELD_LABELS[field] ?? null) : null;
}

/** Phrase courte, en français simple, pour un problème de saisie. */
function phrase(iss: core.$ZodRawIssue): string {
  const field = fieldOf(iss.path as PropertyKey[] | undefined);
  const money = field !== null && MONEY_FIELDS.has(field);
  const issue = iss as unknown as {
    code: string;
    origin?: string;
    minimum?: number | bigint;
    maximum?: number | bigint;
    inclusive?: boolean;
    expected?: string;
    format?: string;
    input?: unknown;
  };
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined || issue.input === null || issue.input === "") return "À remplir.";
      if (issue.expected === "number" || issue.expected === "int") return "Écrivez un nombre.";
      if (issue.expected === "date") return "Date invalide.";
      return "Valeur invalide.";
    case "too_small": {
      const min = issue.minimum ?? 0;
      if (issue.origin === "string") return Number(min) <= 1 ? "À remplir." : `${fmt(min)} caractères au minimum.`;
      if (issue.origin === "array" || issue.origin === "set") return Number(min) <= 1 ? "Ajoutez au moins un élément." : `Au moins ${fmt(min)} éléments.`;
      if (issue.origin === "date") return "Date trop ancienne.";
      const value = `${fmt(min)}${money ? " FCFA" : ""}`;
      return issue.inclusive === false ? `Plus de ${value}.` : `${value} au minimum.`;
    }
    case "too_big": {
      const max = issue.maximum ?? 0;
      if (issue.origin === "string") return `${fmt(max)} caractères au maximum.`;
      if (issue.origin === "array" || issue.origin === "set") return `${fmt(max)} au maximum.`;
      if (issue.origin === "date") return "Date trop lointaine.";
      const value = `${fmt(max)}${money ? " FCFA" : ""}`;
      return issue.inclusive === false ? `Moins de ${value}.` : `${value} au maximum.`;
    }
    case "invalid_format":
      if (issue.format === "email") return "Adresse e-mail invalide (exemple : nom@gmail.com).";
      if (issue.format === "url") return "Lien invalide.";
      if (issue.format === "uuid" || issue.format === "guid") return "Élément introuvable : rechargez la page.";
      if (issue.format === "datetime" || issue.format === "date") return "Date invalide.";
      return "Format invalide.";
    case "not_multiple_of":
      return "Écrivez un nombre entier.";
    case "invalid_value":
      return "Choix invalide : choisissez dans la liste.";
    case "unrecognized_keys":
      return "Information inattendue : rechargez la page.";
    default:
      return "Valeur invalide.";
  }
}

// Branché dès le chargement : tous les schémas du serveur en profitent.
z.config({ customError: (iss) => phrase(iss) });

/** Erreur de saisie : le premier problème (avec le nom du champ) + tous les problèmes, champ par champ. */
export function validationError(issues: readonly core.$ZodIssue[]): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  const first = issues[0];
  const label = first ? fieldLabel(first.path) : null;
  const message = first ? (label ? `${label} : ${first.message}` : first.message) : "Certaines informations ne sont pas valides.";
  return new ApiError("VALIDATION_ERROR", 400, message, { fields });
}

/** Erreur attachée à un champ précis (le formulaire l'affiche sous ce champ). */
export function fieldError(field: string, message: string, code: ApiError["code"] = "VALIDATION_ERROR", status = 400): ApiError {
  const label = FIELD_LABELS[field.split(".").pop() ?? field];
  return new ApiError(code, status, label && !message.startsWith(label) ? `${label} : ${message}` : message, { fields: { [field]: message } });
}
