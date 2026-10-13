import type { ExchangeStatus, Prisma } from "@misterdou/db";

// Une offre est « tenue » par un échange dès que le client a accepté le
// complément et confié son compte : elle quitte la boutique et ne peut plus
// être achetée ni modifiée, jusqu'à la fin (ou l'échec) de l'échange.
export const HOLD_STATUSES = ["ACCEPTED", "AWAITING_PAYMENT"] as const satisfies readonly ExchangeStatus[];

// Demandes encore en cours (réponse ou accord attendus, ou offre tenue).
export const OPEN_STATUSES = ["PENDING", "QUOTED", ...HOLD_STATUSES] as const satisfies readonly ExchangeStatus[];

/** Filtre : offre qui n'est pas tenue par un échange en cours. */
export function notHeldByExchange(): Prisma.ProductWhereInput {
  return { exchanges: { none: { status: { in: [...HOLD_STATUSES] } } } };
}
