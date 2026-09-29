// Moteur de traduction partagé serveur / client (aucun hook ici).
import { DICTIONARIES, type MessageKey } from "./messages";

export type { MessageKey };
export type Locale = "fr" | "en" | "ar";
export const DEFAULT_LOCALE: Locale = "fr";

/** Locale BCP 47 pour les dates et nombres. */
export const INTL_LOCALE: Record<Locale, string> = { fr: "fr-FR", en: "en-GB", ar: "ar-SN" };

export function isLocale(value: unknown): value is Locale {
  return value === "fr" || value === "en" || value === "ar";
}

export type TranslateVars = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES.fr[key] ?? key;
  return vars ? template.replace(/{(w+)}/g, (_, name: string) => String(vars[name] ?? "")) : template;
}

export type T = ((key: MessageKey, vars?: TranslateVars) => string) & { locale: Locale; intl: string };

export function makeT(locale: Locale): T {
  return Object.assign((key: MessageKey, vars?: TranslateVars) => translate(locale, key, vars), { locale, intl: INTL_LOCALE[locale] });
}
