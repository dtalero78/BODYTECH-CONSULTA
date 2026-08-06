import { Construction } from 'lucide-react';

interface PlaceholderTabProps {
  title: string;
  description?: string;
}

/**
 * Placeholder visual de tabs Phase 2/3 — visualmente coherente con el design system.
 */
export function PlaceholderTab({ title, description }: PlaceholderTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="bg-[var(--p-surface)] border border-[var(--p-line)] rounded-[18px] p-6 flex items-start gap-4">
        <div className="w-[48px] h-[48px] rounded-[12px] bg-[rgba(var(--p-warn-rgb),0.12)] text-[var(--p-warn)] grid place-items-center flex-shrink-0">
          <Construction size={22} />
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-bold text-[var(--p-text)] mb-1">{title}</div>
          <p className="text-[13px] text-[var(--p-text-2)]">
            {description ?? 'Esta sección se implementará en Phase 2.'}
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(var(--p-warn-rgb),0.10)] border border-[rgba(var(--p-warn-rgb),0.28)] text-[10.5px] font-bold text-[var(--p-warn)] uppercase tracking-wider">
            Phase 2
          </div>
        </div>
      </div>
    </div>
  );
}
