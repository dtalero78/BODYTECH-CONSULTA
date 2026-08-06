interface PillToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  trueLabel?: string;
  falseLabel?: string;
}

/**
 * Toggle binario "Sí / No" con estética segmented.
 */
export function PillToggle({ value, onChange, trueLabel = 'Sí', falseLabel = 'No' }: PillToggleProps) {
  return (
    <div className="inline-flex bg-[var(--p-input)] rounded-[10px] p-[3px] border border-[var(--p-line)]">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-4 py-1.5 rounded-lg text-xs transition ${
          value ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)] font-bold' : 'text-[var(--p-text-2)] font-semibold'
        }`}
      >
        {trueLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-4 py-1.5 rounded-lg text-xs transition ${
          !value ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)] font-bold' : 'text-[var(--p-text-2)] font-semibold'
        }`}
      >
        {falseLabel}
      </button>
    </div>
  );
}
