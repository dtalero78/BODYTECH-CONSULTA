/**
 * Pequeños wrappers de campos que combinan input/select/etc con useFieldAutoSave.
 * Mantienen el state local sincronizado y disparan el PATCH.
 */
import { useEffect, useState } from 'react';
import { Dropdown, type DropdownOption } from './Dropdown';
import { useFieldAutoSave } from './hooks/useFieldAutoSave';

interface CommonProps {
  historiaId: string | undefined;
  field: string;
  initialValue: unknown;
  onSaved: (field: string, value: unknown) => void;
  label?: string;
  required?: boolean;
}

export function TextField(
  props: CommonProps & {
    placeholder?: string;
    type?: 'text' | 'email' | 'tel' | 'date';
    error?: string;
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
        className={`w-full bg-[#2a3942] border text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none transition placeholder:text-[#6b7882] focus:bg-[#2c3b44] ${
          props.error ? 'border-[#ef4444]' : 'border-[#324049] focus:border-[#00a884]'
        }`}
      />
      {props.error && <span className="text-[11px] text-[#ef4444]">{props.error}</span>}
    </div>
  );
}

export function SelectField(
  props: CommonProps & {
    options: ReadonlyArray<DropdownOption>;
    placeholder?: string;
    searchable?: boolean;
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
        onChange={setV}
        placeholder={props.placeholder}
        searchable={props.searchable ?? false}
      />
    </div>
  );
}
