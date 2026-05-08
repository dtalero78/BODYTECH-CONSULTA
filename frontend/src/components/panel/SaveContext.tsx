import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SaveStatus } from './types';

interface SaveContextValue {
  /** Reporta el estado de auto-save de un campo. Llamar en cada cambio de status. */
  report: (field: string, status: SaveStatus) => void;
  /** Estado agregado de todos los campos. */
  aggregate: SaveStatus;
  /** Última función `retry` registrada por algún campo en error. */
  registerRetry: (field: string, retry: () => void) => void;
  retryAll: () => void;
}

const SaveCtx = createContext<SaveContextValue | null>(null);

export function SaveProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<Record<string, SaveStatus>>({});
  const retryMap = useRef<Record<string, () => void>>({});

  const report = useCallback((field: string, status: SaveStatus) => {
    setStatusMap((prev) => {
      const cur = prev[field];
      if (
        cur &&
        cur.saving === status.saving &&
        cur.lastSavedAt?.getTime() === status.lastSavedAt?.getTime() &&
        cur.error === status.error
      ) {
        return prev;
      }
      return { ...prev, [field]: status };
    });
  }, []);

  const registerRetry = useCallback((field: string, retry: () => void) => {
    retryMap.current[field] = retry;
  }, []);

  const aggregate = useMemo<SaveStatus>(() => {
    const all = Object.values(statusMap);
    if (all.length === 0) {
      return { saving: false, lastSavedAt: null, error: null };
    }
    const saving = all.some((s) => s.saving);
    const errored = all.find((s) => s.error);
    const lastSavedAt = all
      .map((s) => s.lastSavedAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      saving,
      lastSavedAt,
      error: errored?.error ?? null,
    };
  }, [statusMap]);

  const retryAll = useCallback(() => {
    Object.entries(statusMap).forEach(([field, st]) => {
      if (st.error && retryMap.current[field]) {
        retryMap.current[field]();
      }
    });
  }, [statusMap]);

  return (
    <SaveCtx.Provider value={{ report, aggregate, registerRetry, retryAll }}>{children}</SaveCtx.Provider>
  );
}

export function useSaveCtx(): SaveContextValue {
  const v = useContext(SaveCtx);
  if (!v) throw new Error('useSaveCtx fuera del SaveProvider');
  return v;
}
