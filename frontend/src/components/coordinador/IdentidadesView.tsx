// ============================================================================
// IdentidadesView — Cómo están hoy las identidades de los afiliados.
//
// Paso previo al padrón único. En vez de fusionar personas de una, primero se
// muestra el estado real para que alguien decida los casos dudosos: fusionar
// mal dos pacientes le cuelga a alguien la historia clínica de otro.
//
// El orden de la tabla no es alfabético a propósito — lo que hay que mirar va
// primero (conflicto → unificable → administrativo → único), y el backend ya lo
// entrega así.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Fingerprint, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import padronService, {
  AfiliadoCotejado,
  ResumenCotejo,
  EstadoIdentidad,
  EstadoPadron,
} from '../../services/padron.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, Pill } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

/** Cada estado con su color y, sobre todo, con lo que significa en castellano. */
const ESTADOS: ReadonlyArray<{
  valor: EstadoIdentidad | '';
  etiqueta: string;
  variante: 'ok' | 'warn' | 'bad' | 'mute';
  explica: string;
}> = [
  { valor: '', etiqueta: 'Todos', variante: 'mute', explica: '' },
  {
    valor: 'conflicto',
    etiqueta: 'Conflicto',
    variante: 'bad',
    explica: 'El mismo documento trae nombres que no son versiones del mismo. Hay que resolverlo a mano.',
  },
  {
    valor: 'unificable',
    etiqueta: 'Unificable',
    variante: 'warn',
    explica: 'La misma persona escrita con más o menos partes del nombre. Se unifica sola.',
  },
  {
    valor: 'administrativo',
    etiqueta: 'Administrativo',
    variante: 'mute',
    explica: 'El nombre describe un servicio, no a una persona. No entra al padrón.',
  },
  { valor: 'unico', etiqueta: 'Único', variante: 'ok', explica: 'Una sola versión del nombre.' },
];

const VARIANTE: Record<EstadoIdentidad, 'ok' | 'warn' | 'bad' | 'mute'> = {
  unico: 'ok',
  unificable: 'warn',
  conflicto: 'bad',
  administrativo: 'mute',
};

