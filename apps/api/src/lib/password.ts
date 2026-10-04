import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// KDF : scrypt (node:crypto) — aucune dépendance native, robuste contre le
// GPU-based cracking. Le format est auto-descriptif (params N/r/p stockés dans le hash),
// ce qui permet une migration future sans réinitialiser les mots de passe.
// (argon2id était visé en doc -> @node-rs/argon2 est instable sur Node ≥25 : verify → Decoding failed.)
const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
) => Promise<Buffer>;

const KEYLEN = 64;
const DEFAULT_COST = { N: 16384, r: 8, p: 1 };

export type ScryptParams = { N: number; r: number; p: number };

export function hashPassword(password: string): Promise<string> {
  return hashPasswordWith(password, DEFAULT_COST);
}

export async function hashPasswordWith(
  password: string,
  params: ScryptParams,
): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, params);
  return `$scrypt$N=${params.N},r=${params.r},p=${params.p}$n=${salt.toString(
    "base64url",
  )}$h=${derived.toString("base64url")}`;
}

// Comptes repris de l'ancien site (Supabase Auth) : empreintes bcrypt ($2a$/$2b$/$2y$).
// Acceptées à la connexion, puis remplacées par scrypt (voir needsRehash).
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(stored: string | null | undefined): boolean {
  return typeof stored === "string" && BCRYPT_RE.test(stored);
}

/** L'empreinte n'est pas au format scrypt courant : à refaire après une connexion réussie. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`$scrypt$N=${DEFAULT_COST.N},r=${DEFAULT_COST.r},p=${DEFAULT_COST.p}$`);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (BCRYPT_RE.test(stored)) {
      const { default: bcrypt } = await import("bcryptjs");
      return await bcrypt.compare(password, stored);
    }
    const match =
      /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$n=([A-Za-z0-9_-]+)\$h=([A-Za-z0-9_-]+)$/.exec(
        stored,
      );
    if (!match) return false;
    const params = { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
    const salt = match[4] as string;
    const expected = Buffer.from(match[5] as string, "base64url");
    const derived = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, params);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}