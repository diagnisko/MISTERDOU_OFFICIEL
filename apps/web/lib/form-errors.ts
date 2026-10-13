"use client";

import { useCallback, useState } from "react";
import { ApiClientError, errorMessage, fieldErrors } from "./api";

// ---------------------------------------------------------------------------
// Erreurs d'un formulaire : chaque erreur s'affiche sous le champ concerné
// (contour rouge), et disparaît dès qu'on corrige ce champ. Le message général
// ne sert qu'aux erreurs sans champ (connexion perdue, action refusée…).
// Les champs portent un attribut `name` égal à la clé (« basePrice »,
// « credentials.loginId ») : le premier champ en erreur reçoit le focus.
// ---------------------------------------------------------------------------

export function useFormErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);

  const focusFirst = useCallback((keys: string[]) => {
    if (typeof document === "undefined" || keys.length === 0) return;
    requestAnimationFrame(() => {
      const target = keys
        .map((key) => document.querySelector<HTMLElement>(`[name="${CSS.escape(key)}"]`))
        .find((el): el is HTMLElement => el !== null);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus({ preventScroll: true });
    });
  }, []);

  /** Erreurs trouvées avant l'envoi (contrôle dans le navigateur). */
  const show = useCallback(
    (next: Record<string, string>) => {
      setFields(next);
      setGeneral(null);
      focusFirst(Object.keys(next));
    },
    [focusFirst],
  );

  /**
   * Erreur renvoyée par le serveur : sous les champs si elle en vise, sinon en
   * message général. `byCode` rattache un code d'erreur à un champ
   * (ex. { EMAIL_ALREADY_REGISTERED: "email" }).
   */
  const fromError = useCallback(
    (err: unknown, fallback?: string, byCode: Record<string, string> = {}) => {
      const byField = fieldErrors(err);
      if (err instanceof ApiClientError && byCode[err.code] && Object.keys(byField).length === 0) {
        byField[byCode[err.code]!] = errorMessage(err);
      }
      if (Object.keys(byField).length > 0) {
        setFields(byField);
        setGeneral(null);
        focusFirst(Object.keys(byField));
      } else {
        setFields({});
        setGeneral(errorMessage(err, fallback));
      }
    },
    [focusFirst],
  );

  /** Le champ a été modifié : son erreur disparaît. */
  const clear = useCallback((key: string) => {
    setFields((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFields({});
    setGeneral(null);
  }, []);

  return { fields, general, show, fromError, clear, reset, hasErrors: Object.keys(fields).length > 0 };
}
