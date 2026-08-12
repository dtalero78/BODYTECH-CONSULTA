// ============================================================================
// BodyVibeTechPage — donde se construyen los apps.
//
// La pantalla se organiza alrededor de UNA pregunta ("¿qué quiere hacer?") y no
// alrededor de todo lo que el sistema sabe hacer. Antes mostraba a la vez el
// recinto, la conversación, las versiones, la publicación y la apariencia:
// cinco cosas compitiendo por atención cuando en realidad se hace una a la vez.
//
// Ahora hay dos puertas al entrar —construir algo nuevo, o modificar lo que ya
// existe— y el resto vive en la barra lateral, a un clic. Es la misma estructura
// que se acordó al diseñar el producto; la interfaz la había perdido.
//
// Todo arranca vacío y crece: sin borradores no hay lista, sin solicitudes no
// hay bandeja. Una pantalla que muestra secciones vacías enseña opciones que no
// se pueden usar.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import AppSandbox, { ResultadoConsulta } from '../components/bodyvibe/AppSandbox';
import { Bandeja, Publicar } from '../components/bodyvibe/PanelPublicacion';
import { SelectorApariencia } from '../components/bodyvibe/SelectorApariencia';
import bodyvibeService, {
  App,
  EstadoBodyVibe,
  EstadoGasto,
  VersionApp,
} from '../services/bodyvibe.service';

interface Turno {
  pedido: string;
  titulo: string;
  notas?: string;
  costoUsd?: number | null;
}

/** Qué ocupa la zona principal. */
type Vista = 'inicio' | 'construir' | 'modificar' | 'app' | 'apariencia' | 'aprobaciones';

const dinero = (usd: number) => `USD ${usd.toFixed(2)}`;

/**
 * Ejemplos de arranque. Están escritos contra datos que EXISTEN —se verificaron
 * contra la base— porque una sugerencia que devuelve "no hay datos" enseña que
 * la herramienta no sirve justo en el primer intento.
 */
const SUGERENCIAS = [
  {
    titulo: 'Citas atendidas por sede, mes a mes',
    pedido: 'Un panel con las citas atendidas por sede y por mes, en tabla y en barras.',
  },
  {
    titulo: 'Consultas por género, con la cobertura del dato',
    pedido:
      'Las consultas atendidas discriminadas por género, mostrando al lado qué porcentaje de los registros tiene ese dato.',
  },
  {
    titulo: 'Coaches que no marcaron entrada hoy',
    pedido:
      'Una lista de los profesionales activos que hoy no tienen jornada abierta en el torniquete, con su sede.',
  },
  {
    titulo: 'Puntajes de calidad por profesional',
    pedido:
      'El promedio de puntaje de calidad por profesional, de menor a mayor, indicando cuántas consultas evaluadas tiene cada uno.',
  },
];

