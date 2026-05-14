import { useCallback } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MedicalHistoryFull } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface UseMedicalHistoryResult {
  data: MedicalHistoryFull | null;
  loading: boolean;
  error: string | null;
  /** Aplica un cambio local optimistic (no dispara fetch). */
  patchLocal: (field: string, value: unknown) => void;
  /** Re-fetch desde el server. */
  refetch: () => Promise<void>;
}

/**
 * Carga la historia clínica vía TanStack Query.
 *
 * - `queryKey: ['medical-history', historiaId]` — clave estable por historia.
 * - `enabled: !!historiaId` — sin id, no se dispara fetch.
 * - `refetchInterval` dinámico — mientras `transcriptionStatus` esté en
 *   `pending` o `processing`, refetchea cada 30s; en cualquier otro estado
 *   (`done`, `error`, `null`) devuelve `false` y el polling para.
 * - `staleTime: 30_000` — amortigua refetches durante edición fluida.
 *
 * Mantiene la misma firma pública que la implementación anterior con
 * `useEffect + useState`, así que ningún consumidor necesita cambios.
 */
export function useMedicalHistory(historiaId: string | undefined): UseMedicalHistoryResult {
  const queryClient = useQueryClient();
  const queryKey = ['medical-history', historiaId] as const;

  const query = useQuery<MedicalHistoryFull, Error>({
    queryKey,
    queryFn: async () => {
      const res = await axios.get(`${API_BASE_URL}/api/video/medical-history/${historiaId}`);
      if (res.data?.success && res.data?.data) {
        return res.data.data as MedicalHistoryFull;
      }
      throw new Error(res.data?.error || 'Historia clínica no encontrada');
    },
    enabled: !!historiaId,
    staleTime: 30_000,
    // Phase 3 — polling del status de transcripción.
    // Mientras el pipeline esté en pending|processing, refetcheamos cada 30s.
    // En `done`/`error`/cualquier otro estado, devolvemos `false` para detener
    // el polling. Esto reemplaza el `setInterval` que vivía en
    // `MedicalConsultationPanel`.
    refetchInterval: (q) => {
      const s = q.state.data?.transcriptionStatus;
      return s === 'pending' || s === 'processing' ? 30_000 : false;
    },
  });

  const patchLocal = useCallback(
    (field: string, value: unknown) => {
      // El backend recibe snake_case (genero_biologico) pero el cache `data`
      // está en camelCase (generoBiologico) porque así lo devuelve el GET.
      // Convertir antes de mergear, sino la UI nunca refleja el cambio y el %
      // nunca avanza.
      //
      // Incluir `_<dígito>` además de `_<letra>` para que `bt_factor_1` → `btFactor1`,
      // que es como el GET ya lo devuelve (snakeToCamel del backend acepta digit).
      const camelField = field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      queryClient.setQueryData<MedicalHistoryFull | undefined>(queryKey, (prev) => {
        if (!prev) return prev;
        return { ...prev, [camelField]: value as never };
      });
    },
    // queryKey es estable mientras historiaId no cambie; dependemos de historiaId
    // para que cambie cuando se navega entre historias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, historiaId]
  );

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    data: query.data ?? null,
    // isLoading es true sólo en el primer fetch (no en refetches periódicos),
    // que coincide con el comportamiento del `loading` anterior. NO usar
    // isFetching, que sería true durante el polling de transcripción y
    // causaría parpadeos en la UI.
    loading: query.isLoading,
    error: query.error ? query.error.message : null,
    patchLocal,
    refetch,
  };
}
