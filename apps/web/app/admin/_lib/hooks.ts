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
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  notice: string | null;
  setError: (err: unknown) => void;
  setNotice: (notice: string | null) => void;
  /** Recharge la liste ; renvoie false si la requête a échoué. */
  refresh: (successMessage?: string) => Promise<boolean>;
}

export function useAdminList<T>(path: string): AdminList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, perPage: 25, total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await requestPaged<T>(path);
    setItems(result.items);
    setMeta(result.meta);
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

  return { items, meta, loading, refreshing, error, notice, setError, setNotice, refresh };
}
