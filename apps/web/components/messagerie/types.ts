// ---------------------------------------------------------------------------
// Messagerie — types partagés par l'espace membre (/messages) et l'espace
// administration (/admin/messages). Une seule implémentation d'affichage.
// ---------------------------------------------------------------------------

export type Participant = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
};

export type ConversationLastMessage = {
  content: string;
  createdAt: string;
  senderId: string;
} | null;

export type ConversationSummary = {
  id: string;
  kind: string;
  peer?: Participant | null;
  participants?: Participant[];
  lastMessage: ConversationLastMessage;
  unread: number | boolean;
  updatedAt: string;
};

export type MessageItem = {
  id: string;
  content: string;
  senderId: string;
  senderName: string | null;
  isSystem: boolean;
  attachmentKey: string | null;
  createdAt: string;
  readAt: string | null;
};

export type MessagePage = {
  items: MessageItem[];
  nextBefore: string | null;
};

export const ROLE_LABELS: Record<string, string> = {
  CLIENT: "Client",
  VENDOR: "Vendeur",
  STAFF: "Équipe",
  ADMIN: "Admin",
};

export const CONVERSATION_KIND_LABELS: Record<string, string> = {
  CLIENT_TO_ADMIN: "Client ↔ Admin",
  VENDOR_TO_ADMIN: "Vendeur ↔ Admin",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABELS[role] ?? role;
}

export function kindLabel(kind: string): string {
  return CONVERSATION_KIND_LABELS[kind] ?? kind;
}

export function personName(person: Pick<Participant, "firstName" | "lastName"> | null | undefined): string {
  return [person?.firstName, person?.lastName].filter(Boolean).join(" ");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return (first.charAt(0) + (last ? last.charAt(0) : "")).toUpperCase();
}

/** Interlocuteur affiché : `peer` (liste membre) sinon participant non-moi. */
export function peerOf(
  conversation: ConversationSummary,
  currentUserId?: string | null,
): Participant | null {
  if (conversation.peer) return conversation.peer;
  const participants = conversation.participants ?? [];
  if (participants.length === 1) return participants[0] ?? null;
  if (!currentUserId) return participants[participants.length - 1] ?? null;
  return participants.find((p) => p.id !== currentUserId) ?? participants[participants.length - 1] ?? null;
}

export function unreadCount(unread: number | boolean | undefined | null): number {
  if (typeof unread === "number") return unread;
  return unread ? 1 : 0;
}

export function excerpt(content: string | null | undefined, max = 90): string {
  const text = (content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
