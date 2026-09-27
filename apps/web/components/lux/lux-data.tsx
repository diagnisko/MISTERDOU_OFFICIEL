"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchLuxSeed, invalidateLuxSeed, type LuxSeed } from "@/lib/lux";
import { cx } from "./lux-utils";

type LuxStatus = "loading" | "ready" | "error";

interface LuxContextValue {
  seed: LuxSeed | null;
  status: LuxStatus;
  error: string | null;
  latency: number | null;
  retry: () => void;
}

const LuxContext = createContext<LuxContextValue>({
  seed: null,
  status: "loading",
  error: null,
  latency: null,
  retry: () => undefined,
});

// Provider unique : une seule requête /api/seed pour toute la landing (TTL 30 s).
export function LuxProvider({ children }: { children: ReactNode }) {
  const [seed, setSeed] = useState<LuxSeed | null>(null);
  const [status, setStatus] = useState<LuxStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const t0 = useRef<number | null>(null);

  const load = useCallback((force = false) => {
    setStatus("loading");
    setError(null);
    if (t0.current === null) t0.current = performance.now();
    fetchLuxSeed(force)
      .then((d) => {
        setSeed(d);
        setStatus("ready");
        setLatency(Math.round(performance.now() - (t0.current ?? performance.now())));
      })
      .catch((e: unknown) => {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(() => {
    invalidateLuxSeed();
    load(true);
  }, [load]);

  return (
    <LuxContext.Provider value={{ seed, status, error, latency, retry }}>
      {children}
    </LuxContext.Provider>
  );
}

export function useLux() {
  return useContext(LuxContext);
}

// LED de latence apparente (capture de performance). Visible uniquement via ?perf=1.
export function LuxPerfLed() {
  const { latency, status } = useLux();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf"));
  }, []);

  if (!enabled) return null;
  return (
    <div
      className="fixed bottom-4 left-4 z-[70] flex items-center gap-2 rounded-full border border-[rgba(232,71,36,0.35)] bg-[#050303]/90 px-3 py-1.5 font-mono text-[11px] text-stone-200 shadow-lg backdrop-blur"
      role="status"
      aria-label="Latence apparente"
    >
      <span
        className={cx(
          "h-2 w-2 rounded-full",
          status === "ready" ? "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" : status === "loading" ? "bg-amber-400" : "bg-red-500",
        )}
      />
      <span>p·{latency !== null ? `${latency} ms` : "…"}</span>
    </div>
  );
}