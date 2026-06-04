import { useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Persiste un campo de la historia clínica de forma imperativa (fuera del flujo
 * de auto-save por field). Actualiza primero el cache local (optimistic) y luego
 * dispara el PATCH al backend.
 *
 * Útil para:
 *  - Valores por defecto que deben guardarse aunque el médico no toque el campo
 *    (ej. "Urbana", "Sin discapacidad").
 *  - Campos derivados/autollenados a partir de otro campo (ej. entidad territorial
 *    a partir del municipio).
 */
export function usePersistField(
  historiaId: string | undefined,
  onPatchLocal: (field: string, value: unknown) => void
) {
  return useCallback(
    (field: string, value: unknown) => {
      onPatchLocal(field, value);
      if (!historiaId) return;
      axios
        .patch(`${API_BASE_URL}/api/video/medical-history/${historiaId}/field`, {
          field,
          value,
        })
        .catch(() => {
          // Silencioso: el próximo GET reflejará si no se persistió.
        });
    },
    [historiaId, onPatchLocal]
  );
}
