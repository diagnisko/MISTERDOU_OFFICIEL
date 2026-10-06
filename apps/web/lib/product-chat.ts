import { request } from "./api";

// Discussions à propos d'un compte en vente (client ↔ côté vente).

export type ThreadSummary = {
  id: string;
  product: { id: string; title: string; slug: string; imageUrl: string | null; available: boolean };
  /** Interlocuteur : le vendeur (côté client), le client (côté vente) ou MISTERDOU. */
  counterpart: string;
  counterpartKind: "seller" | "client" | "platform";
  counterpartAvatarUrl: string | null;
  /** Administrateur qui suit une discussion de vendeur : pas de saisie. */
  readOnly: boolean;
  /** Pour l'équipe : vendeur du compte (null = MISTERDOU). */
  sellerName: string | null;
  lastMessage: { preview: string; fromClient: boolean; createdAt: string } | null;
  unread: number;
  lastMessageAt: string;
};

export type ThreadMessage = { id: string; content: string; createdAt: string; mine: boolean; ownSide: boolean; author: string };

export type ThreadDetail = ThreadSummary & { side: "client" | "seller" | "team" | "observer"; messages: ThreadMessage[] };

export const fetchMyThreads = () => request<ThreadSummary[]>("/api/v1/threads/mine");

export const fetchInbox = () => request<{ side: "seller" | "team"; items: ThreadSummary[] }>("/api/v1/threads/inbox");

export const fetchThread = (id: string) => request<ThreadDetail>(`/api/v1/threads/${id}`);

export const fetchProductThread = (productId: string) => request<ThreadDetail | null>(`/api/v1/products/${productId}/thread`);

export const writeToSeller = (productId: string, content: string) =>
  request<{ threadId: string }>(`/api/v1/products/${productId}/thread`, { method: "POST", body: JSON.stringify({ content }) });

export const replyInThread = (threadId: string, content: string) =>
  request<{ messageId: string }>(`/api/v1/threads/${threadId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
