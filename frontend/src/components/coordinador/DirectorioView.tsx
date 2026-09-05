// ============================================================================
// DirectorioView — "Base Profesionales" (privado).
//
// Muestra el directorio compartido de Bodytech: la base `bodytech_profesionales`
// que también lee BODYTECH-ACC. Tres tablas, tres pestañas.
//
// OJO con el nombre: NO es la sección "Profesionales" de este panel. Aquella es
// la tabla `profesionales` de consulta (médicos y coaches con agenda, foto y
// firma). Ésta es el directorio de RRHH de TODA la cadena — 141 personas en 4
// roles, incluidos fisioterapeutas y nutricionistas que no usan esta app.
//
// La diferencia que importa: acá una persona es UNA fila aunque cubra 5 sedes.
// En la tabla de consulta son 5 filas con 5 ids, por el UNIQUE (codigo, sede_id).
//
// Solo lectura. Se escribe corriendo el importador del Excel de RRHH, que vive
// en el repo de ACC.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Database, RefreshCw, Search, Building2, Users, Network } from 'lucide-react';
import directorioService, {
  ResumenDirectorio,
  SedeDirectorio,
  ProfesionalDirectorio,
} from '../../services/directorio.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, Pill } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

type Tab = 'resumen' | 'sedes' | 'profesionales';

const ROLES: { valor: string; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Todos los roles' },
  { valor: 'medico', etiqueta: 'Médicos' },
  { valor: 'evaluador', etiqueta: 'Evaluadores' },
  { valor: 'fisioterapeuta', etiqueta: 'Fisioterapeutas' },
  { valor: 'nutricionista', etiqueta: 'Nutricionistas' },
];

/** Los tres ámbitos, con el color que los distingue de un vistazo. */
const AMBITO_PILL: Record<string, 'ok' | 'now' | 'mute'> = {
  sede: 'ok',
  virtual: 'now',
  corporativo: 'mute',
};

