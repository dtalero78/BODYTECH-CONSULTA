import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
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
 * Carga la historia clínica una vez al montar.
 * Mantiene un cache local que se actualiza por `patchLocal` cuando un campo
 * se guardó exitosamente vía PATCH.
 */
export function useMedicalHistory(historiaId: string | undefined): UseMedicalHistoryResult {
  const [data, setData] = useState<MedicalHistoryFull | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!historiaId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/video/medical-history/${historiaId}`);
      if (res.data?.success && res.data?.data) {
        setData(res.data.data as MedicalHistoryFull);
      } else {
        setError(res.data?.error || 'Historia clínica no encontrada');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al cargar historia clínica';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [historiaId]);

  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const patchLocal = useCallback((field: string, value: unknown) => {
    // El backend recibe snake_case (genero_biologico) pero el cache `data`
    // está en camelCase (generoBiologico) porque así lo devuelve el GET.
    // Convertir antes de mergear, sino la UI nunca refleja el cambio y el %
    // nunca avanza.
    const camelField = field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, [camelField]: value as never };
    });
  }, []);

  return {
    data,
    loading,
    error,
    patchLocal,
    refetch: fetchOnce,
  };
}
