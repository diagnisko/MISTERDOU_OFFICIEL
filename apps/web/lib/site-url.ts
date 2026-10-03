import { headers } from "next/headers";

/**
 * Adresse publique du site (sans « / » final) : NEXT_PUBLIC_SITE_URL si elle
 * est réglée, sinon l'adresse par laquelle le visiteur est arrivé.
 */
export async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
