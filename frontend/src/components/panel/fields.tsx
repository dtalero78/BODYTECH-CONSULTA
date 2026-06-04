/**
 * Pequeños wrappers de campos que combinan input/select/etc con useFieldAutoSave.
 * Mantienen el state local sincronizado y disparan el PATCH.
 */
import { useEffect, useState } from 'react';
import { Dropdown, type DropdownOption } from './Dropdown';
import { PillToggle } from './PillToggle';
import { useFieldAutoSave } from './hooks/useFieldAutoSave';

interface CommonProps {
  historiaId: string | undefined;
  field: string;
  initialValue: unknown;
  onSaved: (field: string, value: unknown) => void;
  label?: string;
  required?: boolean;
}

/**
 * Helper para coerce de cualquier raw a boolean — alineado con la coerción del backend.
 * `'true' | true | 'Sí' | 'SI' | 'sí' | 'si' | 1` → true; cualquier otra cosa (incl. null) → false.
 */
function coerceBool(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === 'string') {
    const v = raw.trim();
    return v === 'true' || v === 'Sí' || v === 'SI' || v === 'sí' || v === 'si';
  }
  if (typeof raw === 'number') return raw !== 0;
  return false;
}

export function TextField(
  props: CommonProps & {
    placeholder?: string;
    type?: 'text' | 'email' | 'tel' | 'date' | 'number';
    error?: string;
    min?: number;
    max?: number;
  }
) {
  const initial = props.initialValue == null ? '' : String(props.initialValue);
  const [v, setV] = useState<string>(initial);

  // Re-sync si cambia desde fuera (refetch)
  useEffect(() => {
    setV(props.initialValue == null ? '' : String(props.initialValue));
  }, [props.initialValue]);

  useFieldAutoSave({
    historiaId: props.historiaId,
    field: props.field,
    value: v === '' ? null : v,
    onSaved: props.onSaved,
  });

  const rangeError: string | null = (() => {
    if (props.type !== 'number' || v === '') return null;
    const num = Number(v);
    if (isNaN(num)) return null;
    if (props.min !== undefined && num < props.min) return `Valor mínimo: ${props.min}`;
    if (props.max !== undefined && num > props.max) return `Valor máximo: ${props.max}`;
    return null;
  })();
  const displayError = props.error ?? rangeError;

  return (
    <div className="flex flex-col gap-1.5">
      {props.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[#ef4444] ml-0.5">*</span>}
        </label>
      )}
      <input
        type={props.type ?? 'text'}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={props.placeholder}
        min={props.min}
        max={props.max}
        className={`w-full bg-[#2a3942] border text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[#6b7882] focus:bg-[#2c3b44] ${
          displayError ? 'border-[#ef4444]' : 'border-[#324049] focus:border-[#00a884]'
        }`}
      />
      {displayError && <span className="text-[11px] text-[#ef4444]">{displayError}</span>}
    </div>
  );
}

/**
 * Textarea con auto-save (mismo patrón que TextField).
 */
export function TextareaField(
  props: CommonProps & {
    placeholder?: string;
    rows?: number;
    minHeight?: number;
  }
) {
  const initial = props.initialValue == null ? '' : String(props.initialValue);
  const [v, setV] = useState<string>(initial);

  useEffect(() => {
    setV(props.initialValue == null ? '' : String(props.initialValue));
  }, [props.initialValue]);

  useFieldAutoSave({
    historiaId: props.historiaId,
    field: props.field,
    value: v === '' ? null : v,
    onSaved: props.onSaved,
  });

  return (
    <div className="flex flex-col gap-1.5">
      {props.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[#ef4444] ml-0.5">*</span>}
        </label>
      )}
      <textarea
        rows={props.rows ?? 3}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={props.placeholder}
        style={props.minHeight ? { minHeight: props.minHeight } : undefined}
        className="w-full bg-[#2a3942] border border-[#324049] text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[#6b7882] focus:bg-[#2c3b44] focus:border-[#00a884] resize-y"
      />
    </div>
  );
}

interface PillToggleFieldProps extends CommonProps {
  trueLabel?: string;
  falseLabel?: string;
  /** Render compacto sin label arriba (útil dentro de filas con header). */
  inline?: boolean;
}

