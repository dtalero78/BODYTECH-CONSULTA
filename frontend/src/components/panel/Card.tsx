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
      ? 'bg-[#34d399] shadow-[0_0_0_3px_rgba(52,211,153,0.16)]'
      : state === 'partial'
        ? 'bg-[#00a884] shadow-[0_0_0_3px_rgba(0,168,132,0.16)]'
        : 'bg-[#6b7882] shadow-[0_0_0_3px_rgba(107,120,130,0.16)]';
  const subCls =
    state === 'empty' ? 'text-[#6b7882] italic' : 'text-[#a4b1b9]';

  return (
    <div
      className={`bg-[#1f2c34] border border-[#324049] rounded-[18px] p-5 relative transition hover:border-[#3b4a54] ${
        span2 ? 'col-span-1 md:col-span-2' : ''
      }`}
    >
      <div className="flex items-center gap-2.5 mb-3.5">
        <div className="w-[34px] h-[34px] rounded-[10px] bg-[rgba(0,168,132,0.12)] text-[#00a884] grid place-items-center flex-shrink-0">
          {icon}
        </div>
        <div className="text-[14px] font-bold flex-1 text-[#e9edef]">{title}</div>
        <div className={`w-2 h-2 rounded-full ${dotCls}`} />
      </div>
      <div className={`text-[12px] flex items-center gap-1.5 flex-wrap ${subCls}`}>{subtitle}</div>
      {children}
      {!hideFooter && (
        <div className="mt-3.5 flex items-center justify-between pt-3.5 border-t border-dashed border-[#324049]">
          <div className="flex items-center gap-2.5 flex-1">
            {typeof completionPct === 'number' && (
              <>
                <span className="text-[11px] font-bold text-[#a4b1b9] tracking-wider font-mono">
                  {completionPct}%
                </span>
                <div className="flex-1 h-[5px] rounded-[3px] bg-[#2a3942] overflow-hidden">
                  <div
                    className="h-full bg-[#00a884] rounded-[3px] transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </>
            )}
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="ml-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold bg-[#00a884] text-[#001b14] hover:bg-[#008f6f] transition shadow-[0_4px_14px_rgba(0,168,132,0.25)]"
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
