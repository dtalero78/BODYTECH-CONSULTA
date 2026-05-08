import type { TabId } from './types';

export interface TabDef {
  id: TabId;
  label: string;
  /** Cantidad de campos diligenciados */
  filled: number;
  /** Total esperado */
  total: number;
  /** Si true, dot warning (incompleto crítico) */
  warn?: boolean;
}

interface TabsProps {
  active: TabId;
  onChange: (id: TabId) => void;
  tabs: TabDef[];
}

/**
 * 7 tabs con contador X/Y embebido + dot de status.
 */
export function Tabs({ active, onChange, tabs }: TabsProps) {
  return (
    <nav className="flex items-center gap-0.5 mt-4 mx-5 border-b border-[#324049] overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}>
      {tabs.map((t, idx) => {
        const isActive = t.id === active;
        const dotEmpty = t.filled === 0;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`flex-shrink-0 px-3.5 py-2.5 flex items-center gap-2 text-[13px] font-medium whitespace-nowrap rounded-t-lg border-b-2 -mb-px transition ${
              isActive
                ? 'text-[#e9edef] font-bold border-[#00a884] bg-[rgba(0,168,132,0.04)]'
                : 'text-[#a4b1b9] border-transparent hover:text-[#e9edef] hover:bg-white/[0.02]'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[10px] font-bold ${
                isActive ? 'bg-[#00a884] text-[#001b14]' : 'bg-[#2a3942] text-[#a4b1b9]'
              }`}
            >
              {idx + 1}
            </span>
            {t.label}
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-[rgba(0,168,132,0.12)] text-[#00a884]' : 'bg-[#1f2c34] text-[#6b7882]'
              }`}
            >
              {t.filled}/{t.total}
            </span>
            {t.warn ? (
              <span className="w-1.5 h-1.5 rounded-full bg-[#fbbf24] shadow-[0_0_0_2px_rgba(251,191,36,0.15)]" />
            ) : dotEmpty ? (
              <span className="w-1.5 h-1.5 rounded-full bg-[#6b7882]" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] shadow-[0_0_0_2px_rgba(52,211,153,0.15)]" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
