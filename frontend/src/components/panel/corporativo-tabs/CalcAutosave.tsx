import { useFieldAutoSave } from '../hooks/useFieldAutoSave';

interface CalcAutosaveProps {
  historiaId: string | undefined;
  field: string;
  value: number | string | null;
  serverValue?: unknown;
  onPatchLocal: (field: string, value: unknown) => void;
}

/**
 * Persiste un campo calculado vía auto-save sin renderizar nada (mismo patrón
 * que el `CalcAutosave` local de ExamenFisicoTab/RiesgoTab del panel estándar).
 *
 * Si el calculado es null (faltan insumos) NO emite PATCH: preserva el valor
 * que ya haya en la base. Cuando los insumos vuelven a ser válidos, `enabled`
 * pasa a true y el debounce normal de useAutoSave lo persiste.
 */
export function CalcAutosave({
  historiaId,
  field,
  value,
  serverValue,
  onPatchLocal,
}: CalcAutosaveProps) {
  const hasValue = value !== null && value !== undefined;
  useFieldAutoSave({
    historiaId,
    field,
    value,
    serverValue,
    onSaved: onPatchLocal,
    enabled: hasValue,
  });
  return null;
}
