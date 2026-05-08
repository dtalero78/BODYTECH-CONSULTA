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
}

/**
 * Wrapper de useAutoSave que reporta su estado al SaveContext del orchestrator.
 */
export function useFieldAutoSave({ historiaId, field, value, delay, onSaved, serverValue }: UseFieldAutoSaveOptions) {
  const status = useAutoSave({ historiaId, field, value, delay, onSaved, serverValue });
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
