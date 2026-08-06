import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import type { CardState } from './types';

interface CardProps {
  icon: ReactNode;
  title: string;
  /** Texto de subtítulo dinámico (preview por estado) */
  subtitle: ReactNode;
  state: CardState;
  /** Porcentaje de completitud opcional para la barra. */
  completionPct?: number;
  span2?: boolean;
  onEdit?: () => void;
  /** Botón principal del card. Default: Pencil */
  actionLabel?: string;
  /** Si actions es undefined, no se renderiza el footer. */
  hideFooter?: boolean;
  children?: ReactNode;
}

/**
 * Card reusable con ícono + título + subtítulo + dot de estado + botón de edición.
 */
export function Card({
  icon,
  title,
  subtitle,
  state,
  completionPct,
  span2 = false,
  onEdit,
  actionLabel,
  hideFooter = false,
  children,
}: CardProps) {
  const dotCls =
    state === 'complete'
      ? 'bg-[var(--p-ok)] shadow-[0_0_0_3px_rgba(var(--p-ok-rgb),0.16)]'
      : state === 'partial'
        ? 'bg-[var(--p-accent)] shadow-[0_0_0_3px_rgba(var(--p-accent-rgb),0.16)]'
        : 'bg-[var(--p-text-3)] shadow-[0_0_0_3px_rgba(var(--p-text-3-rgb),0.16)]';
  const subCls =
    state === 'empty' ? 'text-[var(--p-text-3)] italic' : 'text-[var(--p-text-2)]';

  return (
    <div
      onClick={onEdit}
      className={`bg-[var(--p-surface)] border border-[var(--p-line)] rounded-[18px] p-5 relative transition hover:border-[var(--p-line-2)] ${
        onEdit ? 'cursor-pointer' : ''
      } ${span2 ? 'col-span-1 md:col-span-2' : ''}`}
    >
      <div className="flex items-center gap-2.5 mb-3.5">
        <div className="w-[34px] h-[34px] rounded-[10px] bg-[rgba(var(--p-accent-rgb),0.12)] text-[var(--p-accent)] grid place-items-center flex-shrink-0">
          {icon}
        </div>
        <div className="text-[14px] font-bold flex-1 text-[var(--p-text)]">{title}</div>
        <div className={`w-2 h-2 rounded-full ${dotCls}`} />
      </div>
      <div className={`text-[12px] flex items-center gap-1.5 flex-wrap ${subCls}`}>{subtitle}</div>
      {children}
      {!hideFooter && (
        <div className="mt-3.5 flex items-center justify-between pt-3.5 border-t border-dashed border-[var(--p-line)]">
          <div className="flex items-center gap-2.5 flex-1">
            {typeof completionPct === 'number' && (
              <>
                <span className="text-[11px] font-bold text-[var(--p-text-2)] tracking-wider font-mono">
                  {completionPct}%
                </span>
                <div className="flex-1 h-[5px] rounded-[3px] bg-[var(--p-input)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--p-accent)] rounded-[3px] transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </>
            )}
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="ml-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:bg-[var(--p-accent-hover)] transition shadow-[0_4px_14px_rgba(var(--p-accent-rgb),0.25)]"
            >
              <Pencil size={13} />
              {actionLabel ?? 'Editar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
