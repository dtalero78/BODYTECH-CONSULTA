import { X, ChevronLeft, ChevronRight } from 'lucide-react';
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
  /**
   * Encadenado de secciones ("wizard"). Cuando se pasa `nextLabel`, el botón
   * primario deja de decir "Guardado ✓" y pasa a nombrar el paso siguiente
   * ("Siguiente: Fuerza"), abriéndolo en vez de cerrar. `onBack` agrega "Atrás".
   *
   * Es lo que pidió el equipo médico: al terminar una sección querían caer
   * directo en la siguiente en vez de cerrar, buscar el card y volver a abrir.
   *
   * A diferencia de la plataforma que mostraron de referencia, acá el guardado
   * NO ocurre al final de la cadena: cada campo ya se auto-guarda solo. La
   * cadena es únicamente navegación, así que abandonarla a la mitad no pierde
   * nada — que es justo la ventaja que no queríamos resignar.
   */
  nextLabel?: string;
  onNext?: () => void;
  onBack?: () => void;
}

/**
 * Modal interno al panel. NO es fixed al viewport — su `position: absolute`
 * vive dentro del contenedor `.panel-shell` (que es relative).
 *
 * Animación scaleY 200ms ease-out al abrir.
 */
export function Modal({ open, onClose, crumb, title, icon, footerHint, isMaxed, children, onSave, showEyePill = true, formulas, size = 'default', nextLabel, onNext, onBack }: ModalProps) {
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
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-[10px] text-xs font-semibold text-[var(--p-text-2)] hover:text-[var(--p-text)] hover:bg-[var(--p-input)] transition shrink-0"
              >
                <ChevronLeft size={14} />
                Atrás
              </button>
            )}
            <span className="text-[11px] text-[var(--p-text-3)] truncate">{footerHint || 'Auto-guardado activo'}</span>
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold text-[var(--p-text-2)] hover:text-[var(--p-text)] hover:bg-[var(--p-input)] transition"
            >
              {nextLabel ? 'Cerrar' : 'Cancelar'}
            </button>
            <button
              type="button"
              onClick={() => {
                onSave?.();
                if (nextLabel && onNext) onNext();
                else onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-bold bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:bg-[var(--p-accent-hover)] transition"
            >
              {nextLabel ? (
                <>
                  Siguiente: {nextLabel}
                  <ChevronRight size={14} />
                </>
              ) : (
                'Guardado ✓'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
