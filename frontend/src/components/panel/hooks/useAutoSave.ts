import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  /**
   * Para campos calculados: valor actual en DB. Cuando se provee, las refs de
   * "valor inicial" se anclan a este valor en vez del valor computado, de modo
   * que si el valor calculado difiere del DB en el primer render se dispara
   * PATCH inmediatamente (con debounce normal).
   */
  serverValue?: unknown;
}

interface PatchVars {
  historiaId: string;
  field: string;
  value: unknown;
}

/**
 * Auto-save por field. Debounce 800ms (configurable). Reintenta una vez con
 * backoff de 1s antes de marcar error (vía `useMutation` con
 * `retry: 1`, `retryDelay: 1000`).
 *
 * En el primer render NO dispara — solo cuando `value` cambia respecto al
 * valor "anclado" en el primer render.
 *
 * Bajo el capó usa `useMutation` para el envío, pero conserva todas las refs
 * y guards anti-PATCH-redundante del diseño original. El cleanup de unmount
 * sigue usando `axios.patch` directo (fire-and-forget) porque al desmontar
 * el componente la mutación se cancela.
 */
export function useAutoSave({
  historiaId,
  field,
  value,
  delay = 800,
  onSaved,
  enabled = true,
  serverValue,
}: UseAutoSaveOptions): SaveStatus & { retry: () => void } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>({
    saving: false,
    lastSavedAt: null,
    error: null,
  });

  // Para campos calculados que ya tienen un valor en el primer render: anclar
  // las refs al valor del servidor (serverValue) para que, si el calculado
  // difiere del DB, se dispare PATCH en el primer render (no se omita).
  const anchor = serverValue !== undefined ? serverValue : value;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialValueRef = useRef<unknown>(anchor);
  const lastSentValueRef = useRef<unknown>(anchor);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // Para campos calculados (CalcAutosave) mantener el último serverValue
  // observado. Si el `value` local coincide con ese serverValue (dentro de
  // tolerancia de float), suprimimos el PATCH — evita reescribir 23.4=23.4 o
  // disparar saves redundantes en cada re-render del padre.
  const serverValueRef = useRef<unknown>(serverValue);
  useEffect(() => {
    serverValueRef.current = serverValue;
  }, [serverValue]);

  function valuesEquivalent(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) {
      return (a == null) && (b == null);
    }
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return Math.abs(a - b) < 0.01; // Tolerancia IMC / floats
    }
    // Comparar number/string que representan el mismo valor (ej. server devuelve
    // "23.4" string, calc devuelve 23.4 number).
    if (
      (typeof a === 'number' && typeof b === 'string') ||
      (typeof a === 'string' && typeof b === 'number')
    ) {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        return Math.abs(na - nb) < 0.01;
      }
    }
    return false;
  }

  // Refs sincronizadas con la última versión de los valores — necesarias
  // para que el cleanup de unmount tenga acceso a los valores actuales sin
  // capturarlos por closure obsoleta.
  const valueRef = useRef<unknown>(value);
  const historiaIdRef = useRef<string | undefined>(historiaId);
  const enabledRef = useRef<boolean>(enabled);
  const fieldRef = useRef<string>(field);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    historiaIdRef.current = historiaId;
  }, [historiaId]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    fieldRef.current = field;
  }, [field]);

  // Mutación encargada del PATCH. retry: 1 + retryDelay: 1000 reemplaza el
  // reintento manual con backoff de 1s del diseño original.
  const mutation = useMutation<unknown, Error, PatchVars>({
    mutationFn: async ({ historiaId: hid, field: f, value: v }) => {
      const res = await axios.patch(
        `${API_BASE_URL}/api/video/medical-history/${hid}/field`,
        { field: f, value: v }
      );
      if (!res.data?.success) {
        throw new Error(res.data?.error || 'SAVE_FAILED');
      }
      return res.data;
    },
    retry: 1,
    retryDelay: 1000,
    onMutate: () => {
      setStatus((s) => ({ ...s, saving: true, error: null }));
    },
    onSuccess: (_data, vars) => {
      setStatus({
        saving: false,
        lastSavedAt: new Date(),
        error: null,
      });
      onSavedRef.current?.(vars.field, vars.value);
      // Marcar como stale sin refetch inmediato — patchLocal ya actualizó el
      // cache local. El GET se dispara sólo cuando el componente se remonte o
      // el usuario navegue de vuelta, no en cada keystroke.
      queryClient.invalidateQueries({
        queryKey: ['medical-history', vars.historiaId],
        refetchType: 'none',
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'SAVE_FAILED';
      setStatus({
        saving: false,
        lastSavedAt: null,
        error: msg,
      });
    },
  });

  // `mutation.mutate` cambia de identidad en cada render → guardarlo en ref
  // para que `send` (y los efectos que dependen de él) no se re-creen
  // innecesariamente.
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const send = useCallback(
    (val: unknown): void => {
      if (!historiaId) return;
      mutateRef.current({ historiaId, field, value: val });
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
    // Para CalcAutosave (serverValue presente): si el valor calculado ya coincide
    // con lo que hay en DB (con tolerancia float), no emitir PATCH redundante.
    if (
      serverValueRef.current !== undefined &&
      valuesEquivalent(value, serverValueRef.current)
    ) {
      // Anclar el lastSent para que un re-render no vuelva a programar el timer.
      lastSentValueRef.current = value;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSentValueRef.current = value;
      send(value);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay, enabled, historiaId, send]);

  const retry = useCallback(() => {
    send(value);
  }, [send, value]);

  // Fix bug "click Guardado antes del debounce aborta PATCH":
  // al desmontar el componente (modal cerrado por click "Guardado", "Cancelar",
  // X, Esc, click fuera o cambio de tab), si hay un timer pendiente con un
  // valor distinto al último enviado, hacemos flush fire-and-forget. Esto
  // garantiza que ningún cambio reciente del médico se pierda por timing.
  //
  // Importante: el flush usa axios.patch directo, NO la mutación, porque al
  // desmontar React Query cancela mutaciones en vuelo y el componente ya no
  // existe para reportar status. El cache se actualiza vía onSavedRef cuando
  // resuelve el patch (el patchLocal del orchestrator hace setQueryData).
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const v = valueRef.current;
        const hid = historiaIdRef.current;
        if (
          enabledRef.current &&
          hid &&
          v !== lastSentValueRef.current &&
          v !== initialValueRef.current
        ) {
          // Fire-and-forget: el componente ya está desmontado, no esperamos
          // setStatus ni feedback visual. Solo persistencia + actualizar cache
          // del orquestador (patchLocal) para que el modal muestre el valor
          // correcto si se reabre en la misma sesión.
          lastSentValueRef.current = v;
          const savedField = fieldRef.current;
          axios
            .patch(`${API_BASE_URL}/api/video/medical-history/${hid}/field`, {
              field: savedField,
              value: v,
            })
            .then((res) => {
              if (res.data?.success) {
                onSavedRef.current?.(savedField, v);
              }
            })
            .catch(() => {
              // Silenciar errores: el usuario ya cerró el modal y no podemos
              // mostrar feedback. El próximo GET reflejará la falta de save
              // si ocurrió.
            });
        }
      }
    };
  }, []); // SOLO en unmount — los refs garantizan acceso a valores actuales

  return { ...status, retry };
}
