import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { EyeOnPatientPill } from './EyeOnPatientPill';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Sección/breadcrumb encima del título. */
  crumb?: string;
  /** Título principal. */
  title: string;
  /** Ícono Lucide del header (38x38). */
  icon?: ReactNode;
  /** Texto del footer izquierdo (ej. "Auto-guardado activo"). */
  footerHint?: string;
  /** Si está en panel maximizado, el pill es amarillo. */
  isMaxed: boolean;
  children: ReactNode;
  /** Callback opcional al click en "Guardar" — sólo cierra por defecto. */
  onSave?: () => void;
}

/**
 * Modal interno al panel. NO es fixed al viewport — su `position: absolute`
 * vive dentro del contenedor `.panel-shell` (que es relative).
 *
 * Animación scaleY 200ms ease-out al abrir.
 */
export function Modal({ open, onClose, crumb, title, icon, footerHint, isMaxed, children, onSave }: ModalProps) {
  // Esc para cerrar
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto"
      style={{
        background: 'rgba(11,20,26,0.82)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative bg-[#1f2c34] border border-[#3b4a54] rounded-[20px] w-full max-w-3xl shadow-2xl flex flex-col my-auto"
        style={{
          maxHeight: 'calc(100% - 8px)',
          animation: 'panelScaleY 200ms ease-out',
          transformOrigin: 'top center',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[#324049]">
          {icon && (
            <div className="w-[38px] h-[38px] rounded-[11px] bg-[rgba(0,168,132,0.12)] text-[#00a884] grid place-items-center flex-shrink-0">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {crumb && (
              <div className="text-[10.5px] text-[#6b7882] tracking-widest uppercase font-semibold">{crumb}</div>
            )}
            <div className="text-base font-bold text-[#e9edef] mt-0.5">{title}</div>
          </div>
          <EyeOnPatientPill isMaxed={isMaxed} />
          <button
            type="button"
            onClick={onClose}
            className="w-[34px] h-[34px] rounded-[10px] grid place-items-center text-[#a4b1b9] hover:bg-[#2a3942] hover:text-[#e9edef] transition"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#324049] bg-[#1a262e] rounded-b-[20px]">
          <span className="text-[11px] text-[#6b7882]">{footerHint || 'Auto-guardado activo'}</span>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold text-[#a4b1b9] hover:text-[#e9edef] hover:bg-[#2a3942] transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                onSave?.();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-bold bg-[#00a884] text-[#001b14] hover:bg-[#008f6f] transition shadow-[0_4px_14px_rgba(0,168,132,0.25)]"
            >
              Guardado ✓
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
