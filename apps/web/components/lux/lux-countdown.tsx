"use client";

import { useEffect, useState } from "react";
import { IconSparkle } from "./lux-icons";
import { useT } from "@/lib/i18n";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Compte à rebours réel, alimenté par endsAt d'une ligne promotion de la BDD.
export function LuxCountdown({ endsAtIso, className = "" }: { endsAtIso: string; className?: string }) {
  const t = useT();
  const now = useNow();
  const ends = Date.parse(endsAtIso);
  const diff = Math.max(0, ends - now);
  if (diff <= 0) return null;

  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000) % 24;
  const minutes = Math.floor(diff / 60_000) % 60;
  const seconds = Math.floor(diff / 1000) % 60;

  const label =
    days > 0
      ? `${t("countdown.days", { days })} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return (
    <span className={`lux-glass-chip text-[11px] text-[var(--lux-gold-light)] ${className}`} role="status" aria-label={t("countdown.ends", { time: label })}>
      <IconSparkle className="h-3.5 w-3.5 text-[var(--lux-gold)]" />
      <span className="sr-only">{t("countdown.limited")}</span>
      <span className="tabular-nums">{label}</span>
    </span>
  );
}