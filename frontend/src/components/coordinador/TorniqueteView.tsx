// ============================================================================
// TorniqueteView — Tablero en vivo de jornada laboral (sección "Torniquete").
//
// Muestra, por sede, qué profesionales (médicos/coaches) están conectados AHORA
// a la plataforma, a qué hora entraron, a qué hora salieron y cuánto llevan
// conectados hoy. Es el "torniquete de entrada" que pidió la coordinación: la
// plataforma como reloj de jornada, no como registro de videollamadas.
//
// Fuente: GET /api/torniquete/board (se refresca cada 25s + al enfocar la
// ventana). "En línea" = la plataforma recibió un latido en los últimos 5 min.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, Fingerprint, RefreshCw } from 'lucide-react';
import torniqueteService, { BoardProfesional, BoardResult } from '../../services/torniquete.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import authService, { Sede } from '../../services/auth.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, MonoAvatar, initialsOf, avatarFotoFor } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const REFRESH_MS = 25_000;

/** Hoy en Colombia (UTC-5) como YYYY-MM-DD. */
function todayBogotaIso(): string {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers de formato (Colombia UTC-5)
// ---------------------------------------------------------------------------

/** Hora HH:MM en zona Colombia a partir de un ISO timestamptz. */
function horaCO(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  });
}

/** Duración legible a partir de minutos: "3h 12m", "45m", "—". */
function duracion(min: number): string {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Fecha larga en español a partir de YYYY-MM-DD (mediodía UTC para no cruzar día). */
function fechaLarga(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  });
}

// ---------------------------------------------------------------------------

