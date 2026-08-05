import { useEffect, useRef, useState } from 'react';
import { FunctionSquare } from 'lucide-react';

export interface FormulaDef {
  /** Campo calculado, tal como aparece etiquetado en el formulario. */
  campo: string;
  /** Fórmula en notación legible para el profesional (no sintaxis de Excel). */
  formula: string;
  /** Aclaración opcional (umbrales, bandas, casos borde). */
  nota?: string;
}

/**
 * Ícono con popover que explica las fórmulas de los campos calculados de una
 * sección. Se muestra en el header del `Modal` para que el médico entienda de
 * dónde sale cada valor bloqueado (los que llevan candado).
 *
 * Abre en hover y también en click/foco, para que funcione en pantallas táctiles
 * y con teclado.
 */
export function FormulaHint({ formulas }: { formulas: ReadonlyArray<FormulaDef> }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer click fuera o con Escape (sin robarle el Escape al Modal
  // cuando el popover está cerrado).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (formulas.length === 0) return null;

  return (
    <div
      ref={wrapRef}
      className="relative flex-shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        // No es un toggle: en desktop el hover ya lo abrió, así que alternar aquí
        // lo cerraría apenas se hace click. Se cierra al salir del área, con
        // Escape o haciendo click afuera (que es lo que aplica en táctil).
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        aria-label="Ver cómo se calculan los campos de esta sección"
        aria-expanded={open}
        className={`w-[34px] h-[34px] rounded-[10px] grid place-items-center border transition ${
          open
            ? 'bg-[rgba(0,168,132,0.18)] border-[#00a884]/50 text-[#00a884]'
            : 'bg-[rgba(0,168,132,0.08)] border-[#324049] text-[#a4b1b9] hover:text-[#00a884] hover:border-[#00a884]/40'
        }`}
      >
        <FunctionSquare size={16} />
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[420px] max-w-[80vw] rounded-[14px] border border-[#3b4a54] bg-[#1a2530] shadow-2xl p-4"
          style={{ animation: 'panelScaleY 140ms ease-out', transformOrigin: 'top right' }}
        >
          <div className="text-[10.5px] font-semibold text-[#6b7882] tracking-widest uppercase mb-2.5">
            Cómo se calcula
          </div>
          <div className="flex flex-col gap-2.5">
            {formulas.map((f) => (
              <div key={f.campo} className="flex flex-col gap-1">
                <div className="text-[12.5px] font-semibold text-[#e9edef]">{f.campo}</div>
                <div className="text-[12px] text-[#00a884] font-mono leading-snug break-words">
                  {f.formula}
                </div>
                {f.nota && (
                  <div className="text-[11px] text-[#a4b1b9] leading-snug">{f.nota}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
