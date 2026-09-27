"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Sondage récurrent « onglet visible uniquement ».
// • le timer reste calé sur `intervalMs` mais n’interroge l’API que si la page
//   est visible ;
// • au retour au premier plan, le rappel est déclenché immédiatement ;
// • tout est nettoyé au démontage et quand `enabled` repasse à false.
// Le rappel doit gérer ses erreurs ; renvoyer `false` arrête le sondage.
// ---------------------------------------------------------------------------

export interface VisiblePollOptions {
  /** Sondage actif (défaut : true). */
  enabled?: boolean;
  /** Premier appel immédiat au montage (défaut : false). */
  immediate?: boolean;
}

export function useVisiblePoll(
  callback: () => void | false | Promise<void | false>,
  intervalMs: number,
  { enabled = true, immediate = false }: VisiblePollOptions = {},
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };

    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      if (!stopped) timer = setTimeout(run, delay);
    };

    async function run() {
      if (stopped) return;
      if (document.hidden) {
        schedule(intervalMs);
        return;
      }
      const keep = await callbackRef.current();
      if (keep === false || stopped) {
        stop();
        return;
      }
      schedule(intervalMs);
    }

    if (immediate) void run();
    else schedule(intervalMs);

    const onVisibility = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, immediate]);
}
