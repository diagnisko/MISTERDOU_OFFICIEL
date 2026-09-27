import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function createTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function decodeBase32(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/g, "")) {
    const digit = BASE32_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("Secret TOTP invalide");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpAt(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, submittedCode: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(submittedCode)) return false;
  const counter = Math.floor(now / 30_000);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(totpAt(secret, counter + offset));
    const received = Buffer.from(submittedCode);
    if (expected.length === received.length && timingSafeEqual(expected, received)) return true;
  }
  return false;
}

export function totpProvisioningUri(email: string, secret: string): string {
  const label = encodeURIComponent(`MISTERDOU:${email}`);
  const params = new URLSearchParams({ secret, issuer: "MISTERDOU", algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
