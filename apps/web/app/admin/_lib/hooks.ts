"use client";

import { useCallback, useEffect, useState } from "react";
import { requestPaged, type PageMeta } from "./api";

// ---------------------------------------------------------------------------
// Liste paginée type de l'espace administration : chargement, état vide,
// erreurs (dont 403 → alerte « Permission insuffisante ») et message de succès.
// Le rechargement se déclenche à chaque changement d'URL de requête.
// ---------------------------------------------------------------------------

export interface AdminList<T> {
  items: T[];
  meta: PageMeta;
  /** Meta brut de la dernière réponse (compteurs propres à certaines listes). */
  extra: Record<string, unknown>;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  notice: string | null;
  setError: (err: unknown) => void;
  setNotice: (notice: string | null) => void;
  /** Recharge la liste ; renvoie false si la requête a échoué. */
  refresh: (successMessage?: string) => Promise<boolean>;
}

/** path null : rien à charger (ex. module non attribué à ce manager). */
export function useAdminList<T>(path: string | null): AdminList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, perPage: 25, total: 0 });
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (path === null) return [];
    const result = await requestPaged<T>(path);
    setItems(result.items);
    setMeta(result.meta);
    setExtra(result.extra);
    setError(null);
    return result.items;
  }, [path]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice(null);
    load()
      .catch((err) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(
    async (successMessage?: string) => {
      setRefreshing(true);
      try {
        await load();
        if (successMessage) setNotice(successMessage);
        return true;
      } catch (err) {
        setError(err);
        return false;
      } finally {
        setRefreshing(false);
      }
    },
    [load],
  );

  return { items, meta, extra, loading, refreshing, error, notice, setError, setNotice, refresh };
}