export function IdentidadesView({ showToast }: Props) {
  const [filas, setFilas] = useState<AfiliadoCotejado[]>([]);
  const [resumen, setResumen] = useState<ResumenCotejo | null>(null);
  const [coincidencias, setCoincidencias] = useState(0);
  const [truncado, setTruncado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [padron, setPadron] = useState<EstadoPadron | null>(null);

  const [estado, setEstado] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(
    async (f: { estado: string; q: string }) => {
      setCargando(true);
      setError(null);
      try {
        const r = await padronService.cotejo({ estado: f.estado, q: f.q });
        setFilas(r.filas);
        setResumen(r.resumen);
        setCoincidencias(r.coincidencias);
        setTruncado(r.truncado);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'No se pudo leer el cotejo';
        setError(msg);
        showToast({ type: 'error', message: msg });
      } finally {
        setCargando(false);
      }
    },
    [showToast],
  );

  // Con debounce: la búsqueda recorre 4.188 documentos en el servidor y no hace
  // falta rehacerla en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => cargar({ estado, q: busqueda }), 250);
    return () => clearTimeout(t);
  }, [estado, busqueda, cargar]);

  // El estado del padrón se pide aparte del cotejo: no depende de los filtros y
  // no tiene por qué recargarse cada vez que alguien escribe en el buscador.
  useEffect(() => {
    padronService.estado().then(setPadron).catch(() => setPadron(null));
  }, []);

  const explicacion = ESTADOS.find((e) => e.valor === estado)?.explica ?? '';

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-[18px] h-[18px] text-[#1e3a8a]" />
          <h1 className="text-[19px] font-semibold text-zinc-900">Identidades de afiliados</h1>
        </div>
        <button
          onClick={() => cargar({ estado, q: busqueda })}
          className="inline-flex items-center gap-1.5 h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className={`w-[13px] h-[13px] ${cargando ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="text-[12.5px] text-zinc-600 mb-5 max-w-[74ch] leading-relaxed">
        Cómo están hoy las identidades, agrupadas por documento. Es el paso previo al padrón
        único: antes de unificar a nadie hay que resolver los casos dudosos, porque fusionar mal
        dos pacientes le atribuye a una persona la historia clínica de otra.
      </div>

      {/* Resumen. El conflicto va aparte porque es lo único que exige decisión. */}
      {resumen && (
        <div className="flex flex-wrap items-stretch gap-3 mb-5">
          <Recuadro etiqueta="Personas" valor={resumen.documentos} />
          <Recuadro etiqueta="Únicas" valor={resumen.unico} tono="ok" />
          <Recuadro etiqueta="Unificables" valor={resumen.unificable} tono="warn" />
          <Recuadro etiqueta="Administrativas" valor={resumen.administrativo} />
          <Recuadro etiqueta="Conflictos" valor={resumen.conflicto} tono="bad" />
          <Recuadro
            etiqueta="En varios programas"
            valor={resumen.enVariosProgramas}
            ayuda="La misma persona atendida en más de un programa."
          />
        </div>
      )}

      {padron && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-5 px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[12.5px]">
          <span className="text-zinc-700">
            <strong>{padron.personas.toLocaleString('es-CO')}</strong> personas en el padrón
          </span>
          {padron.desfase === 0 ? (
            <span className="text-green-700">al día</span>
          ) : (
            <span className="text-amber-700">
              faltan {padron.desfase} por reflejar
            </span>
          )}
          {padron.actualizadoEn && (
            <span className="text-zinc-400">
              actualizado {new Date(padron.actualizadoEn).toLocaleString('es-CO')}
            </span>
          )}
          <span className="text-zinc-400 ml-auto">
            se actualiza solo; los conflictos y las administrativas quedan fuera a propósito
          </span>
        </div>
      )}

      {resumen && resumen.conflicto > 0 && (
        <div className="flex items-start gap-2 mb-5 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-red-800 leading-relaxed">
            <strong>
              {resumen.conflicto === 1
                ? 'Hay 1 documento con nombres que no son la misma persona.'
                : `Hay ${resumen.conflicto} documentos con nombres que no son la misma persona.`}
            </strong>{' '}
            Hay que resolverlos antes de construir el padrón: el sistema no los va a unificar solo.
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="relative">
          <Search className="w-[14px] h-[14px] text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o documento…"
            className="h-[30px] w-56 pl-8 pr-3 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-[#1f3a8a]"
          />
        </div>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="h-[30px] px-2 bg-white border border-zinc-300 rounded-md text-[12.5px] text-zinc-800"
        >
          {ESTADOS.map((e) => (
            <option key={e.valor || 'todos'} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-zinc-500 ml-1">
          {coincidencias} {coincidencias === 1 ? 'persona' : 'personas'}
          {truncado && ` · se muestran las primeras ${filas.length}`}
        </span>
      </div>

      {explicacion && (
        <div className="text-[12px] text-zinc-500 mb-3 max-w-[74ch]">{explicacion}</div>
      )}

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-800">
          {error}
        </div>
      ) : (
        <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                {['Documento', 'Nombre(s) registrados', 'Estado', 'Historias', 'Programas'].map((h) => (
                  <th key={h} className={`px-3 py-2 text-left ${SECTION_LABEL}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && !cargando && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                    Sin resultados
                  </td>
                </tr>
              )}
              {filas.map((f) => (
                <tr key={f.documento} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-3 py-2 align-top">
                    <span style={{ fontFamily: FONT_MONO }} className="text-zinc-800">
                      {f.documento}
                    </span>
                    {f.esCedulaDeProfesional && (
                      <div className="text-[10.5px] text-zinc-400 mt-0.5">cédula de la planta</div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {/* Todas las variantes, no solo la canónica: el punto de la
                        pantalla es ver en qué difieren. */}
                    {f.variantes.map((v, i) => (
                      <div
                        key={i}
                        className={v === f.nombreCanonico ? 'text-zinc-900' : 'text-zinc-500'}
                      >
                        {v}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Pill variant={VARIANTE[f.estado]}>{f.estado}</Pill>
                    {f.estado === 'conflicto' && (
                      <div className="text-[10.5px] text-red-700 mt-1 max-w-[28ch] leading-snug">
                        {f.motivo}
                      </div>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 align-top text-zinc-700"
                    style={{ fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {f.historias}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={f.origenes.length > 1 ? 'text-zinc-900 font-medium' : 'text-zinc-500'}>
                      {f.origenes.join(' + ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Recuadro({
  etiqueta,
  valor,
  tono,
  ayuda,
}: {
  etiqueta: string;
  valor: number;
  tono?: 'ok' | 'warn' | 'bad';
  ayuda?: string;
}) {
  const color =
    tono === 'bad' && valor > 0
      ? 'text-red-700'
      : tono === 'warn' && valor > 0
        ? 'text-amber-700'
        : tono === 'ok'
          ? 'text-green-700'
          : 'text-zinc-900';
  return (
    <div className="px-3.5 py-2.5 bg-white border border-zinc-200 rounded-lg min-w-[112px]" title={ayuda}>
      <div
        className={`text-[20px] font-semibold leading-none ${color}`}
        style={{ fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}
      >
        {valor.toLocaleString('es-CO')}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1.5">{etiqueta}</div>
    </div>
  );
}
