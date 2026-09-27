import { request, requestPaged, type PageMeta } from "@/lib/api";
import type { ConversationSummary, MessageItem, MessagePage } from "./types";

// ---------------------------------------------------------------------------
// Accès API de la messagerie (mêmes endpoints pour le membre et l'admin).
// GET /conversations[/:id][/messages], POST /conversations[/:id]/messages.
// ---------------------------------------------------------------------------

export const MESSAGES_PAGE_SIZE = 50;

export function fetchConversations(params: {
  page?: number;
  perPage?: number;
}): Promise<{ items: ConversationSummary[]; meta: PageMeta }> {
  const search = new URLSearchParams();
  search.set("page", String(params.page ?? 1));
  search.set("perPage", String(params.perPage ?? 20));
  return requestPaged<ConversationSummary>(`/api/v1/conversations?${search.toString()}`);
}

export function fetchConversation(id: string): Promise<ConversationSummary> {
  return request<ConversationSummary>(`/api/v1/conversations/${id}`);
}

export function fetchMessages(
  id: string,
  params: { before?: string | null; limit?: number } = {},
): Promise<MessagePage> {
  const search = new URLSearchParams();
  search.set("limit", String(params.limit ?? MESSAGES_PAGE_SIZE));
  if (params.before) search.set("before", params.before);
  return request<MessagePage>(`/api/v1/conversations/${id}/messages?${search.toString()}`);
}

export function sendConversationMessage(id: string, content: string): Promise<MessageItem> {
  return request<MessageItem>(`/api/v1/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

/** Ouvre (ou réutilise) la conversation avec le support. */
export function createConversation(kind: "CLIENT_TO_ADMIN" | "VENDOR_TO_ADMIN"): Promise<ConversationSummary> {
  return request<ConversationSummary>("/api/v1/conversations", {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

/** Fusionne deux pages de messages par identifiant, tri chronologique. */
export function mergeMessages(previous: MessageItem[], incoming: MessageItem[]): MessageItem[] {
  const byId = new Map<string, MessageItem>();
  for (const message of previous) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
