// ============================================================================
// NoContestaAuditoriaView — ¿El "No contesta" fue del paciente?
//
// "No contesta" lo marca el coach a mano. Esta pantalla lo cruza con lo que
// pasó en la sala: en cuántos el paciente SÍ entró a la videollamada y el coach
// nunca abrió la consulta, por coach y por rango de fechas. Nació del cruce del
// 18-sep-2026 (53 de 234 "No contesta" con el paciente en la sala).
// Fuente: GET /api/calendario/no-contesta-auditoria (no-contesta-auditoria.service).
// ============================================================================

import { useState, useEffect, useCallback, Fragment, ReactNode } from 'react';
import { ChevronRight, Download, PhoneOff } from 'lucide-react';
import calendarioService, {
  AuditoriaNoContesta,
  CasoEspera,
  LlegadaPaciente,
} from '../../services/calendario.service';
import authService, { Sede } from '../../services/auth.service';
import { KpiCard, DateField, SedeMultiSelect } from './IndicadoresView';
import {
  FONT_INTER,
  FONT_MONO,
  SECTION_LABEL,
  CTA_OUTLINE,
  MonoAvatar,
  initialsOf,
} from './_tokens';
import { Ayuda } from './Ayuda';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

// Desde el 19-ago-2026 el navegador del paciente avisa cuando entra a la sala.
// Antes de eso no hay con qué saber si llegó: un rango anterior daría ceros que
// parecerían buenos.
const FECHA_MIN = '2026-08-20';

const TZ = 'America/Bogota';

