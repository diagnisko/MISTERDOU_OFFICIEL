// Normalisation téléphone → E.164 local (simple : indicatif + chiffres)
export function normalizePhone(countryCode: string, phoneNumber: string): string {
  const digits = (phoneNumber + "").replace(/\D/g, "");
  const cc = (countryCode + "").replace(/\D/g, "");
  return "+" + cc + digits;
}

export function stripNonDigits(input: string): string {
  return (input + "").replace(/\D/g, "");
}