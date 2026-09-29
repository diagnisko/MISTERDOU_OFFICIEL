"use client";

import { useEffect, useState } from "react";
import { ApiClientError, request } from "./api";

// Compte connecté, partagé par l'en-tête (menu profil) et les pages de compte :
// une seule requête /auth/me, puis mise à jour de tous les abonnés.

export type AccountUser = {
  id: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  kycStatus: string;
  twoFactorEnabled: boolean;
  createdAt: string;
};

export type AccountProfile = {
  avatarUrl: string | null;
  hasPassword: boolean;
  googleLinked: boolean;
  country: string | null;
  city: string | null;
  isSeller: boolean;
  sellerStatus: string | null;
};

export type AccountState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "member"; user: AccountUser; profile: AccountProfile };

let state: AccountState = { status: "loading" };
let inflight: Promise<void> | null = null;
const listeners = new Set<(s: AccountState) => void>();

function emit(next: AccountState) {
  state = next;
  listeners.forEach((l) => l(state));
}

const RETRY_DELAYS_MS = [800, 2000, 4000];

function isSessionMissing(err: unknown) {
  return err instanceof ApiClientError && (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN");
}

async function fetchAccount(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request<{ user: AccountUser; profile: AccountProfile }>("/api/v1/auth/me");
      emit({ status: "member", user: res.user, profile: res.profile });
      return;
    } catch (err) {
      // Seule une session absente déconnecte. Une coupure passagère (base qui
      // se réveille, réseau) est réessayée : on ne renvoie pas vers /login un
      // membre dont la session est toujours valide.
      if (isSessionMissing(err)) return emit({ status: "guest" });
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        if (state.status === "loading") emit({ status: "guest" });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function refreshAccount(): Promise<void> {
  inflight ??= fetchAccount().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function useAccount(): AccountState {
  const [snapshot, setSnapshot] = useState<AccountState>(state);
  useEffect(() => {
    listeners.add(setSnapshot);
    if (state.status === "loading" && !inflight) void refreshAccount();
    setSnapshot(state);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}

export async function logoutAccount() {
  try {
    await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } finally {
    emit({ status: "guest" });
  }
}

export function displayName(user: AccountUser) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Membre";
}

export function initials(user: AccountUser) {
  const base = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "?";
  return (
    base
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}