/**
 * Toggle binario "Sí / No" con autosave.
 * El backend acepta `boolean` directamente; el frontend persiste boolean (no string).
 */
export function PillToggleField(props: PillToggleFieldProps) {
  const [v, setV] = useState<boolean>(coerceBool(props.initialValue));

  useEffect(() => {
    setV(coerceBool(props.initialValue));
  }, [props.initialValue]);

  useFieldAutoSave({
    historiaId: props.historiaId,
    field: props.field,
    value: v,
    onSaved: props.onSaved,
  });

  if (props.inline) {
    return (
      <PillToggle value={v} onChange={setV} trueLabel={props.trueLabel} falseLabel={props.falseLabel} />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {props.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[#ef4444] ml-0.5">*</span>}
        </label>
      )}
      <PillToggle value={v} onChange={setV} trueLabel={props.trueLabel} falseLabel={props.falseLabel} />
    </div>
  );
}

export function SelectField(
  props: CommonProps & {
    options: ReadonlyArray<DropdownOption>;
    placeholder?: string;
    searchable?: boolean;
    /** Callback al cambiar el valor localmente (además del auto-save). */
    onChange?: (value: string) => void;
  }
) {
  const initial = props.initialValue == null ? '' : String(props.initialValue);
  const [v, setV] = useState<string>(initial);

  useEffect(() => {
    setV(props.initialValue == null ? '' : String(props.initialValue));
  }, [props.initialValue]);

  useFieldAutoSave({
    historiaId: props.historiaId,
    field: props.field,
    value: v === '' ? null : v,
    onSaved: props.onSaved,
  });

  return (
    <div className="flex flex-col gap-1.5">
      {props.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[#ef4444] ml-0.5">*</span>}
        </label>
      )}
      <Dropdown
        value={v}
        options={props.options}
        onChange={(val) => {
          setV(val);
          props.onChange?.(val);
        }}
        placeholder={props.placeholder}
        searchable={props.searchable ?? false}
      />
    </div>
  );
}

/**
 * Campo de teléfono con prefijo de país fijo (no editable) a la izquierda.
 *
 * El valor almacenado combina `dialCode` + número local (ej. "+57 3001234567").
 * `dialCode` se deriva del país seleccionado por el componente padre; al cambiar,
 * el valor se re-guarda con el nuevo prefijo. Si `dialCode` está vacío (país
 * "Otro" o sin país), se guarda solo el número local.
 */
export function PhoneField(
  props: CommonProps & {
    placeholder?: string;
    /** Código de marcación del país, ej. "+57". Vacío = sin prefijo. */
    dialCode?: string;
  }
) {
  // Quita cualquier prefijo de marcación inicial (+<dígitos>) del valor guardado
  // para mostrar solo la parte local en el input.
  const stripDial = (raw: unknown): string => {
    if (raw == null) return '';
    return String(raw).replace(/^\s*\+\d{1,4}\s*/, '').trim();
  };

  const [local, setLocal] = useState<string>(stripDial(props.initialValue));

  useEffect(() => {
    setLocal(stripDial(props.initialValue));
  }, [props.initialValue]);

  const dial = props.dialCode ?? '';
  const trimmed = local.trim();
  const combined = trimmed === '' ? null : dial ? `${dial} ${trimmed}` : trimmed;

  useFieldAutoSave({
    historiaId: props.historiaId,
    field: props.field,
    value: combined,
    onSaved: props.onSaved,
  });

  return (
    <div className="flex flex-col gap-1.5">
      {props.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[#ef4444] ml-0.5">*</span>}
        </label>
      )}
      <div className="flex items-stretch gap-2">
        {dial && (
          <span className="inline-flex items-center px-3 rounded-xl bg-[#1a2530] border border-[#324049] text-[#a4b1b9] text-[13.5px] font-semibold select-none whitespace-nowrap">
            {dial}
          </span>
        )}
        <input
          type="tel"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder={props.placeholder}
          className="flex-1 min-w-0 bg-[#2a3942] border border-[#324049] text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[#6b7882] focus:bg-[#2c3b44] focus:border-[#00a884]"
        />
      </div>
    </div>
  );
}
