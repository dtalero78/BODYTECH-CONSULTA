import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { EyeOnPatientPill } from './EyeOnPatientPill';
import { FormulaHint, type FormulaDef } from './FormulaHint';

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
  /** Oculta el pill "Afiliado visible/en miniatura" — solo aplica a paneles con videollamada. Default true. */
  showEyePill?: boolean;
  /**
   * Fórmulas de los campos calculados de la sección. Si se pasan, el header
   * muestra un ícono con el detalle de cómo se obtiene cada valor bloqueado.
   */
  formulas?: ReadonlyArray<FormulaDef>;
  /**
   * Ancho máximo. `default` (max-w-3xl) para el panel de consulta, que vive en
   * un dock del 25% junto al video. `wide` para paneles a pantalla completa
   * (Médico Corporativo): más ancho = los campos caben en más columnas y se
   * reduce el scroll vertical. Siempre limitado por `w-full`, así que nunca
   * desborda el contenedor.
   */
  size?: 'default' | 'wide';
}

/**
 * Modal interno al panel. NO es fixed al viewport — su `position: absolute`
 * vive dentro del contenedor `.panel-shell` (que es relative).
 *
 * Animación scaleY 200ms ease-out al abrir.
 */
export function Modal({ open, onClose, crumb, title, icon, footerHint, isMaxed, children, onSave, showEyePill = true, formulas, size = 'default' }: ModalProps) {
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
      className={`absolute inset-0 z-50 flex items-start justify-center overflow-y-auto ${
        size === 'wide' ? 'p-3' : 'p-6'
      }`}
      style={{
        background: 'rgba(var(--p-scrim-rgb),0.82)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative bg-[var(--p-surface)] border border-[var(--p-line-2)] rounded-[20px] w-full shadow-2xl flex flex-col my-auto ${
          size === 'wide' ? 'max-w-6xl' : 'max-w-3xl'
        }`}
        style={{
          maxHeight: 'calc(100% - 8px)',
          animation: 'panelScaleY 200ms ease-out',
          transformOrigin: 'top center',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[var(--p-line)]">
          {icon && (
            <div className="w-[38px] h-[38px] rounded-[11px] bg-[rgba(var(--p-accent-rgb),0.12)] text-[var(--p-accent)] grid place-items-center flex-shrink-0">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {crumb && (
              <div className="text-[10.5px] text-[var(--p-text-3)] tracking-widest uppercase font-semibold">{crumb}</div>
            )}
            <div className="text-base font-bold text-[var(--p-text)] mt-0.5">{title}</div>
          </div>
          {formulas && formulas.length > 0 && <FormulaHint formulas={formulas} />}
          {showEyePill && <EyeOnPatientPill isMaxed={isMaxed} />}
          <button
            type="button"
            onClick={onClose}
            className="w-[34px] h-[34px] rounded-[10px] grid place-items-center text-[var(--p-text-2)] hover:bg-[var(--p-input)] hover:text-[var(--p-text)] transition"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--p-line)] bg-[var(--p-surface-3)] rounded-b-[20px]">
          <span className="text-[11px] text-[var(--p-text-3)]">{footerHint || 'Auto-guardado activo'}</span>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold text-[var(--p-text-2)] hover:text-[var(--p-text)] hover:bg-[var(--p-input)] transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                onSave?.();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-bold bg-[var(--p-cta)] text-[var(--p-on-cta)] hover:bg-[var(--p-cta-hover)] transition shadow-[0_4px_14px_rgba(var(--p-cta-rgb),0.25)]"
            >
              Guardado ✓
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
