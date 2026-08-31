interface PillToggleProps {
  /** `null` = sin responder: ningún lado queda marcado. */
  value: boolean | null;
  onChange: (next: boolean) => void;
  trueLabel?: string;
  falseLabel?: string;
}

/**
 * Toggle "Sí / No" con estética segmented y TRES estados: sí, no y sin responder.
 *
 * El tercer estado no es un lujo: antes el componente era `value: boolean`, así
 * que un antecedente que nadie había respondido renderizaba "No" como si fuera
 * una respuesta explícita. El médico no podía distinguir "no pregunté" de
 * "el paciente dijo que no", la historia tampoco, y los contadores de
 * completitud no tenían forma de saber qué faltaba por diligenciar.
 */
export function PillToggle({ value, onChange, trueLabel = 'Sí', falseLabel = 'No' }: PillToggleProps) {
  const base = 'px-4 py-1.5 rounded-lg text-xs transition';
  const selected = 'bg-[var(--p-accent)] text-[var(--p-on-accent)] font-bold';
  const idle = 'text-[var(--p-text-2)] font-semibold hover:text-[var(--p-text)]';

  return (
    <div
      className={`inline-flex bg-[var(--p-input)] rounded-[10px] p-[3px] border ${
        value === null ? 'border-dashed border-[var(--p-line-2)]' : 'border-[var(--p-line)]'
      }`}
      role="radiogroup"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === true}
        onClick={() => onChange(true)}
        className={`${base} ${value === true ? selected : idle}`}
      >
        {trueLabel}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === false}
        onClick={() => onChange(false)}
        className={`${base} ${value === false ? selected : idle}`}
      >
        {falseLabel}
      </button>
    </div>
  );
}
