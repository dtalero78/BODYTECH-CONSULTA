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

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import authService from '../services/auth.service';
import AppSandbox, { ResultadoConsulta } from '../components/bodyvibe/AppSandbox';
import { Bandeja, Publicar } from '../components/bodyvibe/PanelPublicacion';
import { SelectorApariencia } from '../components/bodyvibe/SelectorApariencia';
import VentanaAvance from '../components/bodyvibe/VentanaAvance';
import FondoDegradado from '../components/bodyvibe/FondoDegradado';
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

  const [menuBorradores, setMenuBorradores] = useState(false);
  const cajaBorradores = useRef<HTMLDivElement | null>(null);
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

  // El desplegable se cierra al hacer clic afuera; si no, queda abierto tapando
  // justo lo que se acaba de elegir.
  useEffect(() => {
    if (!menuBorradores) return;
    // Solo los clics de AFUERA cierran. Cerrar con cualquier `mousedown`
    // desmonta el menú antes de que el `click` llegue al borrador elegido, y
    // entonces elegir uno no hace nada: se cierra y ya.
    const alClic = (e: MouseEvent) => {
      if (!cajaBorradores.current?.contains(e.target as Node)) setMenuBorradores(false);
    };
    document.addEventListener('mousedown', alClic);
    return () => document.removeEventListener('mousedown', alClic);
  }, [menuBorradores]);

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

  const itemBarra = (activa: boolean) =>
    `shrink-0 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
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
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ================= Barra superior ================= */}
      {conBarra && (
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <button
            onClick={() => {
              setActivo(null);
              setVista('inicio');
            }}
            className="mr-2 flex shrink-0 items-center gap-2.5"
          >
            {marca(false)}
          </button>

          <button
            onClick={() => {
              setActivo(null);
              setPedido('');
              setAnclajePreferido(null);
              setVista('construir');
            }}
            className={itemBarra(vista === 'construir' && !activo)}
          >
            + Nuevo
          </button>

          {/* Los borradores en un desplegable y no en fila: en una barra
              horizontal, cinco títulos largos empujan todo lo demás fuera de la
              pantalla. */}
          {apps.length > 0 && (
            <div className="relative" ref={cajaBorradores}>
              <button
                onClick={() => setMenuBorradores((v) => !v)}
                className={itemBarra(vista === 'app')}
              >
                {activo ? activo.titulo : 'Mis borradores'}
                <span className="ml-1.5 text-[10px] text-zinc-400">{apps.length}</span>
              </button>
              {menuBorradores && (
                <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {apps.map((a) => (
                    <div
                      key={a.id}
                      className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <button
                        onClick={() => {
                          setMenuBorradores(false);
                          abrir(a.id);
                        }}
                        className="min-w-0 flex-1 truncate text-left text-[12.5px]"
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={() => setVista('diseno')} className={itemBarra(vista === 'diseno')}>
            Diseño
          </button>
          <button onClick={() => setVista('aquien')} className={itemBarra(vista === 'aquien')}>
            A quién
          </button>

          {/* La bandeja solo existe si hay algo que aprobar, y solo para quien
              aprueba: al resto la API le devuelve vacío. */}
          {pendientes > 0 && (
            <button
              onClick={() => {
                setActivo(null);
                setVista('aprobaciones');
              }}
              className={itemBarra(vista === 'aprobaciones')}
            >
              Aprobaciones
              <span className="ml-1.5 rounded-full bg-zinc-900 px-1.5 text-[10.5px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                {pendientes}
              </span>
            </button>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {gasto && (
              <span className="hidden font-mono text-[10.5px] text-zinc-400 lg:inline">
                {dinero(gasto.gastadoUsd)} de {dinero(gasto.topeUsd)}
              </span>
            )}
            <button
              onClick={alternarInterruptor}
              className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              title={apagado ? 'BodyVibeTech está apagado' : 'BodyVibeTech está encendido'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${apagado ? 'bg-amber-500' : 'bg-emerald-500'}`}
              />
              <span className="hidden sm:inline">{apagado ? 'Apagado' : 'Encendido'}</span>
            </button>
            {usuario && (
              <>
                <span className="hidden text-[12px] text-zinc-500 lg:inline">{usuario.email}</span>
                <button
                  onClick={salir}
                  className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  title="Salir"
                  aria-label="Salir"
                >
                  <LogOut className="h-[14px] w-[14px]" />
                </button>
              </>
            )}
          </div>
        </header>
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
          <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
            <FondoDegradado />

            {/* Todo lo de acá abajo va sobre el degradado, no debajo. */}
            {/* La marca va arriba a la izquierda, como encabezado, no en el
                centro: el protagonista de la portada es el título. */}
            <div className="absolute left-5 top-4 flex items-center gap-2.5">{marca(false)}</div>

            <div className="relative w-full max-w-2xl">
              <h1 className="text-center text-[42px] font-semibold leading-[1.1] tracking-tight sm:text-[52px]">
                Crea algo muy BodyTech
              </h1>
              <p className="mt-3 text-center text-[15px] text-zinc-600 dark:text-zinc-300">
                Crea una nueva herramienta Bodytech, modifica las existentes o inventa un nuevo
                servicio.
              </p>

              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => setVista('construir')}
                  className="rounded-2xl bg-white p-5 text-left shadow-[0_14px_40px_-14px_rgba(24,24,27,0.3)] transition-transform hover:-translate-y-0.5 dark:bg-zinc-900"
                >
                  <span className="block text-[15px] font-medium">Construir algo nuevo</span>
                  <span className="mt-1 block text-[13px] text-zinc-500">
                    Un tablero, un reporte, una utilidad que hoy no existe.
                  </span>
                </button>
                <button
                  onClick={() => setVista('modificar')}
                  className="rounded-2xl bg-white p-5 text-left shadow-[0_14px_40px_-14px_rgba(24,24,27,0.3)] transition-transform hover:-translate-y-0.5 dark:bg-zinc-900"
                >
                  <span className="block text-[15px] font-medium">Modificar lo que ya existe</span>
                  <span className="mt-1 block text-[13px] text-zinc-500">
                    Agregar algo dentro de una pantalla actual de la plataforma.
                  </span>
                </button>
              </div>
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
          // Dos columnas: a la izquierda lo que se pide y lo que contesta, a la
          // derecha el resultado corriendo de verdad. Antes era una sola
          // columna con el app arriba y la caja abajo, así que al pedir un
          // cambio había que bajar a escribir y volver a subir a mirar.
          <div className="flex h-[calc(100vh-3.5rem)]">
            {/* ---------- Conversación ---------- */}
            <div className="flex w-[38%] min-w-[340px] flex-col border-r border-zinc-200 dark:border-zinc-800">
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {turnos.length === 0 && !generando && (
                  <p className="text-[13px] text-zinc-500">
                    Pide un cambio y aparece a la derecha.
                  </p>
                )}

                {turnos.map((t, i) => (
                  <div key={i} className="space-y-2">
                    {/* Lo que pidió la persona, a la derecha; lo que contestó,
                        a la izquierda. Es la convención de cualquier chat. */}
                    <div className="flex justify-end">
                      <p className="max-w-[88%] rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-[13px] text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {t.pedido}
                      </p>
                    </div>
                    {t.notas && (
                      <div className="flex justify-start">
                        <p className="max-w-[92%] rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 text-[13px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {t.notas}
                        </p>
                      </div>
                    )}
                    {typeof t.costoUsd === 'number' && (
                      <p className="pl-1 font-mono text-[10.5px] text-zinc-400">
                        {dinero(t.costoUsd)}
                      </p>
                    )}
                  </div>
                ))}

                {generando && <VentanaAvance avance={avance} />}

                {error && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    {error}
                  </div>
                )}

                {versiones.length > 1 && (
                  <details className="pt-2">
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

              <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
                <div className="rounded-xl border border-zinc-200 focus-within:border-zinc-400 dark:border-zinc-700">
                  <textarea
                    value={pedido}
                    onChange={(e) => setPedido(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        generar();
                      }
                    }}
                    rows={2}
                    disabled={generando || apagado}
                    placeholder={
                      activo.codigo ? '¿Qué quieres cambiar?' : 'Cuéntanos qué quieres que muestre'
                    }
                    className="w-full resize-none rounded-t-xl bg-transparent px-3 py-2.5 text-[13.5px] outline-none disabled:opacity-50"
                  />
                  <div className="flex items-center justify-between px-2 pb-2">
                    <span className="pl-1 text-[11px] text-zinc-400">
                      {generando ? 'Sigue en el servidor aunque cierres la pestaña.' : 'Enter envía'}
                    </span>
                    <button
                      onClick={generar}
                      disabled={generando || apagado || !pedido.trim()}
                      className="rounded-full bg-zinc-900 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {generando ? 'Construyendo…' : 'Enviar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ---------- Vista previa ---------- */}
            <div className="flex min-w-0 flex-1 flex-col bg-zinc-50 dark:bg-zinc-900/40">
              <div className="flex h-11 shrink-0 items-center gap-3 px-4">
                <span className="min-w-0 truncate text-[12.5px] font-medium">{activo.titulo}</span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                  v{activo.version}
                </span>
                <button
                  onClick={() => setVista('aquien')}
                  className="ml-auto shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-1 text-[12px] dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {activo.estado === 'publicado' ? 'Publicado · en vivo' : 'A quién'}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-tl-xl border-l border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                {activo.codigo ? (
                  <AppSandbox
                    codigo={activo.codigo}
                    ejecutarConsulta={ejecutarConsulta}
                    llenarAlto
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                    <p className="text-[14px] text-zinc-500">Tu aplicación va a aparecer acá</p>
                    <p className="text-[12.5px] text-zinc-400">
                      Cuéntale a la izquierda qué quieres que muestre.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

