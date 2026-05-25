import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Users,
  CheckCircle2,
  Clock,
  Stethoscope,
  X,
  UserCog,
  Download,
} from 'lucide-react';
import calendarioService, {
  MesResumen,
  DiaDetalle,
  CitaListItem,
} from '../../services/calendario.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import { ReasignarModal } from './ReasignarModal';
import { CalendarioStats } from './CalendarioStats';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Paleta pastel para diferenciar médicos. Se asigna por orden alfabético del
// código, así que el mismo médico siempre tiene el mismo color durante la sesión.
const PALETTE = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-teal-100 text-teal-700 border-teal-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
  'bg-cyan-100 text-cyan-700 border-cyan-200',
  'bg-emerald-100 text-emerald-700 border-emerald-200',
];

function colorFor(codigo: string, allCodes: string[]): string {
  const idx = allCodes.indexOf(codigo);
  return PALETTE[idx >= 0 ? idx % PALETTE.length : 0];
}

function todayInBogota(): { year: number; month: number; day: number; iso: string } {
  const nowUtc = new Date();
  // Colombia es UTC-5. Convertimos restando 5 horas y leemos como UTC.
  const ms = nowUtc.getTime() - 5 * 60 * 60 * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, iso };
}

function fechaIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

export function CalendarioView({ showToast }: Props) {
  const today = useMemo(() => todayInBogota(), []);
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [mesData, setMesData] = useState<MesResumen | null>(null);
  const [loadingMes, setLoadingMes] = useState(true);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [filterMedico, setFilterMedico] = useState<string>(''); // codigo o ''
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Cargar lista de profesionales para filtros y nombres
  useEffect(() => {
    profesionalesService
      .list({ activo: true })
      .then(setProfesionales)
      .catch(() => {});
  }, []);

  const reloadMes = useCallback(async () => {
    setLoadingMes(true);
    try {
      const data = await calendarioService.getMes(year, month, filterMedico || undefined);
      setMesData(data);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error?.message || 'Error cargando el mes.';
      showToast({ type: 'error', message: msg });
    } finally {
      setLoadingMes(false);
    }
  }, [year, month, filterMedico, showToast]);

  useEffect(() => {
    reloadMes();
  }, [reloadMes]);

  function prevMonth() {
    setSelectedDay(null);
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    setSelectedDay(null);
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function goToday() {
    setSelectedDay(today.iso);
    setYear(today.year);
    setMonth(today.month);
  }

  // Construir grid de 7 columnas
  const calendarCells = useMemo(() => {
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const startDow = firstDay.getUTCDay(); // 0-6 (Dom)
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const cells: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < startDow; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: fechaIso(year, month, d), day: d });
    }
    // Padding final para que el grid quede en filas completas (múltiplos de 7)
    while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
    return cells;
  }, [year, month]);

  // Códigos de médicos vistos en el mes (para color)
  const codigosVistos = useMemo(() => {
    if (!mesData) return [];
    const set = new Set<string>();
    for (const fecha of Object.keys(mesData.porDia)) {
      for (const codigo of Object.keys(mesData.porDia[fecha].porMedico)) {
        set.add(codigo);
      }
    }
    return Array.from(set).sort();
  }, [mesData]);

  function profesionalNombre(codigo: string): string {
    if (codigo === '__SIN_ASIGNAR__') return 'Sin asignar';
    const p = profesionales.find((x) => x.codigo === codigo);
    if (!p) return codigo;
    return p.alias || [p.primerNombre, p.primerApellido].filter(Boolean).join(' ');
  }

  if (selectedDay) {
    return (
      <DiaView
        fecha={selectedDay}
        medico={filterMedico || undefined}
        profesionales={profesionales}
        onBack={() => {
          setSelectedDay(null);
          reloadMes();
        }}
        showToast={showToast}
      />
    );
  }

  return (
    <div>
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Citas del mes"
          value={mesData?.totalCitas ?? 0}
          icon={<Users className="w-4 h-4" />}
          color="text-blue-600 bg-blue-50"
        />
        <StatCard
          label="Atendidas"
          value={mesData?.totalAtendidos ?? 0}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="text-green-600 bg-green-50"
        />
        <StatCard
          label="Pendientes"
          value={mesData?.totalPendientes ?? 0}
          icon={<Clock className="w-4 h-4" />}
          color="text-amber-600 bg-amber-50"
        />
        <StatCard
          label="Médicos activos"
          value={mesData?.medicosActivos ?? 0}
          icon={<Stethoscope className="w-4 h-4" />}
          color="text-purple-600 bg-purple-50"
        />
      </div>

      {/* Toolbar mes */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base font-semibold text-gray-800 min-w-[160px] text-center">
              {MESES[month - 1]} {year}
            </h2>
            <button
              onClick={nextMonth}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={goToday}
              className="ml-2 px-3 py-1.5 text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg"
            >
              Hoy
            </button>
          </div>
          <select
            value={filterMedico}
            onChange={(e) => setFilterMedico(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos los profesionales</option>
            {profesionales.map((p) => (
              <option key={p.id} value={p.codigo}>
                {p.alias || `${p.primerNombre} ${p.primerApellido}`} · {p.codigo}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Calendario */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {/* Cabecera de días */}
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
          {DIAS_CORTO.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-xs font-medium text-gray-500"
            >
              {d}
            </div>
          ))}
        </div>
        {/* Celdas */}
        <div className="grid grid-cols-7">
          {loadingMes ? (
            <div className="col-span-7 py-16 text-center text-sm text-gray-500">
              Cargando calendario...
            </div>
          ) : (
            calendarCells.map((cell, i) => {
              if (!cell.iso) {
                return (
                  <div
                    key={`empty-${i}`}
                    className="h-24 border-b border-r border-gray-100 bg-gray-50/30"
                  />
                );
              }
              const dia = mesData?.porDia[cell.iso];
              const isToday = cell.iso === today.iso;
              const medicosEnDia = dia ? Object.entries(dia.porMedico) : [];
              const top2 = medicosEnDia.slice(0, 2);
              const more = medicosEnDia.length - top2.length;
              return (
                <button
                  key={cell.iso}
                  onClick={() => setSelectedDay(cell.iso!)}
                  className={`h-24 border-b border-r border-gray-100 p-1.5 text-left hover:bg-blue-50/40 transition-colors ${
                    isToday ? 'bg-blue-50/20' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`text-xs font-semibold ${
                        isToday
                          ? 'inline-flex w-5 h-5 items-center justify-center rounded-full bg-blue-600 text-white'
                          : 'text-gray-700'
                      }`}
                    >
                      {cell.day}
                    </span>
                    {dia && dia.total > 0 && (
                      <span className="text-[10px] font-medium text-gray-400">
                        {dia.total}
                      </span>
                    )}
                  </div>
                  {dia && (
                    <div className="mt-1 space-y-0.5">
                      {top2.map(([codigo, info]) => (
                        <div
                          key={codigo}
                          className={`text-[10px] truncate px-1 py-0.5 border rounded ${colorFor(
                            codigo,
                            codigosVistos
                          )}`}
                          title={`${profesionalNombre(codigo)} · ${info.atendidos}/${info.total}`}
                        >
                          {profesionalNombre(codigo).slice(0, 14)} {info.atendidos}/{info.total}
                        </div>
                      ))}
                      {more > 0 && (
                        <div className="text-[10px] text-gray-400">+{more} más</div>
                      )}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Gráficas */}
      {mesData && mesData.totalCitas > 0 && (
        <CalendarioStats mes={mesData} profesionales={profesionales} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista día (timeline por hora)
// ---------------------------------------------------------------------------

interface DiaProps {
  fecha: string;
  medico?: string;
  profesionales: Profesional[];
  onBack: () => void;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

function DiaView({ fecha, medico, profesionales, onBack, showToast }: DiaProps) {
  const [data, setData] = useState<DiaDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtroMedico, setFiltroMedico] = useState<string | undefined>(medico);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reasignarOpen, setReasignarOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await calendarioService.getDia(fecha, filtroMedico);
      setData(result);
      // Limpia selección sobre IDs que ya no existen tras un reload
      setSelectedIds((prev) => {
        const visibles = new Set(result.citas.map((c) => c.id));
        const next = new Set<string>();
        for (const id of prev) if (visibles.has(id)) next.add(id);
        return next;
      });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error?.message || 'Error cargando el día.';
      showToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [fecha, filtroMedico, showToast]);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    if (!data) return;
    setSelectedIds(new Set(data.citas.map((c) => c.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const selectedCitas = useMemo(() => {
    if (!data) return [];
    return data.citas.filter((c) => selectedIds.has(c.id));
  }, [data, selectedIds]);

  const todasSeleccionadas =
    data !== null && data.citas.length > 0 && selectedIds.size === data.citas.length;

  // Agrupar citas por hora (HH)
  const porHora = useMemo(() => {
    const map = new Map<string, CitaListItem[]>();
    if (!data) return map;
    for (const c of data.citas) {
      const hora = c.horaAtencion?.slice(0, 2) || 'Sin hora';
      const list = map.get(hora) ?? [];
      list.push(c);
      map.set(hora, list);
    }
    return map;
  }, [data]);

  const horasOrdenadas = useMemo(() => {
    return Array.from(porHora.keys()).sort();
  }, [porHora]);

  const fechaFormateada = useMemo(() => {
    const [y, m, d] = fecha.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [fecha]);

  function profesionalNombre(codigo: string): string {
    if (codigo === '__SIN_ASIGNAR__') return 'Sin asignar';
    const p = profesionales.find((x) => x.codigo === codigo);
    if (!p) return codigo;
    return p.alias || [p.primerNombre, p.primerApellido].filter(Boolean).join(' ');
  }

  function statusBadge(atendido: string | null): string {
    const s = (atendido || 'PENDIENTE').toUpperCase();
    if (s === 'ATENDIDO') return 'bg-green-100 text-green-700 border-green-200';
    if (s === 'NO CONTESTA') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-amber-100 text-amber-700 border-amber-200';
  }

  return (
    <div>
      {/* Header del día */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          aria-label="Volver al calendario"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-gray-800 capitalize">{fechaFormateada}</h2>
          {data && (
            <p className="text-xs text-gray-500">
              {data.total} citas · {data.atendidos} atendidas · {data.pendientes} pendientes
            </p>
          )}
        </div>
        {filtroMedico && (
          <button
            onClick={() => setFiltroMedico(undefined)}
            className="px-3 py-1.5 text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg"
          >
            Quitar filtro
          </button>
        )}
        {data && data.total > 0 && (
          <button
            onClick={() => exportDiaCSV(data, profesionales, fecha)}
            className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-lg flex items-center gap-1.5"
            title="Exportar día a CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        )}
      </div>

      {/* Cards de médicos */}
      {data && data.medicosResumen.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
          {data.medicosResumen.map((m) => (
            <button
              key={m.medicoCodigo}
              onClick={() => setFiltroMedico(filtroMedico === m.medicoCodigo ? undefined : m.medicoCodigo)}
              className={`p-3 border rounded-2xl text-left transition-colors ${
                filtroMedico === m.medicoCodigo
                  ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-semibold text-gray-800 truncate">{m.nombre}</p>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs text-gray-500">
                  {m.atendidos}/{m.total} atend.
                </p>
                <span className="text-[10px] uppercase font-medium text-gray-400">
                  {m.rol === 'coach' ? 'Coach' : m.rol === 'medico' ? 'Médico' : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar de selección masiva */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between mb-2 px-1">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600">
            <input
              type="checkbox"
              checked={todasSeleccionadas}
              onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
            />
            Seleccionar todas las visibles
          </label>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Limpiar selección ({selectedIds.size})
            </button>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-20">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-500">Cargando citas...</div>
        ) : !data || data.total === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">
            No hay citas programadas para este día{filtroMedico ? ' con este médico' : ''}.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {horasOrdenadas.map((hora) => (
              <div key={hora} className="flex">
                <div className="w-16 flex-shrink-0 bg-gray-50 px-3 py-3 text-xs font-medium text-gray-500 border-r border-gray-100">
                  {hora === 'Sin hora' ? '--' : `${hora}:00`}
                </div>
                <div className="flex-1 py-2 divide-y divide-gray-50">
                  {porHora.get(hora)!.map((c) => {
                    const isSelected = selectedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className={`px-3 py-2 grid grid-cols-12 gap-2 items-center transition-colors ${
                          isSelected ? 'bg-blue-50/40' : ''
                        }`}
                      >
                        <div className="col-span-1 flex items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleId(c.id)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-1 text-xs font-medium text-gray-600">
                          {c.horaAtencion?.slice(0, 5) ?? '—'}
                        </div>
                        <div className="col-span-4 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.nombre}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {c.numeroId} {c.celular ? `· ${c.celular}` : ''}
                          </p>
                        </div>
                        <div className="col-span-4 text-xs text-gray-600 truncate">
                          {c.medicoCodigo ? profesionalNombre(c.medicoCodigo) : '—'}
                        </div>
                        <div className="col-span-2 text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium border rounded-full ${statusBadge(
                              c.atendido
                            )}`}
                          >
                            {(c.atendido || 'PENDIENTE').toUpperCase()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk action bar — flotante en bottom cuando hay selección */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-800 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">
            {selectedIds.size} cita{selectedIds.size !== 1 ? 's' : ''} seleccionada
            {selectedIds.size !== 1 ? 's' : ''}
          </span>
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            Cancelar
          </button>
          <button
            onClick={() => setReasignarOpen(true)}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-1.5 font-medium"
          >
            <UserCog className="w-3.5 h-3.5" />
            Reasignar médico
          </button>
        </div>
      )}

      {/* Modal Reasignar */}
      <ReasignarModal
        isOpen={reasignarOpen}
        onClose={() => setReasignarOpen(false)}
        citas={selectedCitas}
        profesionales={profesionales}
        fechaActual={fecha}
        onSaved={(afectadas) => {
          showToast({
            type: 'success',
            message: `${afectadas} cita${afectadas !== 1 ? 's' : ''} reasignada${afectadas !== 1 ? 's' : ''}.`,
          });
          clearSelection();
          reload();
        }}
        onError={(message) => showToast({ type: 'error', message })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

function exportDiaCSV(data: DiaDetalle, profesionales: Profesional[], fecha: string): void {
  function nombreMedico(codigo: string | null): string {
    if (!codigo) return '';
    if (codigo === '__SIN_ASIGNAR__') return 'Sin asignar';
    const p = profesionales.find((x) => x.codigo === codigo);
    if (!p) return codigo;
    return p.alias || [p.primerNombre, p.primerApellido].filter(Boolean).join(' ');
  }
  function escapeCsv(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const headers = [
    'Hora',
    'Documento',
    'Nombre',
    'Celular',
    'Email',
    'Médico (código)',
    'Médico (nombre)',
    'Estado',
    'Tipo consulta',
    'Empresa',
    'Motivo consulta',
  ];
  const lines: string[] = [headers.map(escapeCsv).join(',')];
  for (const c of data.citas) {
    lines.push(
      [
        c.horaAtencion ?? '',
        c.numeroId,
        c.nombre,
        c.celular ?? '',
        c.email ?? '',
        c.medicoCodigo ?? '',
        nombreMedico(c.medicoCodigo),
        c.atendido ?? 'PENDIENTE',
        c.tipoConsulta ?? '',
        c.empresa ?? '',
        c.motivoConsulta ?? '',
      ]
        .map(escapeCsv)
        .join(',')
    );
  }
  // BOM para que Excel abra UTF-8 correctamente
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `citas-${fecha}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