export function TorniqueteView({ showToast }: Props) {
  const [board, setBoard] = useState<BoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fecha, setFecha] = useState<string>(() => todayBogotaIso());
  const todayIso = todayBogotaIso();
  const esHoy = fecha === todayIso;
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedesSel, setSedesSel] = useState<string[]>(() => {
    const user = authService.getUser();
    if (user) return user.esGlobal ? [] : user.sedes;
    const s = authService.getSedeId();
    return s ? [s] : [];
  });

  // Evita solaparse: si un refresh está en vuelo, no dispara otro.
  const inFlight = useRef(false);

  // Cargar sedes (una vez). Sin selección previa → todas.
  useEffect(() => {
    authService
      .getSedes()
      .then((s) => {
        setSedes(s);
        setSedesSel((cur) => (cur.length > 0 ? cur : s.map((x) => x.sedeId)));
      })
      .catch(() => {});
  }, []);

  // Fotos reales de los profesionales: se traen APARTE (una vez por sede), no
  // en el poll del tablero, para mantener el board liviano (ver por qué se quitó
  // `foto` del payload en torniquete.service). Se cruzan por código en la fila.
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  useEffect(() => {
    if (sedesSel.length === 0) return;
    profesionalesService
      .list({ activo: true, sedes: sedesSel })
      .then(setProfesionales)
      .catch(() => {});
  }, [sedesSel]);

  // Foto real del profesional (si la tiene); si no, cae al pool placeholder.
  const fotoDe = useCallback(
    (codigo: string): string | null => {
      const p = profesionales.find((x) => x.codigo === codigo);
      return p?.foto || avatarFotoFor(codigo);
    },
    [profesionales]
  );

  const reload = useCallback(
    async (silent = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await torniqueteService.getBoard(sedesSel.length > 0 ? sedesSel : undefined, fecha);
        setBoard(res);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: { message?: string } } } };
        if (!silent) {
          showToast({ type: 'error', message: e?.response?.data?.error?.message || 'Error cargando el torniquete.' });
        }
      } finally {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sedesSel, fecha, showToast]
  );

  // Recarga al cambiar de sede/fecha. Polling en vivo + refresco al enfocar SOLO
  // para el día de hoy; un día pasado es estático (no tiene sentido refrescarlo).
  useEffect(() => {
    reload(false);
    if (!esHoy) return;
    const interval = window.setInterval(() => reload(true), REFRESH_MS);
    const onFocus = () => reload(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload, esHoy]);

  const profs = board?.profesionales ?? [];
  const enLinea = board?.ahoraEnLinea ?? 0;
  const conectadosHoy = profs.filter((p) => p.jornadas > 0).length;
  const noConectados = profs.filter((p) => p.jornadas === 0).length;

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 flex items-center gap-2">
          <Fingerprint className="w-5 h-5 text-[#1f3a8a]" />
          Torniquete
        </h1>
        <button
          type="button"
          onClick={() => reload(true)}
          className="inline-flex items-center gap-1.5 h-[30px] px-3 rounded-md border border-zinc-300 bg-white text-[12.5px] font-medium text-zinc-600 hover:bg-zinc-50"
          title="Actualizar"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>
      <p className="text-[13px] text-zinc-500 mb-5">
        Entrada y salida de los profesionales en la plataforma
        <span className="text-zinc-400"> · {fechaLarga(fecha)}</span>
        {esHoy ? (
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-green-700 align-middle">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            en vivo
          </span>
        ) : (
          <span className="ml-2 text-[11px] font-medium text-zinc-400 align-middle">histórico</span>
        )}
      </p>

      {/* Filtros: sede + día */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <SedeMultiSelect sedes={sedes} value={sedesSel} onChange={setSedesSel} />
        <DateField value={fecha} max={todayIso} onChange={setFecha} />
        {!esHoy && (
          <button
            type="button"
            onClick={() => setFecha(todayIso)}
            className="h-[30px] px-3 rounded-md border border-zinc-200 bg-white text-[12.5px] font-medium text-[#1e3a8a] hover:bg-zinc-50"
          >
            Volver a hoy
          </button>
        )}
      </div>

      {/* Resumen */}
      <div
        className={`grid grid-cols-2 ${
          esHoy ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
        } border border-zinc-200 rounded-xl bg-white overflow-hidden divide-x divide-y sm:divide-y-0 divide-zinc-200 mb-6`}
      >
        {esHoy && (
          <Stat label="En línea ahora" value={enLinea} accent="green" pulse={enLinea > 0} loading={loading} />
        )}
        <Stat label="Se conectaron" value={conectadosHoy} accent="ink" loading={loading} />
        <Stat label="No se conectaron" value={noConectados} accent="red" loading={loading} />
        <Stat label="Profesionales" value={profs.length} accent="zinc" loading={loading} />
      </div>

      {/* Tabla */}
      <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ fontFamily: FONT_INTER }}>
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 text-[11px] uppercase tracking-[0.06em]">
                <th className="text-left font-semibold px-4 py-2.5">Profesional</th>
                <th className="text-left font-semibold px-4 py-2.5">Estado</th>
                <th className="text-right font-semibold px-4 py-2.5">Entrada</th>
                <th className="text-right font-semibold px-4 py-2.5">Salida</th>
                <th className="text-left font-semibold px-4 py-2.5">Jornada (05:00 – 20:00)</th>
                <th className="text-right font-semibold px-4 py-2.5">Conectado hoy</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                    Cargando…
                  </td>
                </tr>
              ) : profs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                    No hay profesionales activos en la(s) sede(s) seleccionada(s).
                  </td>
                </tr>
              ) : (
                profs.map((p) => (
                  <FilaProfesional
                    key={`${p.sedeId}-${p.codigo}`}
                    p={p}
                    esHoy={esHoy}
                    foto={fotoDe(p.codigo)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilaProfesional
// ---------------------------------------------------------------------------

function FilaProfesional({
  p,
  esHoy,
  foto,
}: {
  p: BoardProfesional;
  esHoy: boolean;
  foto: string | null;
}) {
  const seConecto = p.jornadas > 0;
  const [abierto, setAbierto] = useState(false);
  const tramos = p.tramos ?? [];
  // Solo las citas que YA pasaron. Una cita de las 15:40 vista a las 13:00 no
  // es un incumplimiento: todavía no ocurre. Marcarla en rojo por adelantado
  // convertía media agenda del día en una acusación falsa.
  // En un día pasado no se filtra nada: todas ya ocurrieron.
  const ahora = Date.now();
  const citas = (p.citas ?? []).filter(
    (c) => !esHoy || new Date(c.hora).getTime() <= ahora
  );
  const hayDetalle = tramos.length > 0 || citas.length > 0;

  return (
    <>
    <tr className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <MonoAvatar
            initials={initialsOf(p.nombre)}
            src={foto}
            size={30}
            variant="default"
          />
          <div className="min-w-0">
            <div className="font-medium text-zinc-800 truncate">{p.nombre}</div>
            <div className="text-[11px] text-zinc-400">
              {p.codigo}
              {p.rol ? ` · ${p.rol === 'coach' ? 'Coach' : 'Médico'}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        {esHoy && p.enLinea ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-green-700">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-75 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-green-500" />
            </span>
            En línea
            {p.enLineaDesde ? (
              <span className="text-zinc-400 font-normal">· desde {horaCO(p.enLineaDesde)}</span>
            ) : null}
          </span>
        ) : seConecto ? (
          // Hoy y ya desconectado → "Desconectado"; día pasado → "Trabajó".
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500">
            <span className={`w-2 h-2 rounded-full ${esHoy ? 'bg-zinc-300' : 'bg-emerald-400'}`} />
            {esHoy ? 'Desconectado' : 'Trabajó'}
            {!esHoy && p.jornadas > 1 ? (
              <span className="text-zinc-400 font-normal">· {p.jornadas} tramos</span>
            ) : null}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-red-600/80">
            <span className="w-2 h-2 rounded-full border border-red-300" />
            {esHoy ? 'No se ha conectado' : 'No se conectó'}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700" style={{ fontFamily: FONT_MONO }}>
        {seConecto ? horaCO(p.primeraEntrada) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700" style={{ fontFamily: FONT_MONO }}>
        {esHoy && p.enLinea ? (
          <span className="text-zinc-300">en curso</span>
        ) : seConecto ? (
          horaCO(p.ultimaSalida)
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2.5 w-[38%] min-w-[220px]">
        {hayDetalle ? (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="w-full text-left cursor-pointer"
            title={abierto ? 'Ocultar detalle' : 'Ver el detalle de la jornada'}
            aria-expanded={abierto}
          >
            <LineaJornada tramos={tramos} citas={citas} />
          </button>
        ) : (
          <LineaJornada tramos={tramos} citas={citas} />
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-900" style={{ fontFamily: FONT_MONO }}>
        {duracion(p.minutosConectado)}
      </td>
    </tr>
    {abierto && (
      <tr className="border-b border-zinc-100 bg-zinc-50/70">
        <td colSpan={6} className="px-4 py-3">
          {/* La sección se abre desde la barra, pero adentro no había con qué
              cerrarla: quien llegaba scrolleando al detalle no tenía salida a
              la vista. El botón cierra la misma sección que abrió la barra. */}
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="text-[12px] font-medium text-zinc-600">
              Jornada de {p.nombre} · {p.codigo}
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-800 border border-zinc-300 rounded px-2 py-0.5 shrink-0"
            >
              Cerrar ✕
            </button>
          </div>
          <DetalleJornada tramos={tramos} citas={citas} />
        </td>
      </tr>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// LineaJornada — cuándo estuvo conectado, y dónde caen sus citas
//
// El total de minutos dice CUÁNTO estuvo; esto dice CUÁNDO. Es la diferencia
// entre "trabajó 1h 26m" y "no estaba a las 9:40, que es cuando su afiliada
// entró a esperarlo". Una cita fuera de toda franja se pinta en rojo: es
// exactamente el caso que hay que poder ver de un vistazo.
// ---------------------------------------------------------------------------

const HORA_INI = 5;  // 05:00
const HORA_FIN = 20; // 20:00
const MIN_TOTAL = (HORA_FIN - HORA_INI) * 60;

/** Minutos desde las 05:00 en hora Colombia; null si cae fuera de la ventana. */
function minutosDesdeInicio(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(partes.find((x) => x.type === 'hour')?.value ?? NaN);
  const m = Number(partes.find((x) => x.type === 'minute')?.value ?? NaN);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return (h - HORA_INI) * 60 + m;
}

const pct = (min: number) => Math.max(0, Math.min(100, (min / MIN_TOTAL) * 100));

function LineaJornada({
  tramos,
  citas,
}: {
  tramos: Array<{ desde: string; hasta: string }>;
  citas: Array<{ hora: string; paciente: string; atendida: boolean }>;
}) {
  if (tramos.length === 0 && citas.length === 0) {
    return <span className="text-zinc-300 text-[12px]">—</span>;
  }

  const franjas = tramos
    .map((t) => ({ ini: minutosDesdeInicio(t.desde), fin: minutosDesdeInicio(t.hasta) }))
    .filter((f): f is { ini: number; fin: number } => f.ini !== null && f.fin !== null);

  /** ¿La cita cayó dentro de alguna franja de conexión? */
  const cubierta = (min: number) => franjas.some((f) => min >= f.ini && min <= f.fin);

  return (
    <div>
      <div className="relative h-5 rounded bg-zinc-100 overflow-hidden">
        {franjas.map((f, i) => (
          <div
            key={`t${i}`}
            className="absolute top-0 bottom-0 bg-emerald-400/70"
            style={{ left: `${pct(f.ini)}%`, width: `${Math.max(0.6, pct(f.fin) - pct(f.ini))}%` }}
          />
        ))}
        {citas.map((c, i) => {
          const min = minutosDesdeInicio(c.hora);
          if (min === null) return null;
          const ok = c.atendida || cubierta(min);
          const hora = new Intl.DateTimeFormat('es-CO', {
            timeZone: 'America/Bogota',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(c.hora));
          return (
            <div
              key={`c${i}`}
              title={`${hora} · ${c.paciente}${
                c.atendida ? ' · atendida' : ok ? '' : ' · el coach NO estaba conectado'
              }`}
              className={`absolute top-0 bottom-0 w-[2px] ${ok ? 'bg-zinc-500/60' : 'bg-red-500'}`}
              style={{ left: `${pct(min)}%` }}
            />
          );
        })}
      </div>
      <div
        className="flex justify-between text-[9px] text-zinc-400 mt-0.5 tabular-nums"
        style={{ fontFamily: FONT_MONO }}
      >
        <span>05</span>
        <span>09</span>
        <span>12</span>
        <span>16</span>
        <span>20</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetalleJornada — la misma franja, pero legible
//
// La barra sirve para ver de un vistazo si hay huecos; para reclamarle a alguien
// (o defenderlo) hacen falta las horas exactas. Acá van los tramos con su hora
// de inicio, fin y duración, y cada cita con el veredicto: si el coach estaba
// conectado a esa hora o no.
// ---------------------------------------------------------------------------

function DetalleJornada({
  tramos,
  citas,
}: {
  tramos: Array<{ desde: string; hasta: string }>;
  citas: Array<{ hora: string; paciente: string; atendida: boolean }>;
}) {
  const franjas = tramos
    .map((t) => ({ ini: minutosDesdeInicio(t.desde), fin: minutosDesdeInicio(t.hasta) }))
    .filter((f): f is { ini: number; fin: number } => f.ini !== null && f.fin !== null);
  const cubierta = (min: number) => franjas.some((f) => min >= f.ini && min <= f.fin);

  // Los tramos se pliegan: un coach que entra y sale seguido puede tener 20 o
  // más en un día y la lista tapaba las citas, que es lo que se viene a mirar.
  // Con pocos se abren solos; con muchos hay que pedirlos.
  const [verTramos, setVerTramos] = useState(tramos.length <= 6);

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <button
          type="button"
          onClick={() => setVerTramos((v) => !v)}
          disabled={tramos.length === 0}
          className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 mb-1.5 flex items-center gap-1 hover:text-zinc-700 disabled:hover:text-zinc-500 disabled:cursor-default"
          aria-expanded={verTramos}
        >
          <span className={`transition-transform ${verTramos ? 'rotate-90' : ''}`}>›</span>
          Tramos conectado ({tramos.length})
        </button>
        {tramos.length === 0 ? (
          <div className="text-[12px] text-zinc-400">No se conectó en todo el día.</div>
        ) : !verTramos ? (
          <div className="text-[12px] text-zinc-400">
            {horaCO(tramos[0].desde)} – {horaCO(tramos[tramos.length - 1].hasta)} · clic para ver
            los {tramos.length} tramos
          </div>
        ) : (
          <ul className="space-y-1">
            {tramos.map((t, i) => {
              const ini = minutosDesdeInicio(t.desde);
              const fin = minutosDesdeInicio(t.hasta);
              const mins = ini !== null && fin !== null ? Math.max(0, Math.round(fin - ini)) : 0;
              return (
                <li
                  key={`d${i}`}
                  className="flex items-center gap-2 text-[12px] text-zinc-700 tabular-nums"
                  style={{ fontFamily: FONT_MONO }}
                >
                  <span className="inline-block w-2 h-2 rounded-sm bg-emerald-400/80 shrink-0" />
                  <span>
                    {horaCO(t.desde)} – {horaCO(t.hasta)}
                  </span>
                  <span className="text-zinc-400">
                    ({mins < 1 ? 'menos de 1 min' : duracion(mins)})
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 mb-1.5">
          Citas del día ({citas.length})
        </div>
        {citas.length === 0 ? (
          <div className="text-[12px] text-zinc-400">Sin citas agendadas.</div>
        ) : (
          <ul className="space-y-1">
            {citas.map((c, i) => {
              const min = minutosDesdeInicio(c.hora);
              const ok = c.atendida || (min !== null && cubierta(min));
              return (
                <li key={`q${i}`} className="flex items-start gap-2 text-[12px]">
                  <span
                    className={`inline-block w-2 h-2 rounded-sm shrink-0 mt-1 ${
                      ok ? 'bg-zinc-400' : 'bg-red-500'
                    }`}
                  />
                  <span className="tabular-nums text-zinc-700" style={{ fontFamily: FONT_MONO }}>
                    {horaCO(c.hora)}
                  </span>
                  <span className="text-zinc-700 truncate">{c.paciente || 'Sin nombre'}</span>
                  <span className={ok ? 'text-zinc-400' : 'text-red-600 font-medium'}>
                    {c.atendida
                      ? '· atendida'
                      : ok
                        ? '· estaba conectado'
                        : '· NO estaba conectado'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  accent,
  pulse = false,
  loading,
}: {
  label: string;
  value: number;
  accent: 'green' | 'ink' | 'red' | 'zinc';
  pulse?: boolean;
  loading: boolean;
}) {
  const dot =
    accent === 'green' ? 'bg-green-500' : accent === 'red' ? 'bg-red-500' : accent === 'zinc' ? 'bg-zinc-400' : 'bg-[#1f3a8a]';
  const valCls =
    accent === 'green' ? 'text-green-700' : accent === 'red' ? 'text-red-700' : accent === 'zinc' ? 'text-zinc-700' : 'text-zinc-900';
  return (
    <div className="px-6 py-4" style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot} ${pulse ? 'animate-pulse' : ''}`} />
        <span className={SECTION_LABEL}>{label}</span>
      </div>
      <div className={`mt-1.5 text-[30px] font-semibold tabular-nums leading-none ${valCls}`}>
        {loading ? '—' : value.toLocaleString('es-CO')}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateField — selector de UN día (no rango: las horas de entrada/salida son
// por día). `max` = hoy para no permitir fechas futuras.
// ---------------------------------------------------------------------------

function DateField({
  value,
  max,
  onChange,
}: {
  value: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="relative inline-flex items-center h-[30px] rounded-md border border-zinc-300 bg-white text-[12.5px] font-medium"
      style={{ fontFamily: FONT_INTER }}
    >
      <span className="pl-[11px] pr-1 font-normal text-zinc-500">Día:</span>
      <input
        type="date"
        value={value}
        max={max}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="appearance-none bg-transparent pr-2.5 h-[30px] outline-none text-[12.5px] font-medium cursor-pointer text-zinc-800"
        style={{ fontFamily: FONT_INTER }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SedeMultiSelect (mismo patrón que IndicadoresView / CalendarioView)
// ---------------------------------------------------------------------------

function SedeMultiSelect({
  sedes,
  value,
  onChange,
}: {
  sedes: Sede[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const allIds = sedes.map((s) => s.sedeId);
  const allSelected = sedes.length > 0 && allIds.every((id) => value.includes(id));

  const resumen = (() => {
    if (sedes.length > 0 && allSelected) return 'Todas las sedes';
    if (value.length === 0) return 'Sin sede';
    if (value.length === 1) {
      const s = sedes.find((x) => x.sedeId === value[0]);
      return s ? s.nombre : value[0];
    }
    return `${value.length} sedes`;
  })();

  function toggle(id: string) {
    if (value.includes(id)) {
      const next = value.filter((x) => x !== id);
      onChange(next.length > 0 ? next : value);
    } else {
      onChange([...value, id]);
    }
  }

  function toggleTodas() {
    onChange(allSelected ? (allIds.length > 0 ? [allIds[0]] : value) : allIds);
  }

  const active = !(sedes.length > 0 && allSelected);
  const stateCls = active ? 'bg-[#eef2ff] text-[#1e3a8a]' : 'bg-white text-zinc-800';
  const borderColor = active ? '#1f3a8a' : '#d4d4d8';

  return (
    <div className="relative inline-block" style={{ fontFamily: FONT_INTER }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center h-[30px] rounded-md border text-[12.5px] font-medium pl-[11px] pr-2 ${stateCls}`}
        style={{ borderColor }}
      >
        <span className={`pr-1 font-normal ${active ? 'text-[#1e3a8a]/70' : 'text-zinc-500'}`}>Sede:</span>
        {resumen}
        <ChevronDown className="w-3 h-3 text-zinc-400 ml-1.5" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Cerrar" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 z-50 w-64 max-h-72 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-lg py-1">
            <label className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-800 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleTodas}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium">Todas las sedes</span>
            </label>
            {sedes.map((s) => (
              <label
                key={s.sedeId}
                className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={value.includes(s.sedeId)}
                  onChange={() => toggle(s.sedeId)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="truncate">
                  {s.nombre}
                  {s.ciudad ? <span className="text-zinc-400"> · {s.ciudad}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
