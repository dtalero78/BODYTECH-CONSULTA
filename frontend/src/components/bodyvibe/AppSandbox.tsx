// ============================================================================
// AppSandbox — el anfitrión del recinto aislado.
//
// Monta el iframe donde corre el código generado y atiende la ventanilla: el
// app pide datos por postMessage, este componente decide si los entrega.
//
// El aislamiento en sí vive en `sandboxRuntime.ts` (CSP + atributo sandbox).
// Lo que se cuida acá es el otro lado del vidrio:
//
//   · Identidad — solo se atienden mensajes cuyo `source` sea ESTE iframe.
//     El origen no sirve para verificar: con sandbox sin allow-same-origin el
//     origen es "null" y cualquier iframe opaco de la página lo comparte.
//
//   · Topes — un app con un ciclo mal escrito puede disparar consultas sin
//     freno. Acá se limita cuántas corren a la vez y cuántas en total, para
//     que un error de programación no se convierta en carga sobre la misma
//     base de datos que atiende la consulta médica (decisión 09).
//
//   · Visibilidad de fallas — un app roto tiene que decirlo. Sin esto queda un
//     recuadro en blanco y nadie sabe si está cargando o si se cayó.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRIDGE, construirDocumento } from './sandboxRuntime';

/** Consultas simultáneas por app. Más que esto es un ciclo mal escrito. */
const MAX_CONCURRENTES = 3;

/** Consultas totales por montaje. Freno duro contra un bucle infinito. */
const MAX_POR_MONTAJE = 60;

/** Corte del lado del anfitrión, por encima del corte del servidor (5s). */
const TIMEOUT_MS = 8_000;

export type ResultadoConsulta =
  | { ok: true; filas: any[]; recortado: boolean }
  | { ok: false; mensaje: string };

interface Props {
  /** JavaScript del app. Pinta dentro de `#app`; ver `sandboxRuntime`. */
  codigo: string;
  /** Ejecuta la consulta contra los estantes. La provee quien monta el app. */
  ejecutarConsulta: (sql: string, params: any[]) => Promise<ResultadoConsulta>;
  /** 'claro' | 'oscuro'. Si se omite, se toma el tema de la plataforma. */
  tema?: 'claro' | 'oscuro';
  /** Se llama cuando el app reporta un error adentro. */
  onError?: (mensaje: string) => void;
  altoMinimo?: number;
  altoMaximo?: number;
}

function temaDeLaPlataforma(): 'claro' | 'oscuro' {
  if (typeof document === 'undefined') return 'claro';
  const stamp = document.documentElement.getAttribute('data-theme');
  if (stamp === 'dark') return 'oscuro';
  if (stamp === 'light') return 'claro';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

export function AppSandbox({
  codigo,
  ejecutarConsulta,
  tema,
  onError,
  altoMinimo = 180,
  altoMaximo = 2400,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const enVuelo = useRef(0);
  const totalCorridas = useRef(0);

  const [alto, setAlto] = useState(altoMinimo);
  const [listo, setListo] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const temaEfectivo = tema ?? temaDeLaPlataforma();

  // El documento se rearma solo cuando cambia el código o el tema. Cambiarlo
  // remonta el iframe y reinicia el estado del app, que es lo que se quiere al
  // regenerar: no arrastrar nada de la versión anterior.
  const documento = useMemo(
    () => construirDocumento(codigo, temaEfectivo),
    [codigo, temaEfectivo]
  );

  useEffect(() => {
    enVuelo.current = 0;
    totalCorridas.current = 0;
    setListo(false);
    setFalla(null);
    setAlto(altoMinimo);
  }, [documento, altoMinimo]);

  const responder = useCallback((id: number, carga: Record<string, unknown>) => {
    const ventana = iframeRef.current?.contentWindow;
    if (!ventana) return;
    ventana.postMessage({ tipo: BRIDGE.RESULT, id, ...carga }, '*');
  }, []);

  useEffect(() => {
    async function alRecibir(ev: MessageEvent) {
      // Única verificación de identidad válida acá. Con un iframe de origen
      // opaco, `ev.origin` es siempre "null" y no distingue un iframe de otro.
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;

      const msg = ev.data;
      if (!msg || typeof msg.tipo !== 'string') return;

      switch (msg.tipo) {
        case BRIDGE.READY:
          setListo(true);
          return;

        case BRIDGE.RESIZE: {
          const propuesto = Number(msg.alto);
          if (Number.isFinite(propuesto)) {
            setAlto(Math.min(Math.max(propuesto, altoMinimo), altoMaximo));
          }
          return;
        }

        case BRIDGE.ERROR: {
          const mensaje = String(msg.mensaje ?? 'Error en el app.');
          setFalla(mensaje);
          setListo(true);
          onError?.(mensaje);
          return;
        }

        case BRIDGE.QUERY: {
          const id = Number(msg.id);
          if (!Number.isFinite(id)) return;

          if (totalCorridas.current >= MAX_POR_MONTAJE) {
            responder(id, {
              ok: false,
              mensaje:
                'Este app ya hizo demasiadas consultas. Recargalo, y si vuelve a pasar es que tiene un ciclo mal escrito.',
            });
            return;
          }
          if (enVuelo.current >= MAX_CONCURRENTES) {
            responder(id, {
              ok: false,
              mensaje: 'Demasiadas consultas al mismo tiempo. Pedí los datos de a poco.',
            });
            return;
          }

          totalCorridas.current += 1;
          enVuelo.current += 1;

          const corte = new Promise<ResultadoConsulta>((resolve) =>
            setTimeout(
              () => resolve({ ok: false, mensaje: 'La consulta se pasó de tiempo y se cortó.' }),
              TIMEOUT_MS
            )
          );

          try {
            const sql = String(msg.sql ?? '');
            const params = Array.isArray(msg.params) ? msg.params : [];
            const r = await Promise.race([ejecutarConsulta(sql, params), corte]);

            if (r.ok) responder(id, { ok: true, filas: r.filas, recortado: r.recortado });
            else responder(id, { ok: false, mensaje: r.mensaje });
          } catch (e: any) {
            responder(id, { ok: false, mensaje: e?.message ?? 'Error consultando los datos.' });
          } finally {
            enVuelo.current -= 1;
          }
          return;
        }
      }
    }

    window.addEventListener('message', alRecibir);
    return () => window.removeEventListener('message', alRecibir);
  }, [ejecutarConsulta, responder, onError, altoMinimo, altoMaximo]);

  // Si el app nunca avisa que pintó, no dejamos el "cargando" para siempre:
  // a los 12 segundos se muestra el recuadro igual. Puede estar bien y no
  // haber llamado a bv.ready(), o puede estar colgado — en ambos casos es
  // mejor mostrar lo que haya.
  useEffect(() => {
    if (listo) return;
    const t = setTimeout(() => setListo(true), 12_000);
    return () => clearTimeout(t);
  }, [listo, documento]);

  return (
    <div className="relative w-full">
      {!listo && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-zinc-900/70">
          <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
            Cargando el app…
          </span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        // Sin `allow-same-origin`: origen opaco. Este atributo es el cerrojo 2.
        // No agregar allow-same-origin, allow-popups ni allow-top-navigation:
        // cada uno abre una puerta que el resto del diseño da por cerrada.
        sandbox="allow-scripts"
        srcDoc={documento}
        title="Aplicación de BodyVibeTech"
        className="w-full block border-0 bg-transparent"
        style={{ height: alto }}
      />

      {falla && (
        <div className="mt-2 border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-semibold">El app se rompió.</span> {falla}
        </div>
      )}
    </div>
  );
}

export default AppSandbox;
