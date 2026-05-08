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
    <div className="inline-flex bg-[#2a3942] rounded-[10px] p-[3px] border border-[#324049]">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-4 py-1.5 rounded-lg text-xs transition ${
          value ? 'bg-[#00a884] text-[#001b14] font-bold' : 'text-[#a4b1b9] font-semibold'
        }`}
      >
        {trueLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-4 py-1.5 rounded-lg text-xs transition ${
          !value ? 'bg-[#00a884] text-[#001b14] font-bold' : 'text-[#a4b1b9] font-semibold'
        }`}
      >
        {falseLabel}
      </button>
    </div>
  );
}
