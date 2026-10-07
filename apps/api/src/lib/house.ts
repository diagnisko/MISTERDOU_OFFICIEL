import { prisma } from "@misterdou/db";
import { publicUrl } from "./media.js";

// ---------------------------------------------------------------------------
// Photo de la boutique officielle MISTERDOU : celle que l'administrateur a mise
// sur son profil (le plus ancien administrateur actif qui en a une). Affichée
// sur les offres maison, la page de la boutique et les discussions. Sans
// photo : le monogramme « M. ».
// ---------------------------------------------------------------------------

const CACHE_MS = 60_000;
let cached: { at: number; url: string | null } | null = null;

export async function houseAvatarUrl(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.url;
  const admin = await prisma.user.findFirst({
    where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, avatarKey: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { avatarKey: true },
  });
  const url = admin?.avatarKey ? publicUrl(admin.avatarKey) : null;
  cached = { at: Date.now(), url };
  return url;
}

/** Après un changement de photo d'un administrateur : visible tout de suite. */
export function forgetHouseAvatar(): void {
  cached = null;
}
