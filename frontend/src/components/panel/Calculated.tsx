import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

interface CalculatedProps {
  label: string;
  value: ReactNode;
  unit?: string;
}

/**
 * Campo readonly con candado — para valores derivados (anteriores, IMC calculado, etc.).
 */
export function Calculated({ label, value, unit }: CalculatedProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">{label}</label>
      <div className="w-full bg-[var(--p-surface-2)] border border-[var(--p-line)] text-[var(--p-text-2)] px-3.5 py-2.5 rounded-xl text-[13.5px] flex items-center justify-between">
        <span>
          {value}
          {unit && <span className="text-[var(--p-text-3)] text-[11px] ml-1.5">{unit}</span>}
        </span>
        <Lock size={12} className="text-[var(--p-text-3)]" />
      </div>
    </div>
  );
}
