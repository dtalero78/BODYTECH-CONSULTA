// ============================================================================
// AccAgendaPage — "a quién le toca hoy", para el fisioterapeuta.
//
// Es la pantalla desde la que arranca el día. El evaluador llega con el celular
// en la mano y necesita dos cosas antes de tocar nada: a quién le toca, y a
// quién YA midió. Sin lo segundo abriría un formulario en blanco sobre alguien
// ya valorado y crearía un duplicado que después hay que rastrear a mano.
//
// Por qué no es solo la lista del día: la cohorte de Sol Médica se carga desde
// el panel de coordinador y las citas se agendan ahí mismo. Mientras eso no
// exista, `cita_fecha` está vacío para todos y un listado estrictamente
// filtrado por hoy sería una pantalla en blanco permanente. Por eso hay
// buscador, un filtro "Todos" y una salida siempre disponible —"Nueva
// valoración"— que no depende de que nadie haya agendado nada.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ChevronRight, CalendarDays, RefreshCw, FileText } from 'lucide-react';
import accService, { type AccPaciente } from '../services/acc.service';
import { FONT_INTER, MonoAvatar, Pill, PILLS, initialsOf } from '../components/coordinador/_tokens';

/** Hoy en Colombia (UTC-5). El servidor corre en UTC: no sirve `new Date()`. */
function hoyColombia(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d} ${meses[m - 1]} ${y}`;
}

/** Hora de la cita en Colombia. La columna es timestamptz. */
function horaCita(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
  });
}

// El estado del embudo, traducido a algo que el evaluador lea de un vistazo.
const ESTADO_META: Record<string, { label: string; pill: keyof typeof PILLS }> = {
  cargado: { label: 'Sin contactar', pill: 'mute' },
  contactado: { label: 'Contactado', pill: 'mute' },
  agendado: { label: 'Agendado', pill: 'now' },
  confirmado: { label: 'Confirmado', pill: 'ok' },
  asistio: { label: 'Asistió', pill: 'ok' },
  no_show: { label: 'No asistió', pill: 'bad' },
  descartado: { label: 'Descartado', pill: 'mute' },
};

type Filtro = 'hoy' | 'todos';

export function AccAgendaPage() {
  const navigate = useNavigate();
  const hoy = useMemo(() => hoyColombia(), []);

  const [filtro, setFiltro] = useState<Filtro>('hoy');
  const [busqueda, setBusqueda] = useState('');
  const [pacientes, setPacientes] = useState<AccPaciente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const q = busqueda.trim();
      const lista = await accService.listarPacientes({
        // Buscar por nombre pierde sentido si además se acota al día: quien
        // busca a alguien por cédula lo quiere encontrar aunque no tenga cita.
        ...(filtro === 'hoy' && !q ? { fecha: hoy } : {}),
        ...(q ? { q } : {}),
      });
      setPacientes(lista);
    } catch {
      setError('No se pudo cargar la lista. Revisá la conexión.');
    } finally {
      setCargando(false);
    }
  }, [filtro, busqueda, hoy]);

  // Debounce: el buscador dispara con cada tecla.
  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 350 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  /**
   * A dónde lleva tocar una fila. Si ya tiene una valoración de HOY se abre esa
   * —continuar el borrador o ver lo que se midió— en vez de empezar de cero.
   * Una valoración de otro día no se reabre: hoy es una medición nueva.
   */
  const abrir = (p: AccPaciente) => {
    const v = p.ultimaValoracion;
    if (v && v.fechaEvaluacion === hoy) {
      navigate(`/acc/valoracion/${v.id}`);
      return;
    }
    // `pacienteId` es el que ata la valoración a la cohorte de Sol Médica: sin
    // él, cerrarla no marca al paciente como «asistió» y el embudo no avanza.
    const params = new URLSearchParams({
      numeroId: p.numeroId,
      pacienteId: String(p.id),
    });
    if (p.nombreCompleto) params.set('nombre', p.nombreCompleto);
    if (p.edad != null) params.set('edad', String(p.edad));
    if (p.sexo) params.set('sexo', p.sexo);
    navigate(`/acc/valoracion?${params.toString()}`);
  };

  const buscando = busqueda.trim().length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 pb-24" style={{ fontFamily: FONT_INTER }}>
      <header className="sticky top-0 z-20 bg-white border-b border-zinc-200">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.09em] text-zinc-400 font-semibold">
              Valoración Corporal ACC
            </div>
            <div className="text-[13px] font-semibold text-zinc-800">
              {buscando ? 'Búsqueda' : filtro === 'hoy' ? `Hoy · ${fechaLarga(hoy)}` : 'Todos los pacientes'}
            </div>
          </div>
          <button
            onClick={cargar}
            className="p-2 rounded-lg text-zinc-400 active:bg-zinc-100"
            aria-label="Actualizar"
          >
            <RefreshCw className={`w-[18px] h-[18px] ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="px-3 pb-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o cédula"
              inputMode="search"
              className="w-full h-9 pl-8 pr-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
            />
          </div>
          {!buscando && (
            <div className="flex bg-zinc-100 rounded-lg p-0.5 shrink-0">
              {(['hoy', 'todos'] as Filtro[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`px-2.5 h-8 rounded-[6px] text-[12.5px] font-medium transition-colors ${
                    filtro === f ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500'
                  }`}
                >
                  {f === 'hoy' ? 'Hoy' : 'Todos'}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="px-3 pt-3">
        {error && (
          <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl text-[12.5px] text-red-800">
            {error}
          </div>
        )}

        {cargando && pacientes.length === 0 && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[68px] bg-white border border-zinc-200 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {!cargando && pacientes.length === 0 && (
          <EstadoVacio buscando={buscando} filtro={filtro} onVerTodos={() => setFiltro('todos')} />
        )}

        <ul className="space-y-2">
          {pacientes.map((p) => {
            const meta = ESTADO_META[p.estado] ?? { label: p.estado, pill: 'mute' as const };
            const hora = horaCita(p.citaFecha);
            const v = p.ultimaValoracion;
            const valoradaHoy = v?.fechaEvaluacion === hoy;
            return (
              <li key={p.id}>
                <button
                  onClick={() => abrir(p)}
                  className="w-full flex items-center gap-3 bg-white border border-zinc-200 rounded-xl p-3 text-left active:bg-zinc-50 transition-colors"
                >
                  <MonoAvatar initials={initialsOf(p.nombreCompleto)} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-zinc-800 truncate">
                      {p.nombreCompleto}
                    </div>
                    <div className="text-[11.5px] text-zinc-500 tabular-nums truncate">
                      {p.numeroId}
                      {p.edad != null && ` · ${p.edad} años`}
                      {p.empresa && ` · ${p.empresa}`}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {hora && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 tabular-nums">
                          <CalendarDays className="w-3 h-3" />
                          {hora}
                        </span>
                      )}
                      <Pill variant={meta.pill}>{meta.label}</Pill>
                      {valoradaHoy && (
                        <Pill variant={v!.estado === 'cerrada' ? 'ok' : 'warn'}>
                          {v!.estado === 'cerrada' ? 'Valorada hoy' : 'Borrador'}
                        </Pill>
                      )}
                      {v && !valoradaHoy && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                          <FileText className="w-3 h-3" />
                          Última: {v.fechaEvaluacion}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-300 shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      </main>

      {/* Siempre disponible: el evaluador puede medir a alguien que no está en
          ninguna cohorte (un walk-in), y hoy es además la única vía posible. */}
      <div className="fixed bottom-0 inset-x-0 p-3 bg-gradient-to-t from-zinc-50 via-zinc-50 to-transparent">
        <button
          onClick={() => navigate('/acc/valoracion')}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-white"
          style={{ backgroundColor: '#1f3a8a' }}
        >
          <Plus className="w-4 h-4" />
          Nueva valoración
        </button>
      </div>
    </div>
  );
}

function EstadoVacio({
  buscando,
  filtro,
  onVerTodos,
}: {
  buscando: boolean;
  filtro: Filtro;
  onVerTodos: () => void;
}) {
  if (buscando) {
    return (
      <Vacio titulo="Sin resultados">
        Nadie con ese nombre o cédula en la cohorte. Si es un paciente nuevo, usá
        “Nueva valoración”.
      </Vacio>
    );
  }
  if (filtro === 'hoy') {
    return (
      <Vacio titulo="Nadie agendado para hoy">
        Las citas se agendan desde el panel de coordinador. Mientras tanto podés{' '}
        <button onClick={onVerTodos} className="underline font-medium text-zinc-700">
          ver todos los pacientes
        </button>{' '}
        o empezar una valoración suelta.
      </Vacio>
    );
  }
  return (
    <Vacio titulo="No hay pacientes cargados">
      La cohorte de Sol Médica se carga desde el panel de coordinador. Igual podés
      medir a alguien con “Nueva valoración”.
    </Vacio>
  );
}

function Vacio({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl px-4 py-8 text-center">
      <div className="text-[13.5px] font-semibold text-zinc-700 mb-1">{titulo}</div>
      <p className="text-[12.5px] text-zinc-500 leading-relaxed max-w-[38ch] mx-auto">{children}</p>
    </div>
  );
}

export default AccAgendaPage;
