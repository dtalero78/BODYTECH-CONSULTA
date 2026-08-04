import { useEffect, useState } from 'react';
import { useFieldAutoSave } from '../hooks/useFieldAutoSave';

interface TemplateTextareaFieldProps {
  historiaId: string | undefined;
  field: string;
  initialValue: unknown;
  onSaved: (field: string, value: unknown) => void;
  label?: string;
  placeholder?: string;
  rows?: number;
  /** Texto boilerplate que precarga el textarea al hacer click en "Usar plantilla". */
  template: string;
}

/**
 * Textarea con auto-save (mismo patrón que TextareaField de fields.tsx) + botón
 * "Usar plantilla" para precargar el texto boilerplate del examen ocupacional
 * (el médico luego edita los espacios en blanco).
 */
export function TemplateTextareaField(props: TemplateTextareaFieldProps) {
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
      <div className="flex items-center justify-between gap-2">
        {props.label && (
          <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
            {props.label}
          </label>
        )}
        <button
          type="button"
          onClick={() => setV(props.template)}
          className="text-[11px] font-semibold text-[#00a884] hover:text-[#00c99a] transition whitespace-nowrap"
        >
          Usar plantilla
        </button>
      </div>
      <textarea
        rows={props.rows ?? 4}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={props.placeholder}
        className="w-full bg-[#2a3942] border border-[#324049] text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[#6b7882] focus:bg-[#2c3b44] focus:border-[#00a884] resize-y"
      />
    </div>
  );
}
