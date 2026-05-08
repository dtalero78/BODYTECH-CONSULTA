import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { SaveStatus } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface UseAutoSaveOptions {
  historiaId: string | undefined;
  /** Nombre del campo (snake_case o camelCase legacy). */
  field: string;
  /** Valor actual (puede ser cualquier primitivo). */
  value: unknown;
  /** Debounce en ms. Default 800. */
  delay?: number;
  /** Callback al guardar correctamente — útil para que el orchestrator actualice cache. */
  onSaved?: (field: string, value: unknown) => void;
  /** Si está deshabilitado, no dispara save (útil para skip al primer mount). */
  enabled?: boolean;
}

/**
 * Auto-save por field. Debounce 800ms (configurable). Reintenta una vez con
 * backoff de 1s antes de marcar error.
 *
 * En el primer render NO dispara — solo cuando `value` cambia respecto al
 * valor "anclado" en el primer render.
 */
export function useAutoSave({
  historiaId,
  field,
  value,
  delay = 800,
  onSaved,
  enabled = true,
}: UseAutoSaveOptions): SaveStatus & { retry: () => void } {
  const [status, setStatus] = useState<SaveStatus>({
    saving: false,
    lastSavedAt: null,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialValueRef = useRef<unknown>(value);
  const lastSentValueRef = useRef<unknown>(value);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const send = useCallback(
    async (val: unknown, attempt = 1): Promise<void> => {
      if (!historiaId) return;
      setStatus((s) => ({ ...s, saving: true, error: null }));
      try {
        const res = await axios.patch(`${API_BASE_URL}/api/video/medical-history/${historiaId}/field`, {
          field,
          value: val,
        });
        if (res.data?.success) {
          setStatus({
            saving: false,
            lastSavedAt: new Date(),
            error: null,
          });
          onSavedRef.current?.(field, val);
        } else {
          throw new Error(res.data?.error || 'SAVE_FAILED');
        }
      } catch (e: unknown) {
        if (attempt < 2) {
          // Reintento con backoff de 1s
          await new Promise((r) => setTimeout(r, 1000));
          await send(val, attempt + 1);
          return;
        }
        const msg = e instanceof Error ? e.message : 'SAVE_FAILED';
        setStatus({
          saving: false,
          lastSavedAt: null,
          error: msg,
        });
      }
    },
    [historiaId, field]
  );

  useEffect(() => {
    if (!enabled) return;
    if (!historiaId) return;
    // Skip si es el valor inicial (primer render).
    if (value === initialValueRef.current && lastSentValueRef.current === initialValueRef.current) {
      return;
    }
    // Si no cambió desde el último envío, no reenviar.
    if (value === lastSentValueRef.current) {
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSentValueRef.current = value;
      void send(value);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay, enabled, historiaId, send]);

  const retry = useCallback(() => {
    void send(value);
  }, [send, value]);

  return { ...status, retry };
}
