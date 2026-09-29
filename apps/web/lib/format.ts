// Formatage de date/heure dans la langue d’affichage (français par défaut) — utilisé par les écrans
// notifications, support et messagerie.
import { documentIntl } from "./i18n-core";

/** Date longue : « 12 septembre 2026 ». */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(documentIntl(), { day: "numeric", month: "long", year: "numeric" });
}

/** Date + heure courte : « 12 sept. 2026 14:05 ». */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(documentIntl(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