export default function BodyVibeTechPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [activo, setActivo] = useState<App | null>(null);
  const [versiones, setVersiones] = useState<VersionApp[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [vista, setVista] = useState<Vista>('inicio');
  const [mostrarPublicar, setMostrarPublicar] = useState(false);

  const [pedido, setPedido] = useState('');
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estado, setEstado] = useState<EstadoBodyVibe | null>(null);
  const [gasto, setGasto] = useState<EstadoGasto | null>(null);
  const [pendientes, setPendientes] = useState(0);

  const recargarCabecera = useCallback(async () => {
    try {
      const [e, g, s] = await Promise.all([
        bodyvibeService.estado(),
        bodyvibeService.gasto(),
        bodyvibeService.solicitudes(),
      ]);
      setEstado(e);
      setGasto(g);
      setPendientes(s.length);
    } catch {
      /* Informativo: si falla no bloquea el trabajo. */
    }
  }, []);

  useEffect(() => {
    bodyvibeService.listarApps().then(setApps).catch(() => setApps([]));
    recargarCabecera();
  }, [recargarCabecera]);

  const refrescarActivo = useCallback(async () => {
    if (!activo) return;
    const app = await bodyvibeService.obtenerApp(activo.id);
    setActivo(app);
    setApps((a) => a.map((x) => (x.id === app.id ? app : x)));
  }, [activo]);

  const abrir = useCallback(async (id: string) => {
    setError(null);
    setTurnos([]);
    setMostrarPublicar(false);
    setPedido('');
    const app = await bodyvibeService.obtenerApp(id);
    setActivo(app);
    setVersiones(await bodyvibeService.versiones(id));
    setVista('app');
  }, []);

  /** Arranca un borrador y deja el compositor con el texto ya puesto. */
  const empezar = useCallback(async (textoInicial = '') => {
    const app = await bodyvibeService.crearApp();
    setApps((a) => [app, ...a]);
    setActivo(app);
    setVersiones([]);
    setTurnos([]);
    setError(null);
    setMostrarPublicar(false);
    setPedido(textoInicial);
    setVista('app');
  }, []);

  const eliminar = useCallback(
    async (id: string) => {
      await bodyvibeService.eliminarApp(id);
      setApps((a) => a.filter((x) => x.id !== id));
      if (activo?.id === id) {
        setActivo(null);
        setVista('inicio');
      }
    },
    [activo]
  );

  const generar = useCallback(async () => {
    if (!activo || !pedido.trim() || generando) return;
    setGenerando(true);
    setError(null);

    const texto = pedido.trim();
    const r = await bodyvibeService.generar(
      activo.id,
      texto,
      turnos.map((t) => ({ pedido: t.pedido, titulo: t.titulo }))
    );

    if (!r.ok) {
      setError(r.mensaje);
    } else {
      setActivo(r.app);
      setPedido('');
      setTurnos((t) => [
        ...t,
        { pedido: texto, titulo: r.app.titulo, notas: r.notas, costoUsd: r.costoUsd },
      ]);
      setApps((a) => a.map((x) => (x.id === r.app.id ? r.app : x)));
      setVersiones(await bodyvibeService.versiones(activo.id));
      recargarCabecera();
    }
    setGenerando(false);
  }, [activo, pedido, generando, turnos, recargarCabecera]);

  const restaurar = useCallback(
    async (version: number) => {
      if (!activo) return;
      const app = await bodyvibeService.restaurar(activo.id, version);
      setActivo(app);
      setVersiones(await bodyvibeService.versiones(activo.id));
    },
    [activo]
  );

  const ejecutarConsulta = useCallback(
    async (sql: string, params: any[]): Promise<ResultadoConsulta> => {
      const r = await bodyvibeService.consultar(sql, params, activo?.id);
      return r.ok
        ? { ok: true, filas: r.filas, recortado: r.recortado }
        : { ok: false, mensaje: r.mensaje };
    },
    [activo]
  );

  const alternarInterruptor = useCallback(async () => {
    if (!estado) return;
    if (estado.activo) {
      const motivo = window.prompt('¿Por qué lo está apagando? (queda registrado)') ?? '';
      setEstado(await bodyvibeService.apagar(motivo));
    } else {
      setEstado(await bodyvibeService.encender());
    }
  }, [estado]);

  const apagado = estado ? !estado.activo : false;

  const itemLateral = (activa: boolean) =>
    `w-full text-left rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      activa
        ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
    }`;

  return (
    <div className="flex min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ================= Barra lateral ================= */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => {
            setActivo(null);
            setVista('inicio');
          }}
          className="flex items-center gap-2.5 px-4 py-5 text-left"
        >
          {/* El archivo original es negro sobre fondo blanco opaco; acá se usa
              la versión en silueta con alfa, así `invert` lo vuelve blanco en
              modo oscuro sin dejar un recuadro. */}
          <img
            src="/logo-bodytech.png"
            alt="Bodytech"
            className="h-9 w-auto shrink-0 dark:invert"
          />
          <span className="text-[15px] font-semibold leading-tight tracking-tight">
            BodyVibeTech
          </span>
        </button>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          <button
            onClick={() => setVista('construir')}
            className="w-full rounded-md bg-zinc-900 px-2.5 py-1.5 text-[13px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Construir algo nuevo
          </button>

          {apps.length > 0 && (
            <div>
              <span className="mb-1.5 block px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Mis borradores
              </span>
              <ul className="space-y-0.5">
                {apps.map((a) => (
                  <li key={a.id} className="group flex items-center gap-1">
                    <button
                      onClick={() => abrir(a.id)}
                      className={`${itemLateral(activo?.id === a.id && vista === 'app')} min-w-0 flex-1 truncate`}
                    >
                      {a.titulo}
                      {a.estado === 'publicado' && (
                        <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                          &#9679;
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => eliminar(a.id)}
                      aria-label={`Eliminar ${a.titulo}`}
                      className="shrink-0 px-1 text-[11px] text-zinc-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
                    >
                      &#10005;
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <span className="mb-1.5 block px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              La plataforma
            </span>
            <button
              onClick={() => {
                setActivo(null);
                setVista('apariencia');
              }}
              className={itemLateral(vista === 'apariencia')}
            >
              Apariencia
            </button>
            {/* La bandeja solo existe si hay algo que aprobar, y solo para quien
                aprueba: al resto la API le devuelve vacío. */}
            {pendientes > 0 && (
              <button
                onClick={() => {
                  setActivo(null);
                  setVista('aprobaciones');
                }}
                className={itemLateral(vista === 'aprobaciones')}
              >
                Aprobaciones
                <span className="ml-1.5 rounded-full bg-zinc-900 px-1.5 text-[10.5px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {pendientes}
                </span>
              </button>
            )}
          </div>
        </nav>

        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {gasto && (
            <div className="mb-2 font-mono text-[10.5px] text-zinc-400">
              {dinero(gasto.gastadoUsd)} de {dinero(gasto.topeUsd)} este mes
            </div>
          )}
          <button
            onClick={alternarInterruptor}
            className="flex w-full items-center gap-2 text-[12px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${apagado ? 'bg-amber-500' : 'bg-emerald-500'}`}
            />
            {apagado ? 'Apagado · encender' : 'Encendido · apagar todo'}
          </button>
        </div>
      </aside>

      {/* ================= Zona principal ================= */}
      <main className="min-w-0 flex-1">
        {estado && !estado.rolDisponible && (
          <p className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            El usuario de solo lectura de la base no está disponible: ningún app puede consultar
            datos.
          </p>
        )}

        {vista === 'inicio' && (
          <div className="mx-auto max-w-2xl px-6 pt-24">
            <h1 className="mb-8 text-center text-[26px] font-semibold tracking-tight">
              ¿Qué quiere hacer?
            </h1>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => setVista('construir')}
                className="rounded-xl border border-zinc-200 p-5 text-left transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <span className="block text-[15px] font-medium">Construir algo nuevo</span>
                <span className="mt-1 block text-[13px] text-zinc-500">
                  Un tablero, un reporte, una utilidad que hoy no existe.
                </span>
              </button>
              <button
                onClick={() => setVista('modificar')}
                className="rounded-xl border border-zinc-200 p-5 text-left transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <span className="block text-[15px] font-medium">Modificar lo que ya existe</span>
                <span className="mt-1 block text-[13px] text-zinc-500">
                  Cambiar cómo se ve la plataforma, o agregar algo dentro de una pantalla actual.
                </span>
              </button>
            </div>
          </div>
        )}

        {vista === 'construir' && (
          <div className="mx-auto max-w-2xl px-6 pt-24">
            <h1 className="mb-6 text-center text-[26px] font-semibold tracking-tight">
              Cuéntenos qué necesita ver.
            </h1>

            <textarea
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) empezar(pedido);
              }}
              rows={3}
              autoFocus
              placeholder="Por ejemplo: las citas de esta semana por sede, con cuántas se atendieron."
              className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[14px] outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
            />

            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => empezar(pedido)}
                disabled={!pedido.trim() || apagado}
                className="rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Construir
              </button>
              <span className="text-[11.5px] text-zinc-400">&#8984;/Ctrl + Enter</span>
            </div>

            <ul className="mt-10 space-y-1">
              {SUGERENCIAS.map((s) => (
                <li key={s.titulo}>
                  <button
                    onClick={() => empezar(s.pedido)}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-[13.5px] text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    {s.titulo}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {vista === 'modificar' && (
          <div className="mx-auto max-w-2xl px-6 py-12">
            <h1 className="mb-6 text-[22px] font-semibold tracking-tight">
              Modificar lo que ya existe
            </h1>
            <SelectorApariencia />
            <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <span className="block text-[14px] font-medium">Agregar algo a una pantalla</span>
              <p className="mt-1 text-[12.5px] text-zinc-500">
                Se construye igual que cualquier app; al publicarlo usted elige en qué pantalla queda
                incrustado, al pie.
              </p>
              <button
                onClick={() => setVista('construir')}
                className="mt-3 rounded-md border border-zinc-200 px-3 py-1.5 text-[12.5px] dark:border-zinc-700"
              >
                Empezar
              </button>
            </div>
          </div>
        )}

        {vista === 'apariencia' && (
          <div className="mx-auto max-w-2xl px-6 py-12">
            <h1 className="mb-2 text-[22px] font-semibold tracking-tight">Apariencia</h1>
            <SelectorApariencia />
          </div>
        )}

        {vista === 'aprobaciones' && (
          <div className="mx-auto max-w-3xl px-6 py-12">
            <h1 className="mb-2 text-[22px] font-semibold tracking-tight">Aprobaciones</h1>
            <Bandeja onCambio={recargarCabecera} />
          </div>
        )}

        {vista === 'app' && activo && (
          <div className="mx-auto max-w-4xl px-6 py-6">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-[19px] font-semibold tracking-tight">{activo.titulo}</h1>
              <span className="font-mono text-[11px] text-zinc-400">v{activo.version}</span>
              <button
                onClick={() => setMostrarPublicar((v) => !v)}
                className="ml-auto rounded-md border border-zinc-200 px-3 py-1.5 text-[12.5px] dark:border-zinc-700"
              >
                {activo.estado === 'publicado' ? 'Publicación · en vivo' : 'Publicar'}
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              {activo.codigo ? (
                <AppSandbox codigo={activo.codigo} ejecutarConsulta={ejecutarConsulta} />
              ) : (
                <p className="p-12 text-center text-[13px] text-zinc-500">
                  Todavía no hay nada. Cuéntele abajo qué quiere que muestre.
                </p>
              )}
            </div>

            {mostrarPublicar && <Publicar app={activo} onCambio={refrescarActivo} />}

            <div className="mt-5">
              {turnos.map((t, i) => (
                <div key={i} className="mb-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
                  <p className="text-[13px]">{t.pedido}</p>
                  {t.notas && <p className="mt-1 text-[12.5px] text-zinc-500">{t.notas}</p>}
                  {typeof t.costoUsd === 'number' && (
                    <p className="mt-1 font-mono text-[10.5px] text-zinc-400">
                      {dinero(t.costoUsd)}
                    </p>
                  )}
                </div>
              ))}

              {error && (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <textarea
                  value={pedido}
                  onChange={(e) => setPedido(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generar();
                  }}
                  rows={2}
                  disabled={generando || apagado}
                  placeholder={
                    activo.codigo ? '¿Qué quiere cambiar?' : 'Cuéntenos qué quiere que muestre'
                  }
                  className="min-w-0 flex-1 resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13.5px] outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  onClick={generar}
                  disabled={generando || apagado || !pedido.trim()}
                  className="self-end rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {generando ? 'Construyendo…' : 'Construir'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">
                {generando
                  ? 'Puede tardar un par de minutos; el trabajo sigue en el servidor aunque cierre la pestaña.'
                  : '⌘/Ctrl + Enter también funciona.'}
              </p>
            </div>

            {versiones.length > 1 && (
              <details className="mt-8">
                <summary className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Versiones ({versiones.length})
                </summary>
                <ul className="mt-2">
                  {versiones.map((v) => (
                    <li
                      key={v.version}
                      className="flex items-center gap-3 border-b border-zinc-100 py-1.5 text-[12.5px] dark:border-zinc-800"
                    >
                      <span className="font-mono text-[11px] text-zinc-400">v{v.version}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400">
                        {v.pedido ?? '—'}
                      </span>
                      {v.version !== activo.version && (
                        <button
                          onClick={() => restaurar(v.version)}
                          className="shrink-0 text-[12px] text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
                        >
                          Volver a esta
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
