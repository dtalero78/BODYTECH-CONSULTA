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
/**
 * Coerción tri-estado de los booleanos de la historia. Devuelve `null` cuando el
 * campo nunca se respondió, para poder distinguirlo de un "No" explícito: son
 * cosas clínicamente distintas y antes se veían igual.
 *
 * Los positivos llegan como `true`, `'true'`, `'Sí'` o `'SI'` según la vía de
 * ingesta (ver CONDICIONES_ESPECIALES.md); los negativos, como `false`/`'false'`.
 */
function coerceBool(raw: unknown): boolean | null {
  if (raw === true) return true;
  if (raw === false) return false;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const v = raw.trim();
    if (v === '') return null;
    if (v === 'true' || v === 'Sí' || v === 'SI' || v === 'sí' || v === 'si') return true;
    return false;
  }
  if (typeof raw === 'number') return raw !== 0;
  return null;
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

  const isNumeric = props.type === 'number';

  // Mientras se teclea, un decimal a medias ("24." o sólo "-") no es un número
  // y el servidor lo rechazaría con 400. `enabled: false` evita el PATCH y deja
  // intacto lo último guardado hasta que el valor esté completo.
  const isCompleteNumber = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim());

  useFieldAutoSave({
    historiaId: props.historiaId,
    field: props.field,
    value: v.trim() === '' ? null : v.trim(),
    onSaved: props.onSaved,
    enabled: isNumeric ? v.trim() === '' || isCompleteNumber : true,
  });

  const rangeError: string | null = (() => {
    if (!isNumeric || v === '') return null;
    const num = Number(v.trim());
    if (isNaN(num)) return null;
    if (props.min !== undefined && num < props.min) return `Valor mínimo: ${props.min}`;
    if (props.max !== undefined && num > props.max) return `Valor máximo: ${props.max}`;
    return null;
  })();
  const displayError = props.error ?? rangeError;

  return (
    <div className="flex flex-col gap-1.5">
      {props.label && (
        <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[var(--p-danger)] ml-0.5">*</span>}
        </label>
      )}
      <input
        // Los numéricos se renderizan como `text` + `inputMode="decimal"`: con
        // `type="number"` el navegador considera "24," inválido y devuelve string
        // vacío en `e.target.value`, así que la coma se perdía de camino y el campo
        // se vaciaba solo. `inputMode` conserva el teclado numérico en móvil, y el
        // rango se sigue validando abajo en JS (min/max de HTML no aplican a text).
        type={isNumeric ? 'text' : (props.type ?? 'text')}
        inputMode={isNumeric ? 'decimal' : undefined}
        value={v}
        // La coma se normaliza a punto en el propio campo, al teclear: lo que se
        // ve es exactamente lo que se guarda, sin una coma en pantalla y un punto
        // en la base. El equipo médico escribe "24,5" y las columnas son `numeric`,
        // que sólo entiende el punto.
        onChange={(e) => setV(isNumeric ? e.target.value.replace(/,/g, '.') : e.target.value)}
        placeholder={props.placeholder}
        min={isNumeric ? undefined : props.min}
        max={isNumeric ? undefined : props.max}
        className={`w-full bg-[var(--p-input)] border text-[var(--p-text)] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[var(--p-text-3)] focus:bg-[var(--p-input-2)] ${
          displayError ? 'border-[var(--p-danger)]' : 'border-[var(--p-line)] focus:border-[var(--p-accent)]'
        }`}
      />
      {displayError && <span className="text-[11px] text-[var(--p-danger)]">{displayError}</span>}
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
        <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[var(--p-danger)] ml-0.5">*</span>}
        </label>
      )}
      <textarea
        rows={props.rows ?? 3}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={props.placeholder}
        style={props.minHeight ? { minHeight: props.minHeight } : undefined}
        className="w-full bg-[var(--p-input)] border border-[var(--p-line)] text-[var(--p-text)] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[var(--p-text-3)] focus:bg-[var(--p-input-2)] focus:border-[var(--p-accent)] resize-y"
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
  const [v, setV] = useState<boolean | null>(coerceBool(props.initialValue));

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
        <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[var(--p-danger)] ml-0.5">*</span>}
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
        <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[var(--p-danger)] ml-0.5">*</span>}
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
/**
 * Dígitos que admite la parte local del número, según el indicativo. Sólo se
 * limita donde la longitud es fija y conocida; para el resto no se restringe,
 * porque el panel del rol Médico usa indicativo variable y un tope global
 * cortaría números extranjeros válidos.
 */
const DIGITOS_POR_INDICATIVO: Record<string, number> = {
  '+57': 10, // Colombia: celular de 10 dígitos
};

export function PhoneField(
  props: CommonProps & {
    placeholder?: string;
    /** Código de marcación del país, ej. "+57". Vacío = sin prefijo. */
    dialCode?: string;
    /** Tope de dígitos; por defecto se deriva del indicativo. */
    maxDigits?: number;
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
  const maxDigits = props.maxDigits ?? DIGITOS_POR_INDICATIVO[dial];
  const digitos = (local.match(/\d/g) ?? []).length;
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
        <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">
          {props.label} {props.required && <span className="text-[var(--p-danger)] ml-0.5">*</span>}
        </label>
      )}
      <div className="flex items-stretch gap-2">
        {dial && (
          <span className="inline-flex items-center px-3 rounded-xl bg-[var(--p-surface-2)] border border-[var(--p-line)] text-[var(--p-text-2)] text-[13.5px] font-semibold select-none whitespace-nowrap">
            {dial}
          </span>
        )}
        <input
          type="tel"
          value={local}
          // Se recorta al escribir en vez de sólo avisar: el teléfono es el canal
          // por el que se contacta al paciente, y un número de 11 dígitos guardado
          // no sirve para nada. Se cuentan dígitos, no caracteres, para no romper
          // los espacios y guiones que la gente usa al separar.
          onChange={(e) => setLocal(recortarADigitos(e.target.value, maxDigits))}
          placeholder={props.placeholder}
          className="flex-1 min-w-0 bg-[var(--p-input)] border border-[var(--p-line)] text-[var(--p-text)] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[var(--p-text-3)] focus:bg-[var(--p-input-2)] focus:border-[var(--p-accent)]"
        />
      </div>
      {maxDigits !== undefined && digitos > 0 && digitos < maxDigits && (
        <span className="text-[11px] text-[var(--p-text-3)]">
          {digitos} de {maxDigits} dígitos
        </span>
      )}
    </div>
  );
}

/**
 * Recorta la entrada al tope de DÍGITOS indicado, conservando los separadores
 * (espacios, guiones) que la persona haya escrito hasta ese punto.
 */
function recortarADigitos(raw: string, max: number | undefined): string {
  if (max === undefined) return raw;
  let vistos = 0;
  let out = '';
  for (const ch of raw) {
    if (/\d/.test(ch)) {
      if (vistos >= max) break;
      vistos++;
    }
    out += ch;
  }
  return out;
}
