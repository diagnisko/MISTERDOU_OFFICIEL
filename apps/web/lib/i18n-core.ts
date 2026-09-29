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

/** true si la clé existe dans le dictionnaire de référence (français). */
export function hasMessage(key: string): key is MessageKey {
  return key in DICTIONARIES.fr;
}

export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES.fr[key] ?? key;
  return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? "")) : template;
}

export type T = ((key: MessageKey, vars?: TranslateVars) => string) & { locale: Locale; intl: string };

export function makeT(locale: Locale): T {
  return Object.assign((key: MessageKey, vars?: TranslateVars) => translate(locale, key, vars), { locale, intl: INTL_LOCALE[locale] });
}

/** Locale d'affichage lue sur <html lang> (utilitaires hors composant) ; français par défaut. */
export function documentIntl(): string {
  if (typeof document === "undefined") return INTL_LOCALE[DEFAULT_LOCALE];
  const lang = document.documentElement.lang;
  return INTL_LOCALE[isLocale(lang) ? lang : DEFAULT_LOCALE];
}

/** Langue d'affichage lue sur <html lang> ; français par défaut. */
export function documentLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}
