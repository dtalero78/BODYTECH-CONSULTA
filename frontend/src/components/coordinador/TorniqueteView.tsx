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
import authService, { Sede } from '../../services/auth.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, MonoAvatar, initialsOf, avatarFotoFor } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const REFRESH_MS = 25_000;

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

  const reload = useCallback(
    async (silent = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await torniqueteService.getBoard(sedesSel.length > 0 ? sedesSel : undefined);
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
    [sedesSel, showToast]
  );

  // Recarga al cambiar de sede + polling en vivo + refresco al enfocar la ventana.
  useEffect(() => {
    reload(false);
    const interval = window.setInterval(() => reload(true), REFRESH_MS);
    const onFocus = () => reload(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

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
        {board?.fecha ? <span className="text-zinc-400"> · {fechaLarga(board.fecha)}</span> : null}
      </p>

      {/* Filtro de sede */}
      <div className="mb-4">
        <SedeMultiSelect sedes={sedes} value={sedesSel} onChange={setSedesSel} />
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-zinc-200 rounded-xl bg-white overflow-hidden divide-x divide-y sm:divide-y-0 divide-zinc-200 mb-6">
        <Stat label="En línea ahora" value={enLinea} accent="green" pulse={enLinea > 0} loading={loading} />
        <Stat label="Se conectaron hoy" value={conectadosHoy} accent="ink" loading={loading} />
        <Stat label="No se han conectado" value={noConectados} accent="red" loading={loading} />
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
                <th className="text-right font-semibold px-4 py-2.5">Conectado hoy</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    Cargando…
                  </td>
                </tr>
              ) : profs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    No hay profesionales activos en la(s) sede(s) seleccionada(s).
                  </td>
                </tr>
              ) : (
                profs.map((p) => <FilaProfesional key={`${p.sedeId}-${p.codigo}`} p={p} />)
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

function FilaProfesional({ p }: { p: BoardProfesional }) {
  const seConecto = p.jornadas > 0;
  return (
    <tr className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <MonoAvatar
            initials={initialsOf(p.nombre)}
            src={avatarFotoFor(p.codigo)}
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
        {p.enLinea ? (
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
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-zinc-300" />
            Desconectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-red-600/80">
            <span className="w-2 h-2 rounded-full border border-red-300" />
            No se ha conectado
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700" style={{ fontFamily: FONT_MONO }}>
        {seConecto ? horaCO(p.primeraEntrada) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700" style={{ fontFamily: FONT_MONO }}>
        {p.enLinea ? <span className="text-zinc-300">en curso</span> : seConecto ? horaCO(p.ultimaSalida) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-900" style={{ fontFamily: FONT_MONO }}>
        {duracion(p.minutosConectado)}
      </td>
    </tr>
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
