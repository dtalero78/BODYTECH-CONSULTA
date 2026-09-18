// ============================================================================
// Ayuda — un ⓘ que explica un concepto al pasar el mouse (o al tocarlo).
//
// El `title` nativo tarda en salir, no se ve en celular y nadie lo descubre:
// en Indicadores las tarjetas lo tenían marcado con un "°" que pasaba de largo.
// Esto se dibuja en un portal con posición fija porque las tarjetas y las
// tablas del coordinador van con `overflow-hidden`, que lo recortaría.
// ============================================================================

import { useState, useRef, useEffect, useId, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { FONT_INTER } from './_tokens';

const ANCHO = 280;
const MARGEN = 8;
/** Espacio que se reserva debajo; si no alcanza, el globo sale hacia arriba. */
const ALTO_ESTIMADO = 150;

export function Ayuda({ texto, children }: { texto: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ top: number; left: number; arriba: boolean } | null>(null);

  const abrir = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(
      Math.max(MARGEN, r.left + r.width / 2 - ANCHO / 2),
      window.innerWidth - ANCHO - MARGEN
    );
    const arriba = r.bottom + ALTO_ESTIMADO > window.innerHeight;
    setPos({ top: arriba ? r.top - 6 : r.bottom + 6, left, arriba });
  };
  const cerrar = () => setPos(null);

  // Posición fija: con scroll quedaría flotando en otro lado.
  const abierto = pos !== null;
  useEffect(() => {
    if (!abierto) return;
    const alMover = () => setPos(null);
    window.addEventListener('scroll', alMover, true);
    return () => window.removeEventListener('scroll', alMover, true);
  }, [abierto]);

  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={abrir}
      onMouseLeave={cerrar}
      onFocus={abrir}
      onBlur={cerrar}
      onClick={(e) => {
        // En celular no hay hover: tocar abre y cierra. Y que no dispare el
        // clic de la fila donde esté.
        e.stopPropagation();
        if (pos) cerrar();
        else abrir();
      }}
      className="inline-flex items-center align-middle cursor-help rounded outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/40"
    >
      {children ?? <Info className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-700" aria-label="Qué significa" />}
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-[70] rounded-lg bg-zinc-900 px-3 py-2 text-[12.5px] leading-snug text-white shadow-lg pointer-events-none normal-case tracking-normal font-normal text-left"
            style={{
              top: pos.top,
              left: pos.left,
              width: ANCHO,
              transform: pos.arriba ? 'translateY(-100%)' : undefined,
              fontFamily: FONT_INTER,
            }}
          >
            {texto}
          </div>,
          document.body
        )}
    </span>
  );
}
