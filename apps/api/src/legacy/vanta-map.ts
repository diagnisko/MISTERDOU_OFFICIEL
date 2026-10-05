// ---------------------------------------------------------------------------
// Ancien site « Vanta » (Next.js + Prisma) → formes du nouveau site.
// Fonctions pures : aucune lecture ni écriture, testées une à une.
// ---------------------------------------------------------------------------

/** +221XXXXXXXXX pour un numéro sénégalais (avec ou sans indicatif), sinon +<chiffres> si l'indicatif est fourni. */
export function normalizePhone(raw: string | null | undefined): { phoneNumber: string; countryCode: string | null } | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s.\-()]/g, "");
  const hasPlus = compact.startsWith("+") || compact.startsWith("00");
  const digits = compact.replace(/^\+|^00/, "");
  if (!/^\d+$/.test(digits)) return null;
  if (/^[37]\d{8}$/.test(digits)) return { phoneNumber: `+221${digits}`, countryCode: "+221" };
  if (/^221[37]\d{8}$/.test(digits)) return { phoneNumber: `+${digits}`, countryCode: "+221" };
  if (hasPlus && digits.length >= 8 && digits.length <= 15) return { phoneNumber: `+${digits}`, countryCode: null };
  return null;
}

export function normalizeCountry(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^s[ée]n[ée]gal$/i.test(value)) return "Sénégal";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Caractéristiques du compte eFootball (Product.features de l'ancien site). */
export function parseFeatures(features: unknown): { division: string; teamPower: number; coins: number; platform: string | null } {
  const f = (features && typeof features === "object" && !Array.isArray(features) ? features : {}) as Record<string, unknown>;
  const int = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[\s,.]/g, "")) : NaN;
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  };
  const rawDivision = f.division;
  const division =
    typeof rawDivision === "number"
      ? `Division ${rawDivision}`
      : typeof rawDivision === "string" && rawDivision.trim()
        ? /^\d+$/.test(rawDivision.trim())
          ? `Division ${rawDivision.trim()}`
          : rawDivision.trim()
        : "Division 1";
  const platform = typeof f.platform === "string" && f.platform.trim() ? f.platform.trim() : null;
  return { division, teamPower: int(f.ovr), coins: int(f.coins), platform };
}

/** « E-mail : … / Mot de passe : … » (AccessInformation.content). */
export function parseCredentials(content: string | null | undefined): { email: string; password: string } | null {
  if (!content) return null;
  const email = content.match(/e-?mail\s*:\s*(\S+)/i)?.[1]?.trim();
  const password = content.match(/mot\s+de\s+passe\s*:\s*(.+)$/im)?.[1]?.trim();
  return email && password ? { email, password } : null;
}

/**
 * Montants entiers d'un échéancier : chaque mensualité est arrondie au franc,
 * la dernière absorbe l'écart pour que la somme tombe juste sur `total`.
 */
export function splitAmounts(amounts: number[], total: number): number[] {
  const rounded = amounts.map((a) => Math.round(a));
  if (rounded.length === 0) return rounded;
  const diff = total - rounded.reduce((s, a) => s + a, 0);
  rounded[rounded.length - 1]! += diff;
  return rounded;
}

export type VantaDoc = { documentType: string; side: string; fileUrl: string; uploadedAt: Date };

export type KycSelection =
  | { ok: true; type: "NATIONAL_ID" | "PASSPORT"; front: VantaDoc; back: VantaDoc | null; selfie: VantaDoc }
  | { ok: false; reason: string };

/** Pièces retenues pour un client vérifié : la plus récente de chaque type et face. */
export function chooseKycDocs(docs: VantaDoc[]): KycSelection {
  const latest = new Map<string, VantaDoc>();
  for (const d of docs) {
    const key = `${d.documentType}/${d.side}`;
    const prev = latest.get(key);
    if (!prev || d.uploadedAt > prev.uploadedAt) latest.set(key, d);
  }
  const selfie = latest.get("FACE_PHOTO/SINGLE");
  if (!selfie) return { ok: false, reason: "photo du visage manquante" };
  const idFront = latest.get("NATIONAL_ID/FRONT");
  const idBack = latest.get("NATIONAL_ID/BACK");
  if (idFront && idBack) return { ok: true, type: "NATIONAL_ID", front: idFront, back: idBack, selfie };
  const passport = latest.get("PASSPORT/FRONT") ?? latest.get("PASSPORT/SINGLE");
  if (passport) return { ok: true, type: "PASSPORT", front: passport, back: null, selfie };
  const otherFront = latest.get("OTHER/FRONT");
  const otherBack = latest.get("OTHER/BACK");
  if (otherFront && otherBack) return { ok: true, type: "NATIONAL_ID", front: otherFront, back: otherBack, selfie };
  return { ok: false, reason: "pièce d'identité incomplète (recto/verso)" };
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export function mimeFromKey(key: string): string | null {
  const ext = key.split("?")[0]!.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

/** Identifiant court et stable pour un numéro de commande lisible (MD-AAAA-XXXXXXX). */
export function orderNumberFor(legacyPurchaseId: string, createdAt: Date): string {
  const digits = parseInt(legacyPurchaseId.replace(/[^0-9a-f]/gi, "").slice(0, 8), 16) % 10_000_000;
  return `MD-${createdAt.getFullYear()}-${String(digits).padStart(7, "0")}`;
}
