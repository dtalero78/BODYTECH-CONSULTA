import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Download,
  Plus,
  UserCog,
  Maximize2,
  CalendarDays,
  Clock,
} from 'lucide-react';
import calendarioService, {
  MesResumen,
  DiaDetalle,
  CitaListItem,
  DisponibilidadMes,
  Modalidad,
} from '../../services/calendario.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import authService, { Sede } from '../../services/auth.service';
import { ReasignarModal } from './ReasignarModal';
import { DisponibilidadDiaModal } from './DisponibilidadDiaModal';
import { AgendarCitaModal } from '../AgendarCitaModal';
import {
  FONT_INTER,
  FONT_MONO,
  Pill,
  SECTION_LABEL,
} from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
  reportCount?: (count: number | null) => void;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DIAS_CORTO_LU = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function todayInBogota(): { year: number; month: number; day: number; iso: string } {
  const nowUtc = new Date();
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

function prevMonthOf(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function densityLevel(total: number): 0 | 1 | 2 | 3 {
  if (total <= 0) return 0;
  if (total <= 5) return 1;
  if (total <= 12) return 2;
  return 3;
}

function densityBg(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 0:
      return 'bg-zinc-100';
    case 1:
      return 'bg-zinc-300';
    case 2:
      return 'bg-zinc-500';
    case 3:
      return 'bg-[#1f3a8a]';
  }
}

// Formato delta: "+8.4%", "−4.4%", "±0"
function formatDelta(current: number, previous: number | null): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (previous === null || previous === 0) {
    return { text: '±0', tone: 'flat' };
  }
  const diff = ((current - previous) / previous) * 100;
  if (Math.abs(diff) < 0.05) return { text: '±0', tone: 'flat' };
  if (diff > 0) return { text: `+${diff.toFixed(1)}%`, tone: 'up' };
  return { text: `−${Math.abs(diff).toFixed(1)}%`, tone: 'down' };
}

// ---------------------------------------------------------------------------

