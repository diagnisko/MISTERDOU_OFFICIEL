// Réservé aux composants serveur (next/headers).
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, makeT, type T } from "./i18n-core";
import { LOCALE_KEY } from "./preferences-boot";

/** Traduction côté serveur : langue lue dans le cookie posé par Paramètres. */
export async function getServerT(): Promise<T> {
  const value = (await cookies()).get(LOCALE_KEY)?.value;
  return makeT(isLocale(value) ? value : DEFAULT_LOCALE);
}
