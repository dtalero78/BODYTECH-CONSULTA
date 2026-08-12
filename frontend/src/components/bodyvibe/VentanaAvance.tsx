// ============================================================================
// VentanaAvance — qué está pasando mientras se construye.
//
// Construir tarda entre treinta segundos y un par de minutos. Antes, todo ese
// rato era un botón que decía «Construyendo…»: indistinguible de algo colgado,
// y suficiente para que alguien recargue la página y pague la generación dos
// veces.
//
// Lo que se muestra acá no es una animación de relleno. Es el código real,
// según sale del modelo: el título apenas lo decide, y después las últimas
// líneas escritas. Una barra de progreso inventada mentiría sobre cuánto falta;
// esto no promete nada y prueba lo único que hace falta probar, que está
// trabajando.
//
// Se desplaza sola al final —lo interesante es lo último— y muestra el reloj,
// porque saber que van cuarenta segundos es distinto a no saber nada.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { AvanceGeneracion } from '../../services/bodyvibe.service';

interface Props {
  avance: AvanceGeneracion | null;
}

export function VentanaAvance({ avance }: Props) {
  const caja = useRef<HTMLPreElement | null>(null);
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Al final, siempre: lo que acaba de escribirse es lo que se quiere ver.
  useEffect(() => {
    if (caja.current) caja.current.scrollTop = caja.current.scrollHeight;
  }, [avance?.cola]);

  const reloj = segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)}m ${segundos % 60}s`;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          {avance?.titulo ? (
            <>
              Construyendo{' '}
              <span className="font-medium">{avance.titulo}</span>
            </>
          ) : (
            'Leyendo el pedido y el catálogo de datos…'
          )}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-zinc-400">
          {avance && avance.lineas > 0 ? `${avance.lineas} líneas · ` : ''}
          {reloj}
        </span>
      </div>

      {avance?.cola ? (
        <pre
          ref={caja}
          className="max-h-52 overflow-auto bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {avance.cola}
        </pre>
      ) : (
        <p className="px-3 py-4 text-[12px] text-zinc-500">
          Todavía no empieza a escribir. La primera parte es la más lenta: está leyendo qué tablas
          existen y qué significa cada columna.
        </p>
      )}
    </div>
  );
}

export default VentanaAvance;
