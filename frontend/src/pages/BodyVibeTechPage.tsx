// ============================================================================
// BodyVibeTechPage — donde se construyen los apps.
//
// La pantalla se organiza alrededor de UNA pregunta ("¿qué quiere hacer?") y no
// alrededor de todo lo que el sistema sabe hacer. Antes mostraba a la vez el
// recinto, la conversación, las versiones, la publicación y la apariencia:
// cinco cosas compitiendo por atención cuando en realidad se hace una a la vez.
//
// La portada es solo eso: el logo y dos puertas —construir algo nuevo, o
// modificar lo que ya existe—. Sin barra lateral, porque antes de elegir una
// puerta la barra no tiene nada útil que ofrecer y compite con la decisión.
//
// Elegida la puerta aparece la barra, y ahí viven las dos decisiones que
// acompañan al pedido: «Diseño» (cómo se ve) y «A quién» (quién lo ve y en qué
// pantalla queda). Debajo, el historial de borradores y los interruptores.
//
// Todo arranca vacío y crece: sin borradores no hay lista, sin solicitudes no
// hay bandeja. Una pantalla que muestra secciones vacías enseña opciones que no
// se pueden usar.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import authService from '../services/auth.service';
import AppSandbox, { ResultadoConsulta } from '../components/bodyvibe/AppSandbox';
import { Bandeja, Publicar } from '../components/bodyvibe/PanelPublicacion';
import { SelectorApariencia } from '../components/bodyvibe/SelectorApariencia';
import VentanaAvance from '../components/bodyvibe/VentanaAvance';
import bodyvibeService, {
  AnclajeDisponible,
  AvanceGeneracion,
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
type Vista =
  | 'inicio'
  | 'construir'
  | 'modificar'
  | 'app'
  | 'diseno'
  | 'aquien'
  | 'aprobaciones';

const dinero = (usd: number) => `USD ${usd.toFixed(2)}`;

/**
 * Ejemplos de arranque. Están escritos contra datos que EXISTEN —se verificaron
 * contra la base— porque una sugerencia que devuelve "no hay datos" enseña que
 * la herramienta no sirve justo en el primer intento.
 */
/**
 * Cómo se llama cada pantalla para alguien que no lee rutas. El mapa es
 * explícito y no derivado del nombre del anclaje: si mañana alguien agrega un
 * anclaje con otro formato de nombre, acá cae en la ruta cruda —feo pero
 * cierto— en vez de mostrar un título recortado al azar.
 */
const NOMBRE_PANTALLA: Record<string, string> = {
  '/panel-medico': 'Panel médico',
  '/coordinador': 'Coordinador',
  '/ordenes': 'Órdenes',
  '/historias': 'Historias clínicas',
};

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
  const navigate = useNavigate();
  // Se lee una vez: si la sesión se venció, quien avisa es el interceptor de
  // `sesion-vencida`, no un cartel acá.
  const [usuario] = useState(() => authService.getUser());

  const salir = useCallback(() => {
    authService.logout();
    navigate('/login', { replace: true });
  }, [navigate]);

  const [apps, setApps] = useState<App[]>([]);
  const [activo, setActivo] = useState<App | null>(null);
  const [versiones, setVersiones] = useState<VersionApp[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [vista, setVista] = useState<Vista>('inicio');

  const [anclajes, setAnclajes] = useState<AnclajeDisponible[]>([]);
  /**
   * Dónde va a quedar lo que se está construyendo. Se elige en «Modificar lo
   * que ya existe» y viaja hasta la publicación; sin esto, quien entra por esa
   * puerta tendría que volver a decir la misma pantalla al final.
   */
  const [anclajePreferido, setAnclajePreferido] = useState<string | null>(null);

  const [pedido, setPedido] = useState('');
  const [generando, setGenerando] = useState(false);
  const [avance, setAvance] = useState<AvanceGeneracion | null>(null);
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
    bodyvibeService.anclajes().then(setAnclajes).catch(() => setAnclajes([]));
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
    setPedido('');
    const app = await bodyvibeService.obtenerApp(id);
    setActivo(app);
    setVersiones(await bodyvibeService.versiones(id));
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

  /**
   * Corre una generación sobre un app concreto. El historial va por parámetro y
   * no leído del estado: quien acaba de crear el app lo llama en el mismo
   * tick, cuando `turnos` todavía tiene lo del app anterior.
   */
  const correrGeneracion = useCallback(
    async (app: App, texto: string, historial: { pedido: string; titulo: string }[]) => {
      setGenerando(true);
      setError(null);
      setAvance(null);

      const r = await bodyvibeService.generar(app.id, texto, historial, setAvance);

      if (r.ok) {
        setActivo(r.app);
        setPedido('');
        setTurnos((t) => [
          ...t,
          { pedido: texto, titulo: r.app.titulo, notas: r.notas, costoUsd: r.costoUsd },
        ]);
        setApps((a) => a.map((x) => (x.id === r.app.id ? r.app : x)));
        setVersiones(await bodyvibeService.versiones(app.id));
        recargarCabecera();
      } else {
        setError(r.mensaje);
      }

      setGenerando(false);
      setAvance(null);
      return r.ok;
    },
    [recargarCabecera]
  );

  /**
   * Crea el borrador y arranca a construir de una.
   *
   * Antes el borrador nacía al ENTRAR al compositor, con lo cual cada visita
   * que no terminaba en nada dejaba una «App sin título» vacía en la lista.
   * Ahora nace cuando hay algo que construir, y si esa primera generación falla
   * se lo lleva consigo: un app sin una sola línea de código no es un borrador,
   * es basura con nombre.
   */
  const empezar = useCallback(
    async (textoInicial = '') => {
      const texto = textoInicial.trim();
      if (!texto || generando) return;

      const app = await bodyvibeService.crearApp();
      setApps((a) => [app, ...a]);
      setActivo(app);
      setVersiones([]);
      setTurnos([]);
      setError(null);
      setPedido('');
      setVista('app');

      const ok = await correrGeneracion(app, texto, []);
      if (ok) return;

      // Se devuelve al compositor con lo que había escrito, para que pueda
      // reintentar sin volver a redactarlo.
      await bodyvibeService.eliminarApp(app.id).catch(() => undefined);
      setApps((a) => a.filter((x) => x.id !== app.id));
      setActivo(null);
      setPedido(texto);
      setVista('construir');
    },
    [generando, correrGeneracion]
  );

  const generar = useCallback(async () => {
    if (!activo || !pedido.trim() || generando) return;
    await correrGeneracion(
      activo,
      pedido.trim(),
      turnos.map((t) => ({ pedido: t.pedido, titulo: t.titulo }))
    );
  }, [activo, pedido, generando, turnos, correrGeneracion]);

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

  /**
   * La portada va sola: sin barra lateral, el logo centrado y las dos puertas.
   * La barra aparece recién cuando ya se eligió una — antes no tiene nada útil
   * que ofrecer y solo estorba la decisión.
   */
  const conBarra = vista !== 'inicio';

  const marca = (grande: boolean) => (
    <>
      {/* El archivo original es negro sobre fondo blanco opaco; acá se usa la
          versión en silueta con alfa, así `invert` lo vuelve blanco en modo
          oscuro sin dejar un recuadro. */}
      <img
        src="/logo-bodytech.png"
        alt="Bodytech"
        className={`${grande ? 'h-12' : 'h-9'} w-auto shrink-0 dark:invert`}
      />
      <span
        className={`${grande ? 'text-[20px]' : 'text-[15px]'} font-semibold leading-tight tracking-tight`}
      >
        BodyVibeTech
      </span>
    </>
  );

  return (
    <div className="flex min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ================= Barra lateral ================= */}
      {conBarra && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => {
              setActivo(null);
              setVista('inicio');
            }}
            className="flex items-center gap-2.5 px-4 py-5 text-left"
          >
            {marca(false)}
          </button>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
            {/* Las dos decisiones que no son el pedido: cómo se ve y para quién
                es. Todo lo demás de esta barra es historial o interruptores. */}
            <div className="space-y-0.5">
              <button
                onClick={() => setVista('diseno')}
                className={itemLateral(vista === 'diseno')}
              >
                Diseño
              </button>
              <button
                onClick={() => setVista('aquien')}
                className={itemLateral(vista === 'aquien')}
              >
                A quién
              </button>
            </div>

            {apps.length > 0 && (
              <div>
                <span className="mb-1.5 block px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Mis borradores
                </span>
                <ul className="space-y-0.5">
                  <li>
                    <button
                      onClick={() => {
                        setActivo(null);
                        setPedido('');
                        setAnclajePreferido(null);
                        setVista('construir');
                      }}
                      className={`${itemLateral(vista === 'construir' && !activo)} text-zinc-500`}
                    >
                      + Nuevo
                    </button>
                  </li>
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

            {/* Quién está adentro y cómo salir. Faltaba: BodyVibeTech construye
                cosas que quedan a nombre de quien las hizo, así que no saber
                con qué cuenta se está trabajando importa más acá que en otras
                pantallas. */}
            {usuario && (
              <div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                    {usuario.nombre || usuario.email}
                  </div>
                  <div className="truncate text-[10.5px] text-zinc-400">{usuario.email}</div>
                </div>
                <button
                  onClick={salir}
                  className="shrink-0 rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  title="Salir"
                  aria-label="Salir"
                >
                  <LogOut className="h-[14px] w-[14px]" />
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ================= Zona principal ================= */}
      <main className="relative min-w-0 flex-1">
        {/* En la portada no hay barra lateral, así que la sesión vive acá. Sin
            esto, la primera pantalla de todas no tiene forma de salir. */}
        {vista === 'inicio' && usuario && (
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <span className="text-[12px] text-zinc-500">{usuario.email}</span>
            <button
              onClick={salir}
              className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              title="Salir"
              aria-label="Salir"
            >
              <LogOut className="h-[14px] w-[14px]" />
            </button>
          </div>
        )}

        {estado && !estado.rolDisponible && (
          <p className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            El usuario de solo lectura de la base no está disponible: ningún app puede consultar
            datos.
          </p>
        )}

        {vista === 'inicio' && (
          <div className="mx-auto max-w-2xl px-6 pt-24">
            <div className="mb-12 flex items-center justify-center gap-3">{marca(true)}</div>
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
                  Agregar algo dentro de una pantalla actual de la plataforma.
                </span>
              </button>
            </div>
          </div>
        )}

        {vista === 'construir' && (
          <div className="mx-auto max-w-2xl px-6 pt-24">
            <h1 className="mb-6 text-center text-[26px] font-semibold tracking-tight">
              Cuéntanos qué quieres construir
            </h1>

            {/* Quien llegó desde «Modificar» ya eligió pantalla. Se lo recuerda
                acá —y se lo deja soltar— para que no escriba a ciegas creyendo
                que está haciendo un app suelto. */}
            {anclajePreferido && (
              <p className="mb-3 flex items-center gap-2 text-[12.5px] text-zinc-500">
                Va a quedar en:{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {anclajes.find((a) => a.id === anclajePreferido)?.nombre ?? anclajePreferido}
                </span>
                <button
                  onClick={() => setAnclajePreferido(null)}
                  className="text-[11.5px] underline hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  quitar
                </button>
              </p>
            )}

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
            <h1 className="mb-2 text-[22px] font-semibold tracking-tight">
              Modificar lo que ya existe
            </h1>
            <p className="mb-8 text-[13px] text-zinc-500">
              Estas son las pantallas de la plataforma donde se puede agregar algo. Elija una y
              cuéntenos qué quiere que muestre; al publicarlo queda incrustado ahí, al pie.
            </p>

            {/* La lista sale del catálogo de anclajes del servidor, no de una
                copia acá: son puntos que alguien instaló a mano en el código, y
                una lista paralela se desactualiza el día que se agrega uno. */}
            {anclajes.length === 0 ? (
              <p className="text-[13px] text-zinc-500">
                No se pudo traer la lista de pantallas. Recargue; si sigue igual, el servidor no
                está respondiendo.
              </p>
            ) : (
              <div className="space-y-6">
                {Object.entries(
                  anclajes.reduce<Record<string, AnclajeDisponible[]>>((mapa, a) => {
                    (mapa[a.pantalla] ??= []).push(a);
                    return mapa;
                  }, {})
                ).map(([pantalla, puntos]) => (
                  <div key={pantalla}>
                    <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      {NOMBRE_PANTALLA[pantalla] ?? pantalla}
                    </span>
                    <ul className="space-y-1">
                      {puntos.map((a) => (
                        <li key={a.id}>
                          <button
                            onClick={() => {
                              setAnclajePreferido(a.id);
                              setPedido('');
                              setVista('construir');
                            }}
                            className="w-full rounded-lg border border-zinc-200 p-3.5 text-left transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                          >
                            <span className="block text-[14px] font-medium">{a.nombre}</span>
                            <span className="mt-0.5 block text-[12.5px] text-zinc-500">
                              {a.descripcion}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 border-t border-zinc-200 pt-5 dark:border-zinc-800">
              <p className="text-[13px] text-zinc-500">
                ¿Lo que quiere cambiar es cómo se ve la plataforma —los colores, el espaciado— y no
                lo que muestra?{' '}
                <button
                  onClick={() => setVista('diseno')}
                  className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Eso está en Diseño
                </button>
                .
              </p>
            </div>
          </div>
        )}

        {vista === 'diseno' && (
          <div className="mx-auto max-w-2xl px-6 py-12">
            <h1 className="mb-2 text-[22px] font-semibold tracking-tight">Diseño</h1>
            <SelectorApariencia />
          </div>
        )}

        {vista === 'aquien' && (
          <div className="mx-auto max-w-2xl px-6 py-12">
            <h1 className="mb-2 text-[22px] font-semibold tracking-tight">A quién</h1>
            {activo ? (
              <>
                <p className="mb-4 text-[13px] text-zinc-500">
                  Quién va a ver «{activo.titulo}», y en qué pantalla queda.
                </p>
                <Publicar
                  app={activo}
                  onCambio={refrescarActivo}
                  anclajeInicial={anclajePreferido}
                />
              </>
            ) : (
              <p className="text-[13px] text-zinc-500">
                Primero construya algo. Cuando exista, acá elige quién lo ve —qué roles, qué
                sedes— y en qué pantalla queda incrustado.
              </p>
            )}
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
                onClick={() => setVista('aquien')}
                className="ml-auto rounded-md border border-zinc-200 px-3 py-1.5 text-[12.5px] dark:border-zinc-700"
              >
                {activo.estado === 'publicado' ? 'Publicado · en vivo' : 'A quién'}
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
                  ? 'El trabajo sigue en el servidor aunque cierre la pestaña.'
                  : '⌘/Ctrl + Enter también funciona.'}
              </p>

              {generando && <VentanaAvance avance={avance} />}
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