export function DirectorioView({ showToast }: Props) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resumen, setResumen] = useState<ResumenDirectorio | null>(null);
  const [sedes, setSedes] = useState<SedeDirectorio[]>([]);
  const [profesionales, setProfesionales] = useState<ProfesionalDirectorio[]>([]);

  // Filtros de la pestaña de planta.
  const [rol, setRol] = useState('');
  const [sedeFiltro, setSedeFiltro] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([directorioService.resumen(), directorioService.sedes()]);
      setResumen(r);
      setSedes(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo leer el directorio';
      setError(msg);
      showToast({ type: 'error', message: msg });
    } finally {
      setCargando(false);
    }
  }, [showToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /*
   * La planta se pide aparte y con debounce: la caja de búsqueda golpea la otra
   * base en cada tecla si no. 250 ms alcanza para que se sienta inmediato sin
   * disparar una consulta por letra.
   */
  useEffect(() => {
    if (tab !== 'profesionales') return;
    const t = setTimeout(() => {
      directorioService
        .profesionales({ rol, sede: sedeFiltro, q: busqueda })
        .then(setProfesionales)
        .catch((e) => showToast({ type: 'error', message: e?.message ?? 'Error' }));
    }, 250);
    return () => clearTimeout(t);
  }, [tab, rol, sedeFiltro, busqueda, showToast]);

  const nombreSede = (slug: string) => sedes.find((s) => s.slug === slug)?.nombre ?? slug;

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-[19px] font-semibold text-zinc-900 tracking-tight flex items-center gap-2">
            <Database className="w-[17px] h-[17px] text-zinc-400" />
            Base Profesionales
          </h1>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">
            Directorio compartido de Bodytech · base{' '}
            <span style={{ fontFamily: FONT_MONO }}>bodytech_profesionales</span> · solo lectura
          </p>
        </div>
        <button
          onClick={cargar}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors"
        >
          <RefreshCw className={`w-[14px] h-[14px] ${cargando ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {/* Aclaración: hay DOS cosas llamadas "profesionales" en este panel. */}
      <div className="mt-3 mb-5 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        No confundir con la sección <strong>Profesionales</strong> de este panel, que es la
        agenda de médicos y coaches de consulta. Ésta es la planta completa que entrega RRHH —
        también fisioterapeutas y nutricionistas, que no usan esta aplicación.
      </div>

      {/* Pestañas */}
      <div className="flex items-center gap-1 border-b border-zinc-200 mb-5">
        {([
          ['resumen', 'Resumen', Network],
          ['sedes', `Sedes${resumen ? ` · ${resumen.sedes}` : ''}`, Building2],
          ['profesionales', `Planta${resumen ? ` · ${resumen.profesionales}` : ''}`, Users],
        ] as const).map(([id, etiqueta, Icono]) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={`inline-flex items-center gap-1.5 px-3 h-9 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-[#1f3a8a] text-[#1e3a8a]'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Icono className="w-[14px] h-[14px]" />
            {etiqueta}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 mb-4">
          {error}
        </div>
      )}

      {cargando && !resumen && <p className="text-[13px] text-zinc-500">Cargando…</p>}

      {/* ── Resumen ─────────────────────────────────────────────────── */}
      {tab === 'resumen' && resumen && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Tarjeta titulo="Sedes" valor={resumen.sedes} nota="toda la cadena, Athletic incluido" />
            <Tarjeta
              titulo="Profesionales"
              valor={resumen.profesionales}
              nota="cada persona una sola vez"
            />
            <Tarjeta
              titulo="Asignaciones"
              valor={resumen.asignaciones}
              nota="parejas persona ↔ sede"
            />
          </div>

          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Sedes cubiertas, de {resumen.sedes}</div>
            <p className="text-[12px] text-zinc-500 mb-2">
              Separado a propósito: los 9 de la unidad médica virtual cubren todas las sedes, y
              sumados esconden dónde no hay nadie en sitio.
            </p>
            <Tabla
              cabeceras={['Rol', 'En sitio', 'Por teleconsulta']}
              filas={resumen.cobertura.map((c) => [
                <span className="capitalize">{c.rol}</span>,
                <Mono>{c.presencial}</Mono>,
                <Mono>{c.virtual || '—'}</Mono>,
              ])}
            />
          </div>

          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Planta por rol y ámbito</div>
            <Tabla
              cabeceras={['Rol', 'Ámbito', 'Personas', 'Asignaciones']}
              filas={resumen.porRol.map((r) => [
                <span className="capitalize">{r.rol}</span>,
                <Pill variant={AMBITO_PILL[r.ambito] ?? 'mute'}>{r.ambito}</Pill>,
                <Mono>{r.personas}</Mono>,
                <Mono>{r.asignaciones}</Mono>,
              ])}
            />
          </div>

          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Sedes por regional</div>
            <Tabla
              cabeceras={['Regional', 'Sedes']}
              filas={resumen.porRegional.map((r) => [r.regional, <Mono>{r.sedes}</Mono>])}
            />
          </div>
        </div>
      )}

      {/* ── Sedes ───────────────────────────────────────────────────── */}
      {tab === 'sedes' && (
        <Tabla
          cabeceras={['Sede', 'Slug', 'Regional', 'Marca', 'Ciudad', 'Personas']}
          filas={sedes.map((s) => [
            s.nombre,
            <Mono>{s.slug}</Mono>,
            <span className="text-zinc-500">{s.regional}</span>,
            <Pill variant={s.marca === 'athletic' ? 'now' : 'mute'} withDot={false}>
              {s.marca}
            </Pill>,
            s.ciudad ?? <span className="text-zinc-300">sin dato</span>,
            <Mono>{s.profesionales}</Mono>,
          ])}
        />
      )}

      {/* ── Planta ──────────────────────────────────────────────────── */}
      {tab === 'profesionales' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="relative">
              <Search className="w-[14px] h-[14px] text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre o cédula…"
                className="h-[30px] w-56 pl-8 pr-3 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-[#1f3a8a]"
              />
            </div>
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              className="h-[30px] px-2 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800"
            >
              {ROLES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
            <select
              value={sedeFiltro}
              onChange={(e) => setSedeFiltro(e.target.value)}
              className="h-[30px] px-2 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800 max-w-[220px]"
            >
              <option value="">Todas las sedes</option>
              {sedes.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-zinc-500 ml-1">{profesionales.length} personas</span>
          </div>

          <Tabla
            cabeceras={['Nombre', 'Cédula', 'Rol', 'Cargo', 'Ámbito', 'Sedes']}
            filas={profesionales.map((p) => [
              p.nombre,
              <Mono>{p.documento}</Mono>,
              <span className="capitalize">{p.rol}</span>,
              <span className="text-zinc-500 text-[11.5px]">{p.cargo}</span>,
              <Pill variant={AMBITO_PILL[p.ambito] ?? 'mute'}>{p.ambito}</Pill>,
              p.sedes.length === 0 ? (
                <span className="text-zinc-300">ninguna</span>
              ) : p.sedes.length > 4 ? (
                // 13 nombres de sede en una celda la hacen ilegible. Se dice
                // cuántas y se muestran las primeras.
                <span title={p.sedes.map(nombreSede).join(', ')}>
                  <strong>{p.sedes.length}</strong>{' '}
                  <span className="text-zinc-500">
                    · {p.sedes.slice(0, 3).map(nombreSede).join(', ')}…
                  </span>
                </span>
              ) : (
                <span className="text-zinc-600">{p.sedes.map(nombreSede).join(', ')}</span>
              ),
            ])}
          />
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Piezas locales
// ----------------------------------------------------------------------------

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: FONT_MONO }} className="text-[12px] text-zinc-700">
      {children}
    </span>
  );
}

function Tarjeta({ titulo, valor, nota }: { titulo: string; valor: number; nota: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-4 py-3">
      <div className={SECTION_LABEL}>{titulo}</div>
      <div className="text-[26px] font-semibold text-zinc-900 tracking-tight leading-tight mt-1">
        {valor}
      </div>
      <div className="text-[11.5px] text-zinc-500">{nota}</div>
    </div>
  );
}

function Tabla({
  cabeceras,
  filas,
}: {
  cabeceras: string[];
  filas: React.ReactNode[][];
}) {
  if (filas.length === 0) {
    return <p className="text-[13px] text-zinc-500 py-6">Sin resultados.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50">
            {cabeceras.map((c) => (
              <th
                key={c}
                className="text-left font-medium text-zinc-500 px-3 py-2 whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
              {fila.map((celda, j) => (
                <td key={j} className="px-3 py-2 text-zinc-800 align-top">
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
