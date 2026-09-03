// ============================================================================
// AccOperacionView — Valoración Corporal ACC dentro del Panel Coordinador.
//
// Reusa el shell y el lenguaje visual que ya existen (`_tokens.tsx`): no hay un
// panel de coordinador aparte para nutrición ni para ACC — es uno solo, y esto
// es una sección más al lado de Calendario y Torniquete.
//
// Es la contraparte operativa de `/acc` (la agenda del fisioterapeuta). Acá el
// coordinador hace las tres cosas que el evaluador NO puede hacer:
//   1. Cargar la base que entrega Sol Médica.
//   2. Mover el embudo: contactado → agendado (con fecha) → no-show.
//   3. Vigilar el volcado al Excel que consulta el cliente.
//
// EL PUNTO 2 ES EL QUE DESTRABA TODO. Mientras nadie escriba `cita_fecha`, el
// filtro "Hoy" de la agenda del fisio devuelve una lista vacía: no hay a quién
// medir porque nadie quedó citado para hoy.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  FileSpreadsheet,
  MessageSquare,
  RefreshCw,
  Search,
  Upload,
  UserX,
} from 'lucide-react';
import accService, { type AccPaciente, type Embudo } from '../../services/acc.service';
import {
  CTA_OUTLINE,
  CTA_PRIMARY,
  FONT_INTER,
  FONT_MONO,
  MonoAvatar,
  Pill,
  SECTION_LABEL,
  TOKENS,
  initialsOf,
} from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

type FiltroEstado = 'todos' | 'cargado' | 'contactado' | 'agendado' | 'asistio' | 'no_show';

const FILTROS: Array<{ id: FiltroEstado; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'cargado', label: 'Sin contactar' },
  { id: 'contactado', label: 'Contactados' },
  { id: 'agendado', label: 'Agendados' },
  { id: 'asistio', label: 'Asistieron' },
  { id: 'no_show', label: 'No asistieron' },
];

const PILL_POR_ESTADO: Record<string, { variant: 'ok' | 'warn' | 'bad' | 'mute' | 'now'; label: string }> = {
  cargado: { variant: 'mute', label: 'Sin contactar' },
  contactado: { variant: 'now', label: 'Contactado' },
  agendado: { variant: 'warn', label: 'Agendado' },
  confirmado: { variant: 'warn', label: 'Confirmado' },
  asistio: { variant: 'ok', label: 'Asistió' },
  no_show: { variant: 'bad', label: 'No asistió' },
  descartado: { variant: 'mute', label: 'Descartado' },
};

