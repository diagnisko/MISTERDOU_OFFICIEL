import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@misterdou/shared";
import { LuxHome } from "@/components/lux/lux-home";
import { serverApiFetch } from "@/lib/server-api";

// Rôle du membre connecté, ou null. Seule une session confirmée par l'API
// compte : un cookie périmé laisse voir la page d'accueil normalement.
async function memberRole(): Promise<string | null> {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE_NAME)) return null;
  try {
    const res = await serverApiFetch("/api/v1/auth/me", {
      headers: { cookie: jar.toString() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { user?: { role?: string } } };
    return body.data?.user?.role ?? null;
  } catch {
    return null;
  }
}

// La page d'accueil (présentation, « Créer mon compte ») est pour les visiteurs :
// un membre connecté (client, vendeur ou équipe) arrive directement sur les offres.
export default async function Home() {
  const role = await memberRole();
  if (role) redirect("/offres");
  return <LuxHome />;
}