function hoyIso(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sumarDias(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

type Preset = '7d' | '30d' | 'mes' | 'mesPasado';

function rangoDe(p: Preset): { from: string; to: string } {
  const hoy = hoyIso();
  const [y, m] = hoy.split('-').map(Number);
  let r: { from: string; to: string };
  switch (p) {
    case '7d':
      r = { from: sumarDias(hoy, -6), to: hoy };
      break;
    case '30d':
      r = { from: sumarDias(hoy, -29), to: hoy };
      break;
    case 'mes':
      r = { from: `${hoy.slice(0, 7)}-01`, to: hoy };
      break;
    case 'mesPasado': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const ultimo = new Date(Date.UTC(py, pm, 0, 12)).getUTCDate();
      const mm = String(pm).padStart(2, '0');
      r = { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(ultimo).padStart(2, '0')}` };
      break;
    }
  }
  return {
    from: r.from < FECHA_MIN ? FECHA_MIN : r.from,
    to: r.to < FECHA_MIN ? FECHA_MIN : r.to,
  };
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: 'Últimos 7 días' },
  { key: '30d', label: 'Últimos 30 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'mesPasado', label: 'Mes pasado' },
];

function pct(parte: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((parte / total) * 100)}%`;
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-CO', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

// Qué significa cada concepto. Un solo lugar para el texto: lo usan las
// tarjetas, los encabezados de la tabla y la lista de casos, y dos copias
// terminan diciendo cosas distintas.
const AYUDA = {
  citas:
    'Citas del coach en el rango cuya hora ya pasó. No cuenta Médico Corporativo (es presencial) ni citas Trepsi canceladas.',
  noContesta:
    'Citas que el coach marcó como «No contesta», es decir, en las que dijo que el paciente no apareció.',
  pacienteEnSala:
    'El paciente abrió el link y entró a la sala de video, pero el coach nunca abrió esa consulta. Aun así, la cita quedó como «No contesta».',
  yaEstaba:
    'El caso más claro: el paciente ya había entrado a la sala cuando el coach hizo clic en «No contesta». Llegó y nadie lo atendió.',
  atendiaOtro:
    'A esa hora el coach estaba en otra consulta: abrió otra entre 25 minutos antes de la cita y el momento de la marca. Suele indicar que se le cruzó la agenda.',
  llamo:
    'El coach usó el botón «Llamar» antes de marcar «No contesta». Lo esperado es llamar siempre antes de marcar.',
  entro:
    'Hora en que el paciente se conectó a la sala de video. No dice cuánto tiempo se quedó esperando.',
  marco: 'Hora en que el coach hizo clic en «No contesta».',
};

const LLEGADA: Record<LlegadaPaciente, { texto: string; cls: string; ayuda: string }> = {
  en_sala: {
    texto: 'Ya estaba en la sala',
    cls: 'bg-red-50 text-red-700 border-red-200',
    ayuda: 'Entró a la sala antes de que el coach marcara «No contesta».',
  },
  despues: {
    texto: 'Llegó después de la marca',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    ayuda: 'Entró hasta 15 minutos después de la hora de la cita, pero el coach ya lo había marcado «No contesta».',
  },
  tarde: {
    texto: 'Llegó tarde (+15 min)',
    cls: 'bg-zinc-50 text-zinc-500 border-zinc-200',
    ayuda: 'Entró más de 15 minutos después de la hora de la cita.',
  },
};

const AYUDA_QUE_PASO: ReactNode = (
  <div className="space-y-1.5">
    {(Object.keys(LLEGADA) as LlegadaPaciente[]).map((k) => (
      <div key={k}>
        <b>{LLEGADA[k].texto}:</b> {LLEGADA[k].ayuda.charAt(0).toLowerCase() + LLEGADA[k].ayuda.slice(1)}
      </div>
    ))}
  </div>
);

/** Encabezado de tabla con su ⓘ. */
function Th({
  children,
  ayuda,
  alinear = 'left',
  className = 'px-4 py-2.5',
}: {
  children: ReactNode;
  ayuda?: ReactNode;
  alinear?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th className={`font-semibold ${className} ${alinear === 'right' ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${alinear === 'right' ? 'justify-end' : ''}`}>
        {children}
        {ayuda && <Ayuda texto={ayuda} />}
      </span>
    </th>
  );
}

export function NoContestaAuditoriaView({ showToast }: Props) {
  const [{ from, to }, setRango] = useState(() => rangoDe('30d'));
  const [preset, setPreset] = useState<Preset | null>('30d');
  const [data, setData] = useState<AuditoriaNoContesta | null>(null);
  const [loading, setLoading] = useState(true);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedesSel, setSedesSel] = useState<string[]>(() => {
    const user = authService.getUser();
    if (user) return user.esGlobal ? [] : user.sedes;
    const s = authService.getSedeId();
    return s ? [s] : [];
  });

  useEffect(() => {
    authService
      .getSedes()
      .then((s) => {
        setSedes(s);
        setSedesSel((cur) => (cur.length > 0 ? cur : s.map((x) => x.sedeId)));
      })
      .catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    if (sedesSel.length === 0) return;
    setLoading(true);
    setAbiertos(new Set());
    try {
      setData(await calendarioService.getNoContestaAuditoria(from, to, undefined, sedesSel));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      showToast({
        type: 'error',
        message: e?.response?.data?.error?.message || 'No se pudo cargar la auditoría de No contesta.',
      });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, sedesSel, showToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function elegirPreset(p: Preset) {
    setRango(rangoDe(p));
    setPreset(p);
  }
  function setFrom(v: string) {
    if (!v) return;
    const nv = v < FECHA_MIN ? FECHA_MIN : v;
    setRango((r) => ({ from: nv, to: nv > r.to ? nv : r.to }));
    setPreset(null);
  }
  function setTo(v: string) {
    if (!v) return;
    const nv = v < FECHA_MIN ? FECHA_MIN : v;
    setRango((r) => ({ from: nv < r.from ? nv : r.from, to: nv }));
    setPreset(null);
  }

  function alternar(codigo: string) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  }

  const [exportando, setExportando] = useState(false);
  async function exportarExcel() {
    if (!data || data.casosDetalle.length === 0) return;
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const nombre = new Map(data.porCoach.map((c) => [c.medicoCodigo, c.nombre]));
      const aoa: (string | number)[][] = [
        ['Coach', 'Código', 'Fecha', 'Hora cita', 'Paciente', 'Entró a la sala', 'Marcó No contesta', 'Qué pasó', 'Atendía a otro', 'Llamó antes de marcar'],
        ...data.casosDetalle.map((c) => [
          nombre.get(c.medicoCodigo) ?? c.medicoCodigo,
          c.medicoCodigo,
          fecha(c.cita),
          hora(c.cita),
          c.paciente,
          hora(c.pacienteEntro),
          hora(c.marcado),
          LLEGADA[c.llegada].texto,
          c.atendiaOtro ? 'Sí' : 'No',
          c.llamo ? 'Sí' : 'No',
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 30 },
        { wch: 15 }, { wch: 17 }, { wch: 26 }, { wch: 14 }, { wch: 20 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Paciente en sala');
      XLSX.writeFile(wb, `no_contesta_paciente_en_sala_${from}_${to}.xlsx`);
    } catch {
      showToast({ type: 'error', message: 'No se pudo exportar el Excel.' });
    } finally {
      setExportando(false);
    }
  }

  const casosDe = (codigo: string): CasoEspera[] =>
    (data?.casosDetalle ?? []).filter((c) => c.medicoCodigo === codigo);

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 flex items-center gap-2">
            <PhoneOff className="w-5 h-5 text-[#1f3a8a]" />
            Auditoría No contesta
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 max-w-[680px]">
            Citas marcadas «No contesta» en las que el paciente sí entró a la sala de video y el
            coach nunca abrió la consulta.
          </p>
        </div>
        <button
          type="button"
          onClick={exportarExcel}
          disabled={!data || data.casosDetalle.length === 0 || exportando}
          className={`${CTA_OUTLINE} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <Download className="w-4 h-4" />
          {exportando ? 'Exportando…' : 'Descargar Excel'}
        </button>
      </div>

      {/* Filtros + KPIs */}
      <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-3 flex-wrap">
          <span className={SECTION_LABEL}>Filtros</span>
          <SedeMultiSelect sedes={sedes} value={sedesSel} onChange={setSedesSel} />
          <div className="flex items-center gap-2">
            <DateField label="Desde" value={from} min={FECHA_MIN} max={to} onChange={setFrom} />
            <DateField label="Hasta" value={to} min={from} onChange={setTo} />
          </div>
        </div>
        <div className="px-5 py-2.5 border-b border-zinc-200 flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => {
            const on = preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => elegirPreset(p.key)}
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

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200">
          <KpiCard
            label="No contesta"
            value={data?.noContesta ?? 0}
            caption={data ? `${pct(data.noContesta, data.citas)} de ${data.citas} citas` : undefined}
            loading={loading}
            accent="amber"
            ayuda={`${AYUDA.noContesta} El porcentaje es sobre todas las citas del rango.`}
          />
          <KpiCard
            label="Paciente en sala"
            value={data?.casos ?? 0}
            caption={data ? `${pct(data.casos, data.noContesta)} de los No contesta` : undefined}
            loading={loading}
            accent="red"
            ayuda={`${AYUDA.pacienteEnSala} El porcentaje es sobre los «No contesta».`}
          />
          <KpiCard
            label="Ya estaba al marcar"
            value={data?.enSala ?? 0}
            caption={data ? `${data.despues} llegaron después · ${data.tarde} tarde` : undefined}
            loading={loading}
            accent="red"
            ayuda={AYUDA.yaEstaba}
          />
          <KpiCard
            label="Atendía a otro"
            value={data?.atendiaOtro ?? 0}
            caption={data ? `${pct(data.atendiaOtro, data.casos)} de los casos` : undefined}
            loading={loading}
            accent="zinc"
            ayuda={AYUDA.atendiaOtro}
          />
          <KpiCard
            label="Llamados antes de marcar"
            value={data?.llamadosAntes ?? 0}
            caption={data ? `${pct(data.llamadosAntes, data.noContesta)} de los No contesta` : undefined}
            loading={loading}
            accent="ink"
            ayuda={AYUDA.llamo}
          />
        </div>
      </div>

      {/* Por coach */}
      <div className="mt-6">
        <div className="mb-2.5">
          <span className={SECTION_LABEL}>Por coach</span>
          <span className="ml-2 text-[11.5px] text-zinc-400">clic en una fila para ver los casos</span>
        </div>
        <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 text-[11px] uppercase tracking-[0.06em]">
                <Th>Coach</Th>
                <Th alinear="right" ayuda={AYUDA.citas}>Citas</Th>
                <Th alinear="right" ayuda={AYUDA.noContesta}>No contesta</Th>
                <Th alinear="right" ayuda={AYUDA.pacienteEnSala}>Paciente en sala</Th>
                <Th alinear="right" ayuda={AYUDA.yaEstaba}>Ya estaba al marcar</Th>
                <Th alinear="right" ayuda={AYUDA.atendiaOtro}>Atendía a otro</Th>
                <Th alinear="right" ayuda={AYUDA.llamo}>Llamó antes</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">Cargando…</td>
                </tr>
              ) : !data || data.porCoach.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">
                    No hay citas «No contesta» en el rango.
                  </td>
                </tr>
              ) : (
                data.porCoach.map((c) => {
                  const abierto = abiertos.has(c.medicoCodigo);
                  const num = { fontFamily: FONT_MONO };
                  return (
                    <Fragment key={c.medicoCodigo}>
                      <tr
                        onClick={() => c.casos > 0 && alternar(c.medicoCodigo)}
                        className={`border-b border-zinc-100 last:border-0 ${
                          c.casos > 0 ? 'hover:bg-zinc-50/60 cursor-pointer' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <ChevronRight
                              className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                                c.casos > 0 ? 'text-zinc-400' : 'text-transparent'
                              } ${abierto ? 'rotate-90' : ''}`}
                            />
                            <MonoAvatar initials={initialsOf(c.nombre)} size={28} />
                            <div className="min-w-0">
                              <div className="font-medium text-zinc-800 truncate">{c.nombre}</div>
                              <div className="text-[11px] text-zinc-400">{c.medicoCodigo}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700" style={num}>
                          {c.citas}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-700" style={num}>
                          {c.noContesta}
                          <span className="text-zinc-400 text-[11px] ml-1">({pct(c.noContesta, c.citas)})</span>
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums ${
                            c.casos > 0 ? 'font-semibold text-red-700' : 'text-zinc-400'
                          }`}
                          style={num}
                        >
                          {c.casos}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${c.enSala > 0 ? 'text-red-700' : 'text-zinc-400'}`} style={num}>
                          {c.enSala}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600" style={num}>
                          {c.atendiaOtro}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600" style={num}>
                          {c.llamadosAntes}
                          <span className="text-zinc-400 text-[11px] ml-1">de {c.noContesta}</span>
                        </td>
                      </tr>
                      {abierto && (
                        <tr className="bg-zinc-50/70">
                          <td colSpan={7} className="px-4 pb-3 pt-1">
                            <CasosCoach casos={casosDe(c.medicoCodigo)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {data && data.porCoach.length > 0 && !loading && (
              <tfoot>
                <tr className="bg-zinc-50 border-t border-zinc-200 font-semibold text-zinc-800">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: FONT_MONO }}>{data.citas}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-700" style={{ fontFamily: FONT_MONO }}>
                    {data.noContesta}
                    <span className="text-zinc-400 text-[11px] ml-1 font-normal">({pct(data.noContesta, data.citas)})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-700" style={{ fontFamily: FONT_MONO }}>{data.casos}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-700" style={{ fontFamily: FONT_MONO }}>{data.enSala}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: FONT_MONO }}>{data.atendiaOtro}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: FONT_MONO }}>
                    {data.llamadosAntes}
                    <span className="text-zinc-400 text-[11px] ml-1 font-normal">de {data.noContesta}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Cómo se mide: sin esto el número se discute en vez de usarse. */}
      <div className="mt-4 text-[12px] leading-relaxed text-zinc-500 max-w-[860px]">
        <p>
          <b className="text-zinc-600">Paciente en sala</b>: el navegador del paciente se conectó a la sala de
          esa cita y el coach nunca abrió la consulta. <b className="text-zinc-600">Ya estaba al marcar</b>:
          entró antes del clic en «No contesta». <b className="text-zinc-600">Llegó después</b>: entró hasta 15
          minutos después de la hora, pero ya estaba marcado. No mide cuánto tiempo esperó el paciente, solo que
          llegó.
        </p>
        <p className="mt-1">
          Sin Médico Corporativo (es presencial) ni citas Trepsi canceladas. Datos desde el 20 de agosto de
          2026: antes no se registraba la entrada del paciente a la sala.
        </p>
      </div>
    </div>
  );
}

function CasosCoach({ casos }: { casos: CasoEspera[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-zinc-400 text-[10.5px] uppercase tracking-[0.06em] border-b border-zinc-100">
            <Th className="px-3 py-2">Fecha</Th>
            <Th className="px-3 py-2">Cita</Th>
            <Th className="px-3 py-2">Paciente</Th>
            <Th className="px-3 py-2" ayuda={AYUDA.entro}>Entró</Th>
            <Th className="px-3 py-2" ayuda={AYUDA.marco}>Marcó</Th>
            <Th className="px-3 py-2" ayuda={AYUDA_QUE_PASO}>Qué pasó</Th>
            <Th className="px-3 py-2" ayuda={AYUDA.atendiaOtro}>Atendía a otro</Th>
            <Th className="px-3 py-2" ayuda={AYUDA.llamo}>Llamó</Th>
          </tr>
        </thead>
        <tbody>
          {casos.map((c) => (
            <tr key={c.historiaId} className="border-t border-zinc-100 first:border-0">
              <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{fecha(c.cita)}</td>
              <td className="px-3 py-1.5 font-semibold text-zinc-800 tabular-nums" style={{ fontFamily: FONT_MONO }}>
                {hora(c.cita)}
              </td>
              <td className="px-3 py-1.5 text-zinc-800">{c.paciente || '—'}</td>
              <td className="px-3 py-1.5 tabular-nums text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                {hora(c.pacienteEntro)}
              </td>
              <td className="px-3 py-1.5 tabular-nums text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                {hora(c.marcado)}
              </td>
              <td className="px-3 py-1.5">
                <Ayuda texto={LLEGADA[c.llegada].ayuda}>
                  <span className={`inline-block px-2 py-0.5 rounded border text-[11.5px] font-medium ${LLEGADA[c.llegada].cls}`}>
                    {LLEGADA[c.llegada].texto}
                  </span>
                </Ayuda>
              </td>
              <td className="px-3 py-1.5 text-zinc-600">{c.atendiaOtro ? 'Sí' : 'No'}</td>
              <td className="px-3 py-1.5 text-zinc-600">{c.llamo ? 'Sí' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
