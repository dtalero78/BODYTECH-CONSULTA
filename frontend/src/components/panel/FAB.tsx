import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface FABProps {
  isMaxed: boolean;
  /** Permite controlar el toggle externamente (ej. para atajo `N`). */
  externalOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Ancho del sidebar de secciones. Maximizado el FAB se va a la izquierda
   * (la derecha la ocupa el thumbnail flotante del video), así que hay que
   * correrlo para que no quede encima del sidebar.
   */
  navWidth?: number;
}

/**
 * Floating Action Button con composer de nota rápida.
 * `position: absolute` dentro del panel.
 */
export function FAB({ isMaxed, externalOpen, onOpenChange, navWidth = 0 }: FABProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  // Sync interno cuando cambia el externo
  useEffect(() => {
    if (externalOpen !== undefined) setInternalOpen(externalOpen);
  }, [externalOpen]);

  const positionCls = isMaxed ? 'items-start' : 'right-6 items-end';
  const transformOrigin = isMaxed ? 'bottom left' : 'bottom right';

  return (
    <div
      className={`absolute bottom-6 z-40 flex flex-col gap-2.5 ${positionCls}`}
      style={isMaxed ? { left: navWidth + 24 } : undefined}
    >
      {open && (
        <div
          className="w-[340px] bg-[var(--p-surface)] border border-[var(--p-line-2)] rounded-2xl shadow-2xl p-3.5"
          style={{
            transformOrigin,
            animation: 'panelFabIn 220ms cubic-bezier(.2,.9,.3,1.2)',
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[12px] font-bold tracking-wider text-[var(--p-accent)] uppercase">Nota rápida</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[var(--p-text-2)] hover:text-[var(--p-text)] p-1"
              aria-label="Cerrar nota"
            >
              <X size={14} />
            </button>
          </div>
          <textarea
            placeholder="Anota algo rápido sin salir de la consulta..."
            className="w-full min-h-[90px] bg-[var(--p-input)] border border-[var(--p-line)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--p-text)] outline-none resize-y focus:border-[var(--p-accent)]"
          />
          <div className="flex justify-between items-center mt-2.5">
            <div className="flex gap-1.5">
              <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[var(--p-input)] text-[var(--p-text-2)] font-semibold">borrador</span>
            </div>
            <button
              type="button"
              className="text-[11px] font-semibold text-[var(--p-accent)] hover:text-[var(--p-accent-hover)] transition"
            >
              Adjuntar a consulta
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-[52px] h-[52px] rounded-full bg-[var(--p-accent)] text-[var(--p-on-accent)] grid place-items-center shadow-[0_14px_32px_rgba(var(--p-accent-rgb),0.45)] hover:bg-[var(--p-accent-hover)] hover:-translate-y-0.5 transition"
        aria-label={open ? 'Cerrar nota' : 'Nueva nota'}
        title="Nueva nota (N)"
      >
        {open ? <X size={22} /> : <Plus size={22} />}
      </button>
    </div>
  );
}