/** Hoy en Colombia (UTC-5). El navegador del coordinador puede estar en otra zona. */
function hoyColombia(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

// ---------------------------------------------------------------------------

export function AccOperacionView({ showToast }: Props) {
  const [pacientes, setPacientes] = useState<AccPaciente[]>([]);
  const [embudo, setEmbudo] = useState<Embudo | null>(null);
  const [sheet, setSheet] = useState<{ configurado: boolean; pendientes: number } | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [importador, setImportador] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [ps, emb, sh] = await Promise.all([
        accService.listarPacientes({
          estado: filtro === 'todos' ? undefined : filtro,
          q: busqueda.trim() || undefined,
        }),
        accService.getEmbudo(),
        accService.estadoSheet(),
      ]);
      setPacientes(ps);
      setEmbudo(emb);
      setSheet(sh);
    } catch {
      showToast({ type: 'error', message: 'No se pudo cargar la operación de ACC.' });
    } finally {
      setCargando(false);
    }
  }, [filtro, busqueda, showToast]);

  // Debounce solo para el buscador; el cambio de filtro entra derecho.
  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  const mover = async (p: AccPaciente, estado: string, citaFecha?: string) => {
    try {
      await accService.marcarEstado(p.id, estado, citaFecha);
      showToast({
        type: 'success',
        message:
          estado === 'agendado'
            ? `${p.nombreCompleto} quedó citado.`
            : `${p.nombreCompleto}: ${PILL_POR_ESTADO[estado]?.label ?? estado}.`,
      });
      cargar();
    } catch {
      showToast({ type: 'error', message: 'No se pudo actualizar el estado.' });
    }
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await accService.exportarSheet();
      showToast({
        type: r.errores > 0 ? 'error' : 'success',
        message:
          r.errores > 0
            ? `${r.exportadas} filas al Excel, ${r.errores} fallaron.`
            : `${r.exportadas} filas volcadas al Excel.`,
      });
      cargar();
    } catch {
      showToast({ type: 'error', message: 'No se pudo exportar al Excel.' });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[19px] font-semibold text-zinc-900 tracking-tight">
            Valoración Corporal ACC
          </h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">
            La cohorte de Sol Médica y su recorrido hasta la atención facturable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className={CTA_OUTLINE} onClick={cargar} disabled={cargando}>
            <RefreshCw className={`w-[14px] h-[14px] ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            className={CTA_PRIMARY}
            style={{ backgroundColor: TOKENS.accent }}
            onClick={() => setImportador(true)}
          >
            <Upload className="w-[14px] h-[14px]" />
            Cargar base
          </button>
        </div>
      </div>

      {/* Embudo */}
      <div className={`${SECTION_LABEL} pb-2`}>EMBUDO</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-6">
        <Escalon label="Base entregada" valor={embudo?.base} />
        <Escalon label="Contactados" valor={embudo?.contactados} de={embudo?.base} />
        <Escalon label="Agendados" valor={embudo?.agendados} de={embudo?.base} />
        <Escalon label="Asistieron" valor={embudo?.asistieron} de={embudo?.base} destacado />
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: (embudo?.tasaNoShow ?? 0) > 25 ? '#fecaca' : TOKENS.line,
            background: (embudo?.tasaNoShow ?? 0) > 25 ? '#fef2f2' : '#fff',
          }}
        >
          <div className={SECTION_LABEL}>Tasa de no-show</div>
          <div
            className="text-[22px] font-semibold text-zinc-900 tabular-nums mt-1"
            style={{ fontFamily: FONT_MONO }}
          >
            {embudo?.tasaNoShow != null ? `${embudo.tasaNoShow}%` : '—'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">sobre los agendados</div>
        </div>
      </div>

      {/* Estado del Excel del cliente */}
      {sheet && (
        <div
          className="flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 mb-6"
          style={{ borderColor: TOKENS.line, background: TOKENS.panel }}
        >
          <FileSpreadsheet className="w-[15px] h-[15px] text-zinc-400 shrink-0" />
          {sheet.configurado ? (
            <>
              <span className="text-[13px] text-zinc-700">
                Excel de Sol Médica conectado.{' '}
                {sheet.pendientes > 0 ? (
                  <strong className="text-zinc-900">{sheet.pendientes} filas sin volcar</strong>
                ) : (
                  'Todo al día.'
                )}
              </span>
              {sheet.pendientes > 0 && (
                <button
                  className={`${CTA_OUTLINE} ml-auto`}
                  onClick={exportar}
                  disabled={exportando}
                >
                  {exportando ? 'Volcando…' : 'Volcar ahora'}
                </button>
              )}
            </>
          ) : (
            <span className="text-[13px] text-amber-800">
              El volcado al Excel está inactivo: faltan <code>ACC_SHEETS_ID</code> y la cuenta de
              servicio de Google. Las valoraciones se acumulan y salen todas al configurarlo.
            </span>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`h-[30px] px-3 rounded-md text-[12.5px] font-medium border transition-colors ${
              filtro === f.id
                ? 'border-[#1f3a8a] bg-[#eef2ff] text-[#1e3a8a]'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-[14px] h-[14px] text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o cédula"
            className="h-[30px] w-56 pl-8 pr-3 rounded-md border border-zinc-300 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#1f3a8a]/15"
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: TOKENS.line }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-zinc-50 border-b" style={{ borderColor: TOKENS.line }}>
                <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 text-[11px] uppercase tracking-[0.06em]">Paciente</th>
                <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 text-[11px] uppercase tracking-[0.06em]">Empresa</th>
                <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 text-[11px] uppercase tracking-[0.06em]">Estado</th>
                <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 text-[11px] uppercase tracking-[0.06em]">Cita</th>
                <th className="text-right px-4 py-2.5 font-semibold text-zinc-500 text-[11px] uppercase tracking-[0.06em]">Mover a</th>
              </tr>
            </thead>
            <tbody>
              {pacientes.map((p) => (
                <Fila key={p.id} p={p} onMover={mover} />
              ))}
              {pacientes.length === 0 && !cargando && (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <p className="text-[13.5px] text-zinc-600 font-medium">
                      {busqueda || filtro !== 'todos'
                        ? 'Ningún paciente coincide con el filtro.'
                        : 'Todavía no hay ninguna cohorte cargada.'}
                    </p>
                    {!busqueda && filtro === 'todos' && (
                      <p className="text-[12.5px] text-zinc-500 mt-1.5 max-w-md mx-auto">
                        Subí el archivo que entrega Sol Médica con «Cargar base». Hasta
                        entonces, la agenda del fisioterapeuta también está vacía.
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {importador && (
        <ImportadorCohorte
          onCerrar={() => setImportador(false)}
          onListo={() => {
            setImportador(false);
            cargar();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Escalon({
  label,
  valor,
  de,
  destacado,
}: {
  label: string;
  valor?: number;
  de?: number;
  destacado?: boolean;
}) {
  const pct = de && de > 0 && valor != null ? Math.round((valor / de) * 100) : null;
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: destacado ? '#bbf7d0' : TOKENS.line,
        background: destacado ? '#f0fdf4' : '#fff',
      }}
    >
      <div className={SECTION_LABEL}>{label}</div>
      <div
        className="text-[22px] font-semibold text-zinc-900 tabular-nums mt-1"
        style={{ fontFamily: FONT_MONO }}
      >
        {valor ?? '—'}
      </div>
      <div className="text-[11px] text-zinc-500 mt-0.5">
        {pct != null ? `${pct}% de la base` : ' '}
      </div>
    </div>
  );
}

function Fila({
  p,
  onMover,
}: {
  p: AccPaciente;
  onMover: (p: AccPaciente, estado: string, citaFecha?: string) => void;
}) {
  const pill = PILL_POR_ESTADO[p.estado] ?? PILL_POR_ESTADO.cargado;
  const cerrado = p.estado === 'asistio' || p.estado === 'descartado';

  return (
    <tr className="border-b last:border-0 hover:bg-zinc-50/60" style={{ borderColor: TOKENS.line }}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <MonoAvatar initials={initialsOf(p.nombreCompleto)} size={28} />
          <div className="min-w-0">
            <div className="font-medium text-zinc-900 truncate">{p.nombreCompleto}</div>
            <div className="text-[11.5px] text-zinc-500 tabular-nums" style={{ fontFamily: FONT_MONO }}>
              {p.numeroId}
              {p.celular ? ` · ${p.celular}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-zinc-600">{p.empresa || '—'}</td>
      <td className="px-4 py-2.5">
        <Pill variant={pill.variant}>{pill.label}</Pill>
      </td>
      <td className="px-4 py-2.5 text-zinc-600 tabular-nums" style={{ fontFamily: FONT_MONO }}>
        {fechaCorta(p.citaFecha)}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {cerrado ? (
            <span className="text-[11.5px] text-zinc-400 pr-1">
              {p.estado === 'asistio' ? 'Cerrado por la valoración' : '—'}
            </span>
          ) : (
            <>
              {p.estado === 'cargado' && (
                <BotonAccion
                  icon={<MessageSquare className="w-[13px] h-[13px]" />}
                  label="Contactado"
                  onClick={() => onMover(p, 'contactado')}
                />
              )}
              {/* La fecha es lo que hace aparecer al paciente en la agenda del
                  fisioterapeuta. Sin esto, "Hoy" le muestra una lista vacía. */}
              <label className="inline-flex items-center gap-1 h-[28px] px-2 rounded border border-zinc-300 bg-white text-[12px] text-zinc-700 cursor-pointer hover:bg-zinc-50">
                <CalendarPlus className="w-[13px] h-[13px] text-zinc-500" />
                <span className="hidden lg:inline">
                  {p.estado === 'agendado' ? 'Recitar' : 'Citar'}
                </span>
                <input
                  type="date"
                  className="sr-only"
                  defaultValue={hoyColombia()}
                  onChange={(e) => {
                    if (e.target.value) onMover(p, 'agendado', `${e.target.value}T08:00:00-05:00`);
                  }}
                />
              </label>
              {p.estado === 'agendado' && (
                <BotonAccion
                  icon={<UserX className="w-[13px] h-[13px]" />}
                  label="No asistió"
                  peligro
                  onClick={() => onMover(p, 'no_show')}
                />
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function BotonAccion({
  icon,
  label,
  onClick,
  peligro,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  peligro?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border text-[12px] transition-colors ${
        peligro
          ? 'border-red-200 text-red-700 bg-white hover:bg-red-50'
          : 'border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50'
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Importador de la base
//
// Sol Médica manda un Excel, no un JSON. Se lee acá con SheetJS (ya está en el
// bundle) y se mapean los encabezados por sinónimos, porque el archivo no viene
// con un formato pactado. Nada se envía hasta que el coordinador ve QUÉ se
// detectó: cargar 300 pacientes con la columna equivocada se limpia a mano.
// ---------------------------------------------------------------------------

const SINONIMOS: Record<string, string[]> = {
  numeroId: ['cedula', 'cédula', 'documento', 'identificacion', 'identificación', 'numero id', 'no documento', 'nro documento', 'id'],
  nombreCompleto: ['nombre completo', 'nombre', 'paciente', 'nombres y apellidos'],
  celular: ['celular', 'telefono', 'teléfono', 'movil', 'móvil', 'contacto'],
  email: ['email', 'correo', 'e-mail', 'correo electronico', 'correo electrónico'],
  edad: ['edad'],
  sexo: ['sexo', 'genero', 'género'],
  empresa: ['empresa', 'compañia', 'compañía', 'cliente', 'convenio'],
};

function normalizar(h: string): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Empareja los encabezados del archivo con los campos que espera el backend. */
function mapearColumnas(headers: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const [campo, alias] of Object.entries(SINONIMOS)) {
    const encontrado = headers.find((h) => {
      const n = normalizar(h);
      return alias.some((a) => n === a) || alias.some((a) => n.includes(a) && a.length > 3);
    });
    if (encontrado) mapa[campo] = encontrado;
  }
  return mapa;
}

interface FilaImportada {
  [k: string]: unknown;
  numeroId: string;
  nombreCompleto: string;
  edad?: number | null;
  sexo?: string | null;
  celular?: string | null;
  email?: string | null;
  empresa?: string | null;
}

function ImportadorCohorte({
  onCerrar,
  onListo,
  showToast,
}: {
  onCerrar: () => void;
  onListo: () => void;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [cohorte, setCohorte] = useState(`sol-medica-${hoyColombia().slice(0, 7)}`);
  const [filas, setFilas] = useState<FilaImportada[]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [descartadas, setDescartadas] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const leerArchivo = async (file: File) => {
    setError(null);
    try {
      // Carga diferida: SheetJS pesa ~430 KB y solo hace falta al importar.
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const crudo = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: '' });

      if (crudo.length === 0) {
        setError('El archivo no tiene filas.');
        return;
      }

      const headers = Object.keys(crudo[0]);
      const m = mapearColumnas(headers);
      if (!m.numeroId || !m.nombreCompleto) {
        setError(
          'No se encontró la columna de cédula o la de nombre. Los encabezados leídos fueron: ' +
            headers.join(', ')
        );
        return;
      }

      const validas: FilaImportada[] = [];
      let fuera = 0;
      for (const r of crudo) {
        const numeroId = String(r[m.numeroId] ?? '').trim();
        const nombreCompleto = String(r[m.nombreCompleto] ?? '').trim();
        if (!numeroId || !nombreCompleto) {
          fuera++;
          continue;
        }
        const edadRaw = m.edad ? Number(r[m.edad]) : NaN;
        validas.push({
          numeroId,
          nombreCompleto,
          edad: Number.isFinite(edadRaw) ? edadRaw : null,
          sexo: m.sexo ? String(r[m.sexo] ?? '').trim() || null : null,
          celular: m.celular ? String(r[m.celular] ?? '').trim() || null : null,
          email: m.email ? String(r[m.email] ?? '').trim() || null : null,
          empresa: m.empresa ? String(r[m.empresa] ?? '').trim() || null : null,
        });
      }

      setMapa(m);
      setFilas(validas);
      setDescartadas(fuera);
    } catch {
      setError('No se pudo leer el archivo. ¿Es un .xlsx o .csv?');
    }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await accService.cargarCohorte(cohorte.trim(), filas);
      showToast({
        type: 'success',
        message:
          `${r.insertados} pacientes nuevos, ${r.actualizados} actualizados` +
          (r.omitidos ? `, ${r.omitidos} omitidos.` : '.'),
      });
      onListo();
    } catch {
      showToast({ type: 'error', message: 'No se pudo cargar la base.' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div
        className="bg-white rounded-xl border w-full max-w-2xl max-h-[86vh] overflow-y-auto"
        style={{ borderColor: TOKENS.line, fontFamily: FONT_INTER }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: TOKENS.line }}>
          <h2 className="text-[16px] font-semibold text-zinc-900">Cargar base de pacientes</h2>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">
            El archivo que entrega Sol Médica, tal cual llega. Reenviar el mismo no duplica:
            actualiza los datos de contacto y respeta a quien ya asistió.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[12px] text-zinc-600 mb-1.5">Nombre de la cohorte</label>
            <input
              value={cohorte}
              onChange={(e) => setCohorte(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1f3a8a]/15"
            />
            <p className="text-[11.5px] text-zinc-500 mt-1">
              Identifica el lote. La idempotencia es por cédula + cohorte.
            </p>
          </div>

          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) leerArchivo(f);
              }}
            />
            <button className={CTA_OUTLINE} onClick={() => inputRef.current?.click()}>
              <Upload className="w-[14px] h-[14px]" />
              Elegir archivo (.xlsx o .csv)
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-amber-900">{error}</p>
            </div>
          )}

          {filas.length > 0 && (
            <>
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />
                <div className="text-[12.5px] text-green-900">
                  <strong>{filas.length} pacientes listos.</strong>{' '}
                  {descartadas > 0 && `${descartadas} filas sin cédula o sin nombre se descartaron. `}
                  Columnas detectadas:{' '}
                  {Object.entries(mapa)
                    .map(([campo, col]) => `${campo} ← «${col}»`)
                    .join(' · ')}
                </div>
              </div>

              <div>
                <div className={`${SECTION_LABEL} pb-1.5`}>PRIMERAS FILAS</div>
                <div className="rounded-md border overflow-hidden" style={{ borderColor: TOKENS.line }}>
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {filas.slice(0, 5).map((f, i) => (
                        <tr key={i} className="border-b last:border-0" style={{ borderColor: TOKENS.line }}>
                          <td className="px-3 py-1.5 font-medium text-zinc-800">{f.nombreCompleto}</td>
                          <td className="px-3 py-1.5 text-zinc-500 tabular-nums" style={{ fontFamily: FONT_MONO }}>
                            {f.numeroId}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-500">{f.celular || '—'}</td>
                          <td className="px-3 py-1.5 text-zinc-500">{f.empresa || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t flex justify-end gap-2" style={{ borderColor: TOKENS.line }}>
          <button className={CTA_OUTLINE} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            className={CTA_PRIMARY}
            style={{ backgroundColor: TOKENS.accent, opacity: filas.length === 0 ? 0.5 : 1 }}
            disabled={filas.length === 0 || enviando || !cohorte.trim()}
            onClick={enviar}
          >
            {enviando ? 'Cargando…' : `Cargar ${filas.length} pacientes`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AccOperacionView;