export function CalendarioView({ showToast, reportCount }: Props) {
  const today = useMemo(() => todayInBogota(), []);
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [mesData, setMesData] = useState<MesResumen | null>(null);
  const [prevMesData, setPrevMesData] = useState<MesResumen | null>(null);
  const [loadingMes, setLoadingMes] = useState(true);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [filterMedico, setFilterMedico] = useState<string>(''); // codigo o ''
  // Filtro de sedes: por sede, varias sedes agrupadas, o todas. Default = la del coordinador.
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedesSel, setSedesSel] = useState<string[]>(() => {
    const s = authService.getSedeId();
    return s ? [s] : [];
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [diaDetalle, setDiaDetalle] = useState<DiaDetalle | null>(null);
  const [loadingDia, setLoadingDia] = useState(false);
  const [showFullDayModal, setShowFullDayModal] = useState(false);
  const [showAgendar, setShowAgendar] = useState(false);
  const [diaReloadTick, setDiaReloadTick] = useState(0);
  // Modo de la vista: 'citas' (agenda, default) o 'disponibilidad' (override por día).
  const [modo, setModo] = useState<'citas' | 'disponibilidad'>('citas');
  const [modalidadDispo, setModalidadDispo] = useState<Modalidad>('virtual');
  const [dispoMes, setDispoMes] = useState<DisponibilidadMes | null>(null);
  const [dispoDia, setDispoDia] = useState<string | null>(null); // fecha abierta en modo disponibilidad
  const [dispoReloadTick, setDispoReloadTick] = useState(0);

  // Cargar lista de sedes (una vez). Si el coordinador no tenía sede, default a todas.
  useEffect(() => {
    authService
      .getSedes()
      .then((s) => {
        setSedes(s);
        setSedesSel((cur) => (cur.length > 0 ? cur : s.map((x) => x.sedeId)));
      })
      .catch(() => {});
  }, []);

  // Cargar profesionales de las sedes seleccionadas (para el filtro de médico y
  // los nombres). Si el médico filtrado deja de existir en el nuevo conjunto, se limpia.
  useEffect(() => {
    if (sedesSel.length === 0) return;
    profesionalesService
      .list({ activo: true, sedes: sedesSel })
      .then((list) => {
        setProfesionales(list);
        setFilterMedico((cur) => (cur && !list.some((p) => p.codigo === cur) ? '' : cur));
      })
      .catch(() => {});
  }, [sedesSel]);

  const reloadMes = useCallback(async () => {
    setLoadingMes(true);
    try {
      const prev = prevMonthOf(year, month);
      // Pedimos en paralelo el mes actual y el anterior (para el delta).
      // Si el anterior falla, mostramos delta neutro.
      const [data, prevData] = await Promise.all([
        calendarioService.getMes(year, month, filterMedico || undefined, sedesSel),
        calendarioService
          .getMes(prev.year, prev.month, filterMedico || undefined, sedesSel)
          .catch(() => null),
      ]);
      setMesData(data);
      setPrevMesData(prevData);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      const msg = e?.response?.data?.error?.message || 'Error cargando el mes.';
      showToast({ type: 'error', message: msg });
    } finally {
      setLoadingMes(false);
    }
  }, [year, month, filterMedico, sedesSel, showToast]);

  useEffect(() => {
    reloadMes();
  }, [reloadMes]);

  // Cargar overrides del mes (modo disponibilidad) para marcar las celdas.
  useEffect(() => {
    if (modo !== 'disponibilidad') return;
    let cancelled = false;
    calendarioService
      .getDisponibilidadMes(year, month, modalidadDispo, sedesSel)
      .then((d) => {
        if (!cancelled) setDispoMes(d);
      })
      .catch(() => {
        if (!cancelled) setDispoMes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [modo, year, month, modalidadDispo, sedesSel, dispoReloadTick]);

  // Reportar conteo de mes al sidebar
  useEffect(() => {
    if (!reportCount) return;
    if (mesData) reportCount(mesData.totalCitas);
  }, [mesData, reportCount]);

  // Cargar detalle del día seleccionado
  useEffect(() => {
    if (!selectedDay) {
      setDiaDetalle(null);
      return;
    }
    let cancelled = false;
    setLoadingDia(true);
    calendarioService
      .getDia(selectedDay, filterMedico || undefined, sedesSel)
      .then((d) => {
        if (!cancelled) setDiaDetalle(d);
      })
      .catch(() => {
        if (!cancelled) setDiaDetalle(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDia(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, filterMedico, sedesSel, diaReloadTick]);

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

  // Construir grid 7 columnas (lunes-domingo). Lunes = 0.
  const calendarCells = useMemo(() => {
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const jsDow = firstDay.getUTCDay(); // 0=Dom .. 6=Sáb
    // Lun=0, Mar=1 ... Dom=6
    const startDow = (jsDow + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const cells: Array<{ iso: string | null; day: number | null }> = [];
    for (let i = 0; i < startDow; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: fechaIso(year, month, d), day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
    return cells;
  }, [year, month]);

  // Total máximo por hora del día seleccionado (para escalar las barras del heatmap)
  const horasDistrib = useMemo(() => {
    const buckets = new Array<number>(24).fill(0);
    if (!diaDetalle) return buckets;
    for (const c of diaDetalle.citas) {
      if (!c.horaAtencion) continue;
      const h = parseInt(c.horaAtencion.slice(0, 2), 10);
      if (h >= 0 && h < 24) buckets[h]++;
    }
    return buckets;
  }, [diaDetalle]);

  const maxHora = useMemo(() => Math.max(1, ...horasDistrib), [horasDistrib]);

  // ----- Render -----

  return (
    <div className="space-y-4">
      <div
        className="bg-white rounded-xl overflow-hidden"
        style={{ boxShadow: 'inset 0 0 0 1px #e4e4e7' }}
      >
        {/* Header */}
        <div className="px-8 pt-6 pb-5 flex items-start justify-between gap-6 border-b border-zinc-200">
          <div>
            <div
              className="text-[11px] text-zinc-400 mb-1"
              style={{ fontFamily: FONT_MONO }}
            >
              / calendario / {modo === 'citas' ? 'citas-agendadas' : 'agenda-de-turnos'} /{' '}
              {MESES[month - 1].toLowerCase()} {year}
            </div>
            <h2
              className="text-[26px] font-semibold tracking-tight leading-tight"
              style={{ fontFamily: FONT_INTER }}
            >
              <span className="text-zinc-900">{MESES[month - 1]}</span>{' '}
              <span className="text-zinc-400 tabular-nums">{year}</span>
            </h2>
            <p
              className="text-[13px] mt-1 flex items-center gap-1.5"
              style={{ fontFamily: FONT_INTER }}
            >
              {modo === 'citas' ? (
                <>
                  <CalendarDays className="w-3.5 h-3.5 text-[#1f3a8a]" />
                  <span className="font-medium text-zinc-700">Citas Agendadas</span>
                  <span className="text-zinc-400">· citas programadas por día</span>
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5 text-[#1f3a8a]" />
                  <span className="font-medium text-zinc-700">Agenda de Turnos</span>
                  <span className="text-zinc-400">· disponibilidad horaria de los profesionales</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1">
              <button
                onClick={prevMonth}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={goToday}
                className="h-8 px-3 rounded-md text-[12.5px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50"
              >
                Hoy
              </button>
              <button
                onClick={nextMonth}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Toggle modo: Citas (agenda) / Disponibilidad (override por día) */}
            <div className="inline-flex items-center bg-zinc-100 rounded-md p-0.5 text-[12px] font-medium">
              <button
                onClick={() => {
                  setModo('citas');
                  setDispoDia(null);
                }}
                className={`h-7 px-2.5 rounded inline-flex items-center gap-1 ${
                  modo === 'citas' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                Citas Agendadas
              </button>
              <button
                onClick={() => {
                  setModo('disponibilidad');
                  setSelectedDay(null);
                }}
                className={`h-7 px-2.5 rounded inline-flex items-center gap-1 ${
                  modo === 'disponibilidad' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Agenda de Turnos
              </button>
            </div>
            {modo === 'citas' && (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar
                </button>
                <button
                  type="button"
                  onClick={() => setShowAgendar(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-medium text-white"
                  style={{ background: '#1f3a8a' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nueva cita
                </button>
              </>
            )}
          </div>
        </div>

        {/* KPI strip — 4 cards estilo Stripe */}
        <div className="grid grid-cols-4 border-b border-zinc-200">
          <KpiCard
            label="Citas del mes"
            value={mesData?.totalCitas ?? 0}
            prev={prevMesData?.totalCitas ?? null}
            prevMonthLabel={MESES[prevMonthOf(year, month).month - 1].toLowerCase()}
            loading={loadingMes}
            isFirst
          />
          <KpiCard
            label="Atendidas"
            value={mesData?.totalAtendidos ?? 0}
            prev={prevMesData?.totalAtendidos ?? null}
            prevMonthLabel={MESES[prevMonthOf(year, month).month - 1].toLowerCase()}
            loading={loadingMes}
          />
          <KpiCard
            label="Pendientes"
            value={mesData?.totalPendientes ?? 0}
            prev={prevMesData?.totalPendientes ?? null}
            prevMonthLabel={MESES[prevMonthOf(year, month).month - 1].toLowerCase()}
            loading={loadingMes}
          />
          <KpiCard
            label="Profesionales activos"
            value={mesData?.medicosActivos ?? 0}
            prev={prevMesData?.medicosActivos ?? null}
            prevMonthLabel={MESES[prevMonthOf(year, month).month - 1].toLowerCase()}
            loading={loadingMes}
            isLast
          />
        </div>

        {/* Filter strip */}
        {modo === 'citas' ? (
          <div className="px-8 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-3 flex-wrap">
            <span className={SECTION_LABEL}>Filtros</span>
            <SedeMultiSelect
              sedes={sedes}
              value={sedesSel}
              onChange={(v) => {
                setSedesSel(v);
                setSelectedDay(null);
              }}
            />
            <FilterSelect
              label="Médico"
              value={filterMedico}
              onChange={(v) => {
                setFilterMedico(v);
                setSelectedDay(null);
              }}
              options={[
                { value: '', label: 'Todos los profesionales' },
                ...profesionales.map((p) => ({
                  value: p.codigo,
                  label: `${p.alias || `${p.primerNombre} ${p.primerApellido}`} · ${p.codigo}`,
                })),
              ]}
              active={!!filterMedico}
              onClear={() => setFilterMedico('')}
            />
            <div className="ml-auto flex items-center gap-3 text-[11.5px] text-zinc-500">
              <LegendDot color="bg-green-500" label="Atendido" />
              <LegendDot color="bg-amber-500" label="Pendiente" />
              <LegendDot color="bg-blue-500" label="En curso" />
              <LegendDot color="bg-zinc-400" label="No asistió" />
            </div>
          </div>
        ) : (
          <div className="px-8 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-3 flex-wrap">
            <span className={SECTION_LABEL}>Sedes</span>
            <SedeMultiSelect
              sedes={sedes}
              value={sedesSel}
              onChange={(v) => {
                setSedesSel(v);
                setDispoDia(null);
              }}
            />
            <span className={SECTION_LABEL}>Modalidad</span>
            <div className="inline-flex items-center bg-white border border-zinc-200 rounded-md p-0.5 text-[12px] font-medium">
              {(['virtual', 'presencial'] as Modalidad[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setModalidadDispo(m)}
                  className={`h-7 px-3 rounded ${
                    modalidadDispo === m ? 'bg-[#eef2ff] text-[#1e3a8a]' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {m === 'virtual' ? 'Virtual' : 'Presencial'}
                </button>
              ))}
            </div>
            <span className="text-[11.5px] text-zinc-500">
              Selecciona un día para editar la disponibilidad de los profesionales sin afectar el patrón semanal.
            </span>
            <div className="ml-auto flex items-center gap-3 text-[11.5px] text-zinc-500">
              <LegendDot color="bg-[#1f3a8a]" label="Día con horario personalizado" />
              <LegendDot color="bg-red-500" label="Profesional bloqueado" />
            </div>
          </div>
        )}

        {/* Grid + panel lateral */}
        <div
          className="grid"
          style={{ gridTemplateColumns: '1fr 360px' }}
        >
          {/* Izquierda — grid mensual */}
          <div>
            {/* Header de días */}
            <div className="grid grid-cols-7 bg-[#fcfcfb] border-b border-zinc-200">
              {DIAS_CORTO_LU.map((d) => (
                <div
                  key={d}
                  className={`px-3 py-2 ${SECTION_LABEL}`}
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {loadingMes ? (
                <div className="col-span-7 py-16 text-center text-[13px] text-zinc-500">
                  Cargando calendario…
                </div>
              ) : (
                calendarCells.map((cell, i) => {
                  if (!cell.iso) {
                    return (
                      <div
                        key={`empty-${i}`}
                        className="h-[118px] border-r border-b border-zinc-200 bg-zinc-50"
                      />
                    );
                  }
                  const isDispo = modo === 'disponibilidad';
                  const dia = mesData?.porDia[cell.iso];
                  const total = dia?.total ?? 0;
                  const dispoInfo = dispoMes?.porDia[cell.iso];
                  const overrides = dispoInfo?.overrides ?? 0;
                  const bloqueados = dispoInfo?.bloqueados ?? 0;
                  const isToday = cell.iso === today.iso;
                  const isSelected = isDispo ? dispoDia === cell.iso : selectedDay === cell.iso;
                  const level = densityLevel(total);

                  const bgCell = isSelected
                    ? 'bg-[#eef2ff]'
                    : isToday
                      ? 'bg-[#f8fafc]'
                      : 'bg-white';

                  const ringStyle: React.CSSProperties = {};
                  if (isSelected || isToday) {
                    ringStyle.boxShadow = 'inset 0 0 0 1.5px #1f3a8a';
                  }

                  return (
                    <button
                      key={cell.iso}
                      onClick={() => (isDispo ? setDispoDia(cell.iso) : setSelectedDay(cell.iso))}
                      className={`h-[118px] border-r border-b border-zinc-200 p-2.5 text-left relative cursor-pointer hover:bg-zinc-50 transition-colors ${bgCell}`}
                      style={ringStyle}
                    >
                      <div className="flex items-start justify-between">
                        <span
                          className={`text-[12.5px] tabular-nums font-medium ${
                            isToday ? 'text-[#1e3a8a]' : 'text-zinc-700'
                          }`}
                        >
                          {cell.day}
                        </span>
                        {isDispo
                          ? overrides > 0 && (
                              <span
                                className="text-[10px] tabular-nums text-blue-600"
                                style={{ fontFamily: FONT_MONO }}
                                title={`${overrides} con horario personalizado${bloqueados ? ` · ${bloqueados} bloqueado(s)` : ''}`}
                              >
                                {overrides}✎
                              </span>
                            )
                          : total > 0 && (
                              <span
                                className="text-[10px] text-zinc-400 tabular-nums"
                                style={{ fontFamily: FONT_MONO }}
                              >
                                {total}
                              </span>
                            )}
                      </div>

                      {/* Badge HOY (sólo si no está seleccionado, para evitar amontonar) */}
                      {isToday && !isSelected && (
                        <span
                          className="absolute top-1 right-8 text-[8.5px] uppercase tracking-[0.12em] font-bold"
                          style={{ color: '#1f3a8a', fontFamily: FONT_INTER }}
                        >
                          HOY
                        </span>
                      )}

                      {/* Indicador inferior:
                          - Modo disponibilidad: barra que resalta si hay overrides ese día
                            (azul) y un punto rojo si hay bloqueos.
                          - Modo citas: heatmap horario (día seleccionado) o densidad. */}
                      <div className="absolute left-2.5 right-2.5 bottom-2 flex items-end gap-[2px] h-[18px]">
                        {isDispo ? (
                          <span className="w-full flex items-center gap-1">
                            <span
                              className={`flex-1 rounded-sm ${overrides > 0 ? 'bg-[#1f3a8a]' : 'bg-zinc-200'}`}
                              style={{ height: overrides > 0 ? 6 : 4 }}
                            />
                            {bloqueados > 0 && (
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title={`${bloqueados} profesional(es) sin atención`} />
                            )}
                          </span>
                        ) : isSelected && diaDetalle ? (
                          horasDistrib.map((count, h) => {
                            const heightPct = count === 0 ? 12 : Math.max(18, (count / maxHora) * 100);
                            const color =
                              count === 0
                                ? 'bg-zinc-200'
                                : count <= 2
                                  ? 'bg-zinc-400'
                                  : count <= 4
                                    ? 'bg-zinc-600'
                                    : 'bg-[#1f3a8a]';
                            return (
                              <span
                                key={h}
                                className={`flex-1 rounded-[1px] ${color}`}
                                style={{ height: `${heightPct}%`, minHeight: 2 }}
                                title={`${h}:00 — ${count} citas`}
                              />
                            );
                          })
                        ) : (
                          <span
                            className={`w-full rounded-sm ${densityBg(level)}`}
                            style={{ height: total === 0 ? 4 : 6 }}
                          />
                        )}
                      </div>

                      {/* NOTA: el desglose atendidos · pendientes vive en el panel
                          lateral (spec sec. 6.4 — "el desglose vive en el panel
                          lateral"). NO renderizarlo dentro de la celda — duplicaba
                          el ruido visual que el eval iter-2 pidió limpiar para
                          la celda HOY, generalizado al resto. */}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Derecha — Panel del día seleccionado */}
          <div className="border-l border-zinc-200 bg-white px-5 pt-6 pb-4 min-h-[400px]">
            {modo === 'disponibilidad' ? (
              <div className="text-[13px] pt-4 space-y-3">
                <div className="text-zinc-700 font-medium" style={{ fontFamily: FONT_INTER }}>
                  Disponibilidad por día
                </div>
                <p className="text-zinc-500 leading-relaxed">
                  Haz clic en un día del calendario para abrir el editor y ajustar el horario de uno o
                  más profesionales <span className="font-medium text-zinc-700">solo para esa fecha</span>.
                </p>
                <p className="text-zinc-400 text-[12px] leading-relaxed">
                  Los cambios no afectan el patrón semanal (lo que se fija en "Fijar disponibilidad").
                  Un punto azul marca los días con horario personalizado; uno rojo, profesionales sin atención.
                </p>
              </div>
            ) : !selectedDay ? (
              <div className="text-zinc-400 text-[13px] pt-4">
                Selecciona un día para ver las citas.
              </div>
            ) : loadingDia || !diaDetalle ? (
              <div className="text-zinc-500 text-[13px] pt-4">Cargando citas…</div>
            ) : (
              <DiaPanel
                fecha={selectedDay}
                detalle={diaDetalle}
                profesionales={profesionales}
                multiSede={sedesSel.length > 1}
                sedeNombre={(id) => sedes.find((s) => s.sedeId === id)?.nombre ?? id ?? ''}
                onAmpliar={() => setShowFullDayModal(true)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modal "Ver día completo" (drawer/modal con DiaView legacy) */}
      {showFullDayModal && selectedDay && (
        <DiaFullModal
          fecha={selectedDay}
          medico={filterMedico || undefined}
          profesionales={profesionales}
          sedesSel={sedesSel}
          sedesList={sedes}
          onClose={() => {
            setShowFullDayModal(false);
            // Si hubo cambios (reasignar), refrescar mes
            reloadMes();
          }}
          showToast={showToast}
        />
      )}

      {/* Modal "Disponibilidad del día" — override por fecha (modo disponibilidad). */}
      {dispoDia && (
        <DisponibilidadDiaModal
          fecha={dispoDia}
          onClose={() => setDispoDia(null)}
          onSaved={() => setDispoReloadTick((t) => t + 1)}
          showToast={showToast}
        />
      )}

      {/* Modal "Nueva cita" — agendamiento con selección de profesional y
          horarios disponibles (mismas reglas que el panel del médico). */}
      <AgendarCitaModal
        open={showAgendar}
        allowMedicoSelect
        medicoCode={filterMedico || undefined}
        onClose={() => setShowAgendar(false)}
        onSuccess={() => {
          setShowAgendar(false);
          reloadMes();
          setDiaReloadTick((t) => t + 1);
          showToast({ type: 'success', message: 'Cita agendada correctamente.' });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  prev,
  prevMonthLabel,
  loading,
  isFirst = false,
  isLast = false,
}: {
  label: string;
  value: number;
  prev: number | null;
  prevMonthLabel: string;
  loading: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  void isFirst;
  const delta = formatDelta(value, prev);
  const toneCls =
    delta.tone === 'up'
      ? 'text-green-700'
      : delta.tone === 'down'
        ? 'text-red-700'
        : 'text-zinc-500';
  return (
    <div
      className={`py-3 px-6 ${isLast ? '' : 'border-r border-zinc-200'}`}
      style={{ fontFamily: FONT_INTER }}
    >
      <div className={SECTION_LABEL}>{label}</div>
      <div
        className="mt-1.5 text-[28px] font-semibold tabular-nums text-zinc-900 leading-none"
        style={{ fontFamily: FONT_INTER, fontVariantNumeric: 'tabular-nums' }}
      >
        {loading ? '—' : value.toLocaleString('es-CO')}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`text-[12px] tabular-nums ${toneCls}`} style={{ fontFamily: FONT_MONO }}>
          {delta.text}
        </span>
        <span className="text-[11px] text-zinc-400">
          vs. {prevMonthLabel}{' '}
          {prev !== null ? (
            <span className="tabular-nums" style={{ fontFamily: FONT_MONO }}>
              ({prev})
            </span>
          ) : (
            '(—)'
          )}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LegendDot
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FilterSelect — re-uso local de chip estilizado
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
  active = false,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  active?: boolean;
  onClear?: () => void;
}) {
  const stateCls = active ? 'bg-[#eef2ff] text-[#1e3a8a]' : 'bg-white text-zinc-800';
  const borderColor = active ? '#1f3a8a' : '#d4d4d8';
  return (
    <div
      className={`relative inline-flex items-center h-[30px] rounded-md border text-[12.5px] font-medium ${stateCls}`}
      style={{ fontFamily: FONT_INTER, borderColor }}
    >
      <span
        className={`pl-[11px] pr-1 font-normal ${active ? 'text-[#1e3a8a]/70' : 'text-zinc-500'}`}
      >
        {label}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pl-0 pr-7 h-[30px] outline-none text-[12.5px] font-medium cursor-pointer max-w-[200px]"
        style={{ fontFamily: FONT_INTER }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {active && onClear ? (
        <button
          onClick={onClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/60"
          aria-label="Quitar filtro"
        >
          <X className="w-3 h-3 text-[#1e3a8a]" />
        </button>
      ) : (
        <ChevronDown className="w-3 h-3 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SedeMultiSelect — filtro de sedes (una, varias agrupadas, o todas).
// Dropdown con checkboxes + opción "Todas las sedes". El botón resume la
// selección. Cierra al hacer clic fuera (backdrop transparente).
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
      onChange(next.length > 0 ? next : value); // no permitir vacío
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
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
          />
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

// ---------------------------------------------------------------------------
// Panel del día (lista por bloque horario)
// ---------------------------------------------------------------------------

function DiaPanel({
  fecha,
  detalle,
  profesionales,
  multiSede,
  sedeNombre,
  onAmpliar,
}: {
  fecha: string;
  detalle: DiaDetalle;
  profesionales: Profesional[];
  multiSede: boolean;
  sedeNombre: (id: string | null) => string;
  onAmpliar: () => void;
}) {
  const fechaFormateada = useMemo(() => {
    const [y, m, d] = fecha.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  }, [fecha]);

  function profesionalNombre(codigo: string | null): string {
    if (!codigo) return '—';
    if (codigo === '__SIN_ASIGNAR__') return 'Sin asignar';
    const p = profesionales.find((x) => x.codigo === codigo);
    if (!p) return codigo;
    return p.alias || [p.primerNombre, p.primerApellido].filter(Boolean).join(' ');
  }

  function statusVariant(atendido: string | null): 'ok' | 'warn' | 'bad' | 'mute' {
    const s = (atendido || 'PENDIENTE').toUpperCase();
    if (s === 'ATENDIDO') return 'ok';
    if (s === 'NO CONTESTA') return 'bad';
    return 'warn';
  }

  // Agrupar por bloque horario
  const bloques = useMemo(() => {
    const m: Record<'manana' | 'tarde' | 'noche', CitaListItem[]> = {
      manana: [],
      tarde: [],
      noche: [],
    };
    for (const c of detalle.citas) {
      const hora = c.horaAtencion ? parseInt(c.horaAtencion.slice(0, 2), 10) : 12;
      if (hora < 12) m.manana.push(c);
      else if (hora < 17) m.tarde.push(c);
      else m.noche.push(c);
    }
    const sort = (arr: CitaListItem[]) =>
      arr.slice().sort((a, b) => (a.horaAtencion || '').localeCompare(b.horaAtencion || ''));
    return {
      manana: sort(m.manana),
      tarde: sort(m.tarde),
      noche: sort(m.noche),
    };
  }, [detalle]);

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold text-zinc-900 capitalize">
            {fechaFormateada}
          </div>
          <div className="text-[12px] text-zinc-500 mt-0.5">
            <span className="tabular-nums">{detalle.total}</span> citas ·{' '}
            <span className="tabular-nums">{detalle.atendidos}</span> atendidas ·{' '}
            <span className="tabular-nums">{detalle.pendientes}</span> pendientes
          </div>
        </div>
        <button
          onClick={onAmpliar}
          title="Ver día completo"
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {detalle.total === 0 ? (
        <p className="text-[13px] text-zinc-400 mt-6">Sin citas para este día.</p>
      ) : (
        <div className="mt-2">
          <Bloque label="MAÑANA · 7:00–12:00" citas={bloques.manana} renderItem={(c) => (
            <CitaRow c={c} prof={profesionalNombre(c.medicoCodigo)} variant={statusVariant(c.atendido)} sede={multiSede ? sedeNombre(c.sedeId) : null} />
          )} />
          <Bloque label="TARDE · 12:00–17:00" citas={bloques.tarde} renderItem={(c) => (
            <CitaRow c={c} prof={profesionalNombre(c.medicoCodigo)} variant={statusVariant(c.atendido)} sede={multiSede ? sedeNombre(c.sedeId) : null} />
          )} />
          <Bloque label="NOCHE · 17:00–21:00" citas={bloques.noche} renderItem={(c) => (
            <CitaRow c={c} prof={profesionalNombre(c.medicoCodigo)} variant={statusVariant(c.atendido)} sede={multiSede ? sedeNombre(c.sedeId) : null} />
          )} />
        </div>
      )}
    </div>
  );
}

function Bloque({
  label,
  citas,
  renderItem,
}: {
  label: string;
  citas: CitaListItem[];
  renderItem: (c: CitaListItem) => React.ReactNode;
}) {
  if (citas.length === 0) return null;
  return (
    <div>
      <div className={`${SECTION_LABEL} pt-4 pb-2`}>{label}</div>
      <ul>
        {citas.map((c) => (
          <li key={c.id} className="py-2 border-b border-zinc-100 last:border-0">
            {renderItem(c)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CitaRow({
  c,
  prof,
  variant,
  sede,
}: {
  c: CitaListItem;
  prof: string;
  variant: 'ok' | 'warn' | 'bad' | 'mute';
  sede?: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="text-[12px] text-zinc-700 tabular-nums w-12 shrink-0"
        style={{ fontFamily: FONT_MONO }}
      >
        {c.horaAtencion?.slice(0, 5) || '—'}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-[13px] font-medium text-zinc-900 truncate"
          style={{ fontFamily: FONT_INTER }}
        >
          {c.nombre}
        </div>
        <div
          className="text-[11px] text-zinc-500 truncate"
          style={{ fontFamily: FONT_INTER }}
        >
          <span style={{ fontFamily: FONT_MONO }}>CC {c.numeroId}</span> · {prof}
          {sede ? <span className="text-[#1e3a8a]"> · {sede}</span> : null}
        </div>
      </div>
      <div className="shrink-0">
        <Pill variant={variant}>{(c.atendido || 'PENDIENTE').toUpperCase()}</Pill>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal "Ver día completo" (drawer con DiaView legacy: selección + reasignar)
// ---------------------------------------------------------------------------

interface DiaFullProps {
  fecha: string;
  medico?: string;
  profesionales: Profesional[];
  sedesSel: string[];
  sedesList: Sede[];
  onClose: () => void;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

function DiaFullModal({ fecha, medico, profesionales, sedesSel, sedesList, onClose, showToast }: DiaFullProps) {
  const [data, setData] = useState<DiaDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reasignarOpen, setReasignarOpen] = useState(false);
  const multiSede = sedesSel.length > 1;
  const sedeNombre = (id: string | null): string =>
    id ? sedesList.find((s) => s.sedeId === id)?.nombre ?? id : '—';

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await calendarioService.getDia(fecha, medico, sedesSel);
      setData(result);
      setSelectedIds((prev) => {
        const visibles = new Set(result.citas.map((c) => c.id));
        const next = new Set<string>();
        for (const id of prev) if (visibles.has(id)) next.add(id);
        return next;
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      const msg = e?.response?.data?.error?.message || 'Error cargando el día.';
      showToast({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [fecha, medico, sedesSel, showToast]);

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

  const selectedCitas = useMemo(() => {
    if (!data) return [];
    return data.citas.filter((c) => selectedIds.has(c.id));
  }, [data, selectedIds]);

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

  function profesionalNombre(codigo: string | null): string {
    if (!codigo) return '—';
    if (codigo === '__SIN_ASIGNAR__') return 'Sin asignar';
    const p = profesionales.find((x) => x.codigo === codigo);
    if (!p) return codigo;
    return p.alias || [p.primerNombre, p.primerApellido].filter(Boolean).join(' ');
  }

  function statusVariant(atendido: string | null): 'ok' | 'warn' | 'bad' | 'mute' {
    const s = (atendido || 'PENDIENTE').toUpperCase();
    if (s === 'ATENDIDO') return 'ok';
    if (s === 'NO CONTESTA') return 'bad';
    return 'warn';
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{ fontFamily: FONT_INTER }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <div
              className="text-[11px] text-zinc-400"
              style={{ fontFamily: FONT_MONO }}
            >
              / calendario / día completo
            </div>
            <h3 className="text-[18px] font-semibold text-zinc-900 capitalize">
              {fechaFormateada}
            </h3>
            {data && (
              <p className="text-[12px] text-zinc-500">
                <span className="tabular-nums">{data.total}</span> citas ·{' '}
                <span className="tabular-nums">{data.atendidos}</span> atendidas
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={() => setReasignarOpen(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-medium text-white"
                style={{ background: '#1f3a8a' }}
              >
                <UserCog className="w-3.5 h-3.5" />
                Reasignar ({selectedIds.size})
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <p className="text-[13px] text-zinc-500">Cargando…</p>
          ) : !data || data.total === 0 ? (
            <p className="text-[13px] text-zinc-500">No hay citas para este día.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={`text-left px-2 py-2 ${SECTION_LABEL}`}></th>
                  <th className={`text-left px-2 py-2 ${SECTION_LABEL}`}>Hora</th>
                  <th className={`text-left px-2 py-2 ${SECTION_LABEL}`}>Afiliado</th>
                  <th className={`text-left px-2 py-2 ${SECTION_LABEL}`}>Médico</th>
                  {multiSede && <th className={`text-left px-2 py-2 ${SECTION_LABEL}`}>Sede</th>}
                  <th className={`text-left px-2 py-2 ${SECTION_LABEL}`}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.citas.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleId(c.id)}
                      />
                    </td>
                    <td
                      className="px-2 py-2 tabular-nums text-zinc-700"
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {c.horaAtencion?.slice(0, 5) || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-medium text-zinc-900">{c.nombre}</div>
                      <div
                        className="text-[11px] text-zinc-500"
                        style={{ fontFamily: FONT_MONO }}
                      >
                        CC {c.numeroId}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-zinc-700">
                      {profesionalNombre(c.medicoCodigo)}
                    </td>
                    {multiSede && (
                      <td className="px-2 py-2 text-[#1e3a8a] text-[12px]">{sedeNombre(c.sedeId)}</td>
                    )}
                    <td className="px-2 py-2">
                      <Pill variant={statusVariant(c.atendido)}>
                        {(c.atendido || 'PENDIENTE').toUpperCase()}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

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
          setSelectedIds(new Set());
          reload();
        }}
        onError={(message) => showToast({ type: 'error', message })}
      />
    </div>
  );
}
