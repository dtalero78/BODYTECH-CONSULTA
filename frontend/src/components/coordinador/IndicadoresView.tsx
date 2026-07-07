// ============================================================================
// IndicadoresView — KPIs del Panel Coordinador (sección "Indicadores").
//
// Muestra tres métricas — Personas agendadas, atendidas y no contactadas —
// filtrables por rango de fechas y por coach/médico (y por sede, vía RBAC).
// Debajo, un desglose por profesional. Fuente: GET /api/calendario/indicadores.
//
// Semántica (misma columna `atendido` que el calendario):
//   agendadas     = todas las citas del rango
//   atendidas     = estado ATENDIDO
//   noContactadas = estado NO CONTESTA
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, X, Download, LineChart, Users } from 'lucide-react';
import calendarioService, { IndicadoresResumen } from '../../services/calendario.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import authService, { Sede } from '../../services/auth.service';
import {
  FONT_INTER,
  FONT_MONO,
  SECTION_LABEL,
  CTA_OUTLINE,
  MonoAvatar,
  initialsOf,
  avatarFotoFor,
} from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

// ---------------------------------------------------------------------------
// Helpers de fecha (Colombia UTC-5)
// ---------------------------------------------------------------------------

function todayInBogota(): { year: number; month: number; day: number; iso: string } {
  const ms = new Date().getTime() - 5 * 60 * 60 * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, iso };
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Suma `n` días a una fecha YYYY-MM-DD (usa mediodía UTC para evitar bordes). */
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0));
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** "2026-07-06" → "6 jul 2026" */
function formatFechaCorta(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(d)} ${MESES[Number(mo) - 1]} ${y}`;
}

function pct(part: number, total: number): string {
  if (total <= 0) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

// Presets de rango relativos a hoy (Colombia).
type Preset = 'hoy' | '7d' | '30d' | 'mes' | 'mesPasado';

function presetRange(preset: Preset): { from: string; to: string } {
  const t = todayInBogota();
  const hoy = t.iso;
  switch (preset) {
    case 'hoy':
      return { from: hoy, to: hoy };
    case '7d':
      return { from: addDaysIso(hoy, -6), to: hoy };
    case '30d':
      return { from: addDaysIso(hoy, -29), to: hoy };
    case 'mes':
      return { from: isoOf(t.year, t.month, 1), to: hoy };
    case 'mesPasado': {
      const py = t.month === 1 ? t.year - 1 : t.year;
      const pm = t.month === 1 ? 12 : t.month - 1;
      const lastDay = new Date(Date.UTC(py, pm, 0, 12)).getUTCDate();
      return { from: isoOf(py, pm, 1), to: isoOf(py, pm, lastDay) };
    }
  }
}

// ---------------------------------------------------------------------------

export function IndicadoresView({ showToast }: Props) {
  const [{ from, to }, setRange] = useState(() => presetRange('mes'));
  const [activePreset, setActivePreset] = useState<Preset | null>('mes');
  const [data, setData] = useState<IndicadoresResumen | null>(null);
  const [loading, setLoading] = useState(true);

  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [filterMedico, setFilterMedico] = useState<string>('');
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedesSel, setSedesSel] = useState<string[]>(() => {
    const user = authService.getUser();
    if (user) return user.esGlobal ? [] : user.sedes;
    const s = authService.getSedeId();
    return s ? [s] : [];
  });

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

  // Cargar profesionales de las sedes seleccionadas (para el filtro de coach).
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

  const reload = useCallback(async () => {
    if (sedesSel.length === 0) return;
    setLoading(true);
    try {
      const res = await calendarioService.getIndicadores(from, to, filterMedico || undefined, sedesSel);
      setData(res);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      const msg = e?.response?.data?.error?.message || 'Error cargando indicadores.';
      showToast({ type: 'error', message: msg });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, filterMedico, sedesSel, showToast]);

  useEffect(() => {
    reload();
  }, [reload]);

  function applyPreset(p: Preset) {
    setRange(presetRange(p));
    setActivePreset(p);
  }

  function setFrom(v: string) {
    if (!v) return;
    setRange((r) => ({ from: v, to: v > r.to ? v : r.to }));
    setActivePreset(null);
  }
  function setTo(v: string) {
    if (!v) return;
    setRange((r) => ({ from: v < r.from ? v : r.from, to: v }));
    setActivePreset(null);
  }

  const medicoNombre = useMemo(() => {
    if (!filterMedico) return null;
    const p = profesionales.find((x) => x.codigo === filterMedico);
    return p ? p.alias || `${p.primerNombre} ${p.primerApellido}` : filterMedico;
  }, [filterMedico, profesionales]);

  // Foto real del profesional (si la tiene); si no, cae al pool placeholder.
  const fotoDe = useCallback(
    (codigo: string): string | null => {
      const p = profesionales.find((x) => x.codigo === codigo);
      return p?.foto || avatarFotoFor(codigo);
    },
    [profesionales]
  );

  function exportCsv() {
    if (!data) return;
    const rows: string[][] = [
      ['Profesional', 'Código', 'Rol', 'Agendadas', 'Atendidas', 'No contactadas', '% Atención'],
      ...data.porMedico.map((m) => [
        m.nombre,
        m.medicoCodigo === '__SIN_ASIGNAR__' ? '' : m.medicoCodigo,
        m.rol ?? '',
        String(m.agendadas),
        String(m.atendidas),
        String(m.noContactadas),
        pct(m.atendidas, m.agendadas),
      ]),
      ['TOTAL', '', '', String(data.agendadas), String(data.atendidas), String(data.noContactadas), pct(data.atendidas, data.agendadas)],
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `indicadores_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const PRESETS: { key: Preset; label: string }[] = [
    { key: 'hoy', label: 'Hoy' },
    { key: '7d', label: 'Últimos 7 días' },
    { key: '30d', label: 'Últimos 30 días' },
    { key: 'mes', label: 'Este mes' },
    { key: 'mesPasado', label: 'Mes pasado' },
  ];

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 flex items-center gap-2">
            <LineChart className="w-5 h-5 text-[#1f3a8a]" />
            Indicadores
          </h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">
            Personas agendadas, atendidas y no contactadas · {formatFechaCorta(from)} — {formatFechaCorta(to)}
            {medicoNombre ? ` · ${medicoNombre}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!data || data.agendadas === 0}
          className={`${CTA_OUTLINE} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-3 flex-wrap">
          <span className={SECTION_LABEL}>Filtros</span>
          <SedeMultiSelect sedes={sedes} value={sedesSel} onChange={setSedesSel} />
          <FilterSelect
            label="Coach"
            value={filterMedico}
            onChange={setFilterMedico}
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
          <div className="flex items-center gap-2">
            <DateField label="Desde" value={from} max={to} onChange={setFrom} />
            <DateField label="Hasta" value={to} min={from} onChange={setTo} />
          </div>
        </div>

        {/* Presets */}
        <div className="px-5 py-2.5 border-b border-zinc-200 flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => {
            const on = activePreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={`h-[26px] px-2.5 rounded-md text-[12px] font-medium border transition-colors ${
                  on
                    ? 'bg-[#eef2ff] border-[#1f3a8a] text-[#1e3a8a]'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200">
          <KpiCard
            label="Personas agendadas"
            value={data?.agendadas ?? 0}
            loading={loading}
            accent="ink"
          />
          <KpiCard
            label="Atendidas"
            value={data?.atendidas ?? 0}
            caption={data ? `${pct(data.atendidas, data.agendadas)} de agendadas` : undefined}
            loading={loading}
            accent="green"
          />
          <KpiCard
            label="No contactadas"
            value={data?.noContactadas ?? 0}
            caption={data ? `${pct(data.noContactadas, data.agendadas)} de agendadas` : undefined}
            loading={loading}
            accent="amber"
          />
        </div>
      </div>

      {/* Desglose por profesional */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2.5">
          <Users className="w-4 h-4 text-zinc-400" />
          <span className={SECTION_LABEL}>Desglose por profesional</span>
        </div>
        <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-[13px]" style={{ fontFamily: FONT_INTER }}>
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 text-[11px] uppercase tracking-[0.06em]">
                <th className="text-left font-semibold px-4 py-2.5">Profesional</th>
                <th className="text-right font-semibold px-4 py-2.5">Agendadas</th>
                <th className="text-right font-semibold px-4 py-2.5">Atendidas</th>
                <th className="text-right font-semibold px-4 py-2.5">No contactadas</th>
                <th className="text-right font-semibold px-4 py-2.5">% Atención</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    Cargando…
                  </td>
                </tr>
              ) : !data || data.porMedico.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    No hay citas en el rango seleccionado.
                  </td>
                </tr>
              ) : (
                data.porMedico.map((m) => {
                  const sinAsignar = m.medicoCodigo === '__SIN_ASIGNAR__';
                  return (
                    <tr key={m.medicoCodigo} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <MonoAvatar
                            initials={sinAsignar ? '··' : initialsOf(m.nombre)}
                            src={sinAsignar ? null : fotoDe(m.medicoCodigo)}
                            size={30}
                            variant={sinAsignar ? 'muted' : 'default'}
                          />
                          <div className="min-w-0">
                            <div className="font-medium text-zinc-800 truncate">{m.nombre}</div>
                            <div className="text-[11px] text-zinc-400">
                              {sinAsignar ? 'Sin código' : m.medicoCodigo}
                              {m.rol ? ` · ${m.rol === 'coach' ? 'Coach' : 'Médico'}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-900" style={{ fontFamily: FONT_MONO }}>
                        {m.agendadas}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-green-700" style={{ fontFamily: FONT_MONO }}>
                        {m.atendidas}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-700" style={{ fontFamily: FONT_MONO }}>
                        {m.noContactadas}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                        {pct(m.atendidas, m.agendadas)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {data && data.porMedico.length > 0 && !loading && (
              <tfoot>
                <tr className="bg-zinc-50 border-t border-zinc-200 font-semibold text-zinc-800">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: FONT_MONO }}>{data.agendadas}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700" style={{ fontFamily: FONT_MONO }}>{data.atendidas}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-700" style={{ fontFamily: FONT_MONO }}>{data.noContactadas}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: FONT_MONO }}>{pct(data.atendidas, data.agendadas)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  caption,
  loading,
  accent,
}: {
  label: string;
  value: number;
  caption?: string;
  loading: boolean;
  accent: 'ink' | 'green' | 'amber';
}) {
  const dot =
    accent === 'green' ? 'bg-green-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-[#1f3a8a]';
  const valCls =
    accent === 'green' ? 'text-green-700' : accent === 'amber' ? 'text-amber-700' : 'text-zinc-900';
  return (
    <div className="px-6 py-5" style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={SECTION_LABEL}>{label}</span>
      </div>
      <div
        className={`mt-2 text-[34px] font-semibold tabular-nums leading-none ${valCls}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {loading ? '—' : value.toLocaleString('es-CO')}
      </div>
      <div className="mt-2 h-[14px] text-[11.5px] text-zinc-400">
        {!loading && caption ? caption : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateField
// ---------------------------------------------------------------------------

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="relative inline-flex items-center h-[30px] rounded-md border border-zinc-300 bg-white text-[12.5px] font-medium"
      style={{ fontFamily: FONT_INTER }}
    >
      <span className="pl-[11px] pr-1 font-normal text-zinc-500">{label}:</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pr-2.5 h-[30px] outline-none text-[12.5px] font-medium cursor-pointer text-zinc-800"
        style={{ fontFamily: FONT_INTER }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterSelect (copia local del chip del calendario)
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
      <span className={`pl-[11px] pr-1 font-normal ${active ? 'text-[#1e3a8a]/70' : 'text-zinc-500'}`}>
        {label}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pl-0 pr-7 h-[30px] outline-none text-[12.5px] font-medium cursor-pointer max-w-[220px]"
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
// SedeMultiSelect (copia local del filtro del calendario)
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
