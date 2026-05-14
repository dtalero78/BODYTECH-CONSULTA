import { useEffect } from 'react';
import { useAutoSave } from './useAutoSave';
import { useSaveCtx } from '../SaveContext';

interface UseFieldAutoSaveOptions {
  historiaId: string | undefined;
  field: string;
  value: unknown;
  delay?: number;
  onSaved?: (field: string, value: unknown) => void;
  serverValue?: unknown;
  /**
   * Si false, NO se dispara PATCH (útil para CalcAutosave cuando los inputs
   * están incompletos — preserva lo que ya hay en el servidor).
   */
  enabled?: boolean;
}

/**
 * Wrapper de useAutoSave que reporta su estado al SaveContext del orchestrator.
 */
export function useFieldAutoSave({ historiaId, field, value, delay, onSaved, serverValue, enabled }: UseFieldAutoSaveOptions) {
  const status = useAutoSave({ historiaId, field, value, delay, onSaved, serverValue, enabled });
  const { report, registerRetry } = useSaveCtx();

  useEffect(() => {
    report(field, {
      saving: status.saving,
      lastSavedAt: status.lastSavedAt,
      error: status.error,
    });
  }, [report, field, status.saving, status.lastSavedAt, status.error]);

  useEffect(() => {
    registerRetry(field, status.retry);
  }, [registerRetry, field, status.retry]);

  return status;
}
