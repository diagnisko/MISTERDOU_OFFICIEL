"use client";

import { useEffect, useState } from "react";
import { LOCALE_KEY, THEME_KEY } from "./preferences-boot";

// ---------------------------------------------------------------------------
// Préférences d'affichage (Paramètres → Apparence / Langue), propres à
// l'appareil. Appliquées sur <html> : data-theme, lang et dir (arabe → rtl).
// Le script PREFERENCES_BOOT_SCRIPT les pose avant le premier rendu.
// ---------------------------------------------------------------------------

export type Theme = "dark" | "light";
export type Locale = "fr" | "en" | "ar";

export const LOCALES: Array<{ value: Locale; label: string; native: string }> = [
  { value: "fr", label: "Français", native: "Français" },
  { value: "en", label: "Anglais", native: "English" },
  { value: "ar", label: "Arabe", native: "العربية" },
];

type Prefs = { theme: Theme; locale: Locale };

let prefs: Prefs = { theme: "dark", locale: "fr" };
let loaded = false;
const listeners = new Set<(p: Prefs) => void>();

function read(): Prefs {
  try {
    const theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    const stored = localStorage.getItem(LOCALE_KEY);
    const locale: Locale = stored === "en" || stored === "ar" ? stored : "fr";
    return { theme, locale };
  } catch {
    return { theme: "dark", locale: "fr" };
  }
}

function apply(p: Prefs) {
  const html = document.documentElement;
  html.dataset.theme = p.theme;
  html.classList.toggle("dark", p.theme === "dark");
  html.lang = p.locale;
  html.dir = p.locale === "ar" ? "rtl" : "ltr";
}

function update(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(THEME_KEY, prefs.theme);
    localStorage.setItem(LOCALE_KEY, prefs.locale);
  } catch {
    /* stockage indisponible : la préférence vaut pour cette visite */
  }
  apply(prefs);
  listeners.forEach((l) => l(prefs));
}

export const setTheme = (theme: Theme) => update({ theme });
export const setLocale = (locale: Locale) => update({ locale });

/** Préférences courantes ; rendu serveur et premier rendu client en français sombre, puis préférence réelle. */
export function usePreferences(): Prefs {
  const [snapshot, setSnapshot] = useState<Prefs>(loaded ? prefs : { theme: "dark", locale: "fr" });
  useEffect(() => {
    if (!loaded) {
      prefs = read();
      loaded = true;
    }
    listeners.add(setSnapshot);
    setSnapshot(prefs);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}
