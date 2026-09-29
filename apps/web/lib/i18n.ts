"use client";

import { useMemo } from "react";
import { usePreferences } from "./preferences";
import { makeT } from "./i18n-core";

export { INTL_LOCALE, translate, type MessageKey, type T } from "./i18n-core";

/** `t("clé", { variable })` dans la langue choisie (français par défaut). */
export function useT() {
  const { locale } = usePreferences();
  return useMemo(() => makeT(locale), [locale]);
}
