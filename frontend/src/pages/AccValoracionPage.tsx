// ============================================================================
// AccValoracionPage — captura de la Valoración Corporal ACC.
//
// Ruta: /acc/valoracion  ·  /acc/valoracion/:id (retomar un borrador)
//
// DISEÑADA PARA CELULAR, NO ADAPTADA A CELULAR. El fisioterapeuta mide de pie,
// con el paciente enfrente y el teléfono en una mano: campos grandes, teclado
// numérico, una sección a la vez y los resultados siempre visibles abajo sin
// tener que volver arriba.
//
// El cálculo lo hace el backend (`/api/acc/calcular`), que es donde las
// fórmulas tienen tests. Acá no se calcula nada.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, FileText, Loader2, AlertTriangle } from 'lucide-react';
import accService, {
  ValoracionIncompleta,
  type Medidas,
  type ResultadoAntropometrico,
  type Valoracion,
  type Evaluacion,
} from '../services/acc.service';
import { FONT_INTER } from '../components/coordinador/_tokens';

// ---------------------------------------------------------------------------
// Definición de los campos. Un solo sitio: agregar una medida es agregar una
// línea acá (y su columna en el backend).
// ---------------------------------------------------------------------------

interface Campo {
  key: keyof Medidas;
  label: string;
  unidad: string;
  /** Rango plausible. Fuera de esto se avisa, no se bloquea: puede ser real. */
  min: number;
  max: number;
}

interface Seccion {
  id: string;
  titulo: string;
  ayuda?: string;
  campos: Campo[];
}

const SECCIONES: Seccion[] = [
  {
    id: 'basicas',
    titulo: 'Medidas básicas',
    campos: [
      { key: 'estaturaCm', label: 'Estatura', unidad: 'cm', min: 100, max: 220 },
      { key: 'pesoKg', label: 'Peso', unidad: 'kg', min: 25, max: 250 },
    ],
  },
  {
    id: 'perimetros',
    titulo: 'Perímetros',
    ayuda: 'Cinta métrica, sin comprimir el tejido.',
    campos: [
      { key: 'perimetroAbdominal', label: 'Abdominal', unidad: 'cm', min: 40, max: 180 },
      { key: 'perimetroCadera', label: 'Cadera', unidad: 'cm', min: 50, max: 180 },
      { key: 'perimetroBrazoRelajadoDer', label: 'Bíceps der. relajado', unidad: 'cm', min: 15, max: 60 },
      { key: 'perimetroBrazoContraidoDer', label: 'Bíceps der. contraído', unidad: 'cm', min: 15, max: 65 },
      { key: 'perimetroBrazoRelajadoIzq', label: 'Bíceps izq. relajado', unidad: 'cm', min: 15, max: 60 },
      { key: 'perimetroBrazoContraidoIzq', label: 'Bíceps izq. contraído', unidad: 'cm', min: 15, max: 65 },
      { key: 'perimetroMusloDer', label: 'Muslo derecho', unidad: 'cm', min: 25, max: 90 },
      { key: 'perimetroMusloIzq', label: 'Muslo izquierdo', unidad: 'cm', min: 25, max: 90 },
      { key: 'perimetroPantorrilla', label: 'Pantorrilla', unidad: 'cm', min: 20, max: 60 },
    ],
  },
  {
    id: 'pliegues',
    titulo: 'Pliegues cutáneos',
    ayuda: 'Plicómetro, en milímetros. Los seis primeros arman la sumatoria del protocolo Bodytech.',
    campos: [
      { key: 'pliegueTriceps', label: 'Tríceps', unidad: 'mm', min: 2, max: 60 },
      { key: 'pliegueSubescapular', label: 'Subescapular', unidad: 'mm', min: 2, max: 60 },
      { key: 'pliegueSupraespinal', label: 'Supraespinal', unidad: 'mm', min: 2, max: 60 },
      { key: 'pliegueAbdominal', label: 'Abdominal', unidad: 'mm', min: 2, max: 70 },
      { key: 'pliegueMusloAnterior', label: 'Muslo anterior', unidad: 'mm', min: 2, max: 70 },
      { key: 'plieguePantorrilla', label: 'Pantorrilla', unidad: 'mm', min: 2, max: 60 },
      { key: 'pliegueBiceps', label: 'Bíceps', unidad: 'mm', min: 2, max: 50 },
      { key: 'pliegueCrestaIliaca', label: 'Cresta ilíaca', unidad: 'mm', min: 2, max: 70 },
    ],
  },
];

const COLOR_EVAL: Record<Evaluacion, string> = {
  bajo: 'bg-amber-100 text-amber-800',
  normal: 'bg-emerald-100 text-emerald-800',
  optimo: 'bg-emerald-100 text-emerald-800',
  alto: 'bg-rose-100 text-rose-800',
};

const ETIQUETA_EVAL: Record<Evaluacion, string> = {
  bajo: 'Bajo',
  normal: 'Normal',
  optimo: 'Óptimo',
  alto: 'Alto',
};

function hoyColombia(): string {
  const c = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return c.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

export function AccValoracionPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [valoracionId, setValoracionId] = useState<number | null>(
    idParam ? Number(idParam) : null
  );

  /**
   * Al llegar desde la agenda (`/acc`) los datos del paciente vienen en la URL:
   * el fisioterapeuta toca una fila y cae en el formulario ya identificado, sin
   * volver a teclear la cédula con el paciente esperando.
   *
   * Inicializador perezoso a propósito: se lee UNA vez. Si la URL siguiera
   * mandando en cada render, pelearía contra lo que el fisio corrige a mano.
   */
  const [paciente, setPaciente] = useState(() => {
    const sexoUrl = searchParams.get('sexo');
    return {
      numeroId: searchParams.get('numeroId') ?? '',
      nombreCompleto: searchParams.get('nombre') ?? '',
      edad: (searchParams.get('edad') ?? '').replace(/\D/g, ''),
      // Solo los dos valores que el selector entiende: un parámetro con basura
      // dejaría el control en un estado que no se puede mostrar.
      sexo: sexoUrl === 'masculino' || sexoUrl === 'femenino' ? sexoUrl : '',
    };
  });

  /**
   * Vínculo con la cohorte de Sol Médica. Sin esto la valoración queda suelta y
   * cerrarla NO marca al paciente como «asistió» — que es el hecho que mueve el
   * embudo y habilita el cobro. Una valoración sin `pacienteId` es válida (un
   * walk-in fuera de la cohorte), pero no debe serlo por accidente.
   */
  const [pacienteId] = useState<number | null>(() => {
    const raw = searchParams.get('pacienteId');
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [medidas, setMedidas] = useState<Medidas>({});
  const [observaciones, setObservaciones] = useState('');
  const [fechaEvaluacion] = useState(hoyColombia());

  const [resultado, setResultado] = useState<ResultadoAntropometrico | null>(null);
  const [estado, setEstado] = useState<'borrador' | 'cerrada'>('borrador');
  const [guardando, setGuardando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faltantesCierre, setFaltantesCierre] = useState<string[]>([]);
  const [seccionAbierta, setSeccionAbierta] = useState('basicas');

  // Los datos que se mandan a calcular. Se memoiza para no disparar el efecto
  // en cada render, solo cuando cambia una medida de verdad.
  const payload = useMemo(
    () => ({ ...medidas, edad: paciente.edad, sexo: paciente.sexo }),
    [medidas, paciente.edad, paciente.sexo]
  );

  // --- Cargar un borrador existente -----------------------------------------
  useEffect(() => {
    if (!idParam) return;
    let vivo = true;
    accService
      .getValoracion(Number(idParam))
      .then((v: Valoracion) => {
        if (!vivo) return;
        setPaciente({
          numeroId: v.numeroId,
          nombreCompleto: v.nombreCompleto ?? '',
          edad: v.edad != null ? String(v.edad) : '',
          sexo: (v.sexo as string) ?? '',
        });
        const m: Medidas = {};
        for (const s of SECCIONES) {
          for (const c of s.campos) {
            const raw = (v as unknown as Record<string, unknown>)[c.key];
            if (raw !== null && raw !== undefined) (m as Record<string, unknown>)[c.key] = String(raw);
          }
        }
        setMedidas(m);
        setObservaciones(v.observaciones ?? '');
        setResultado(v.resultado);
        setEstado(v.estado);
        setValoracionId(v.id);
      })
      .catch(() => vivo && setError('No se pudo cargar la valoración.'));
    return () => {
      vivo = false;
    };
  }, [idParam]);

  // --- Cálculo en vivo (debounce) -------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      accService.calcular(payload).then(setResultado).catch(() => {
        /* silencioso: el cálculo en vivo es una comodidad, no un guardado */
      });
    }, 400);
    return () => clearTimeout(t);
  }, [payload]);

  // --- Autosave del borrador -------------------------------------------------
  const puedeGuardar = paciente.numeroId.trim().length > 0 && estado === 'borrador';
  const primerRender = useRef(true);

  useEffect(() => {
    if (!puedeGuardar) return;
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setGuardando(true);
      setError(null);
      try {
        const v = await accService.guardar({
          ...medidas,
          numeroId: paciente.numeroId.trim(),
          nombreCompleto: paciente.nombreCompleto.trim() || null,
          edad: paciente.edad || null,
          sexo: paciente.sexo || null,
          fechaEvaluacion,
          observaciones: observaciones || null,
          pacienteId,
        });
        setValoracionId(v.id);
      } catch {
        setError('No se pudo guardar. Revisá la conexión — los datos siguen en pantalla.');
      } finally {
        setGuardando(false);
      }
    }, 1200);
    return () => clearTimeout(t);
    // `medidas` y el resto ya cubren todo lo persistible.
  }, [medidas, paciente, observaciones, fechaEvaluacion, pacienteId, puedeGuardar]);

  const setCampo = useCallback((key: keyof Medidas, valor: string) => {
    // Solo dígitos, coma y punto: en el celular el teclado decimal cuela otras cosas.
    const limpio = valor.replace(/[^\d.,]/g, '').replace(',', '.');
    setMedidas((prev) => ({ ...prev, [key]: limpio }));
  }, []);

  const cerrar = async () => {
    if (!valoracionId) return;
    setCerrando(true);
    setError(null);
    setFaltantesCierre([]);
    try {
      const v = await accService.cerrar(valoracionId);
      setEstado(v.estado);
      await accService.abrirInforme(v.id);
    } catch (e) {
      if (e instanceof ValoracionIncompleta) setFaltantesCierre(e.faltantes);
      else setError('No se pudo cerrar la valoración.');
    } finally {
      setCerrando(false);
    }
  };

  const fueraDeRango = (c: Campo): boolean => {
    const v = parseFloat(String(medidas[c.key] ?? ''));
    return Number.isFinite(v) && (v < c.min || v > c.max);
  };

  const completos = (s: Seccion) => s.campos.filter((c) => String(medidas[c.key] ?? '') !== '').length;

  return (
    <div className="min-h-screen bg-zinc-50 pb-52" style={{ fontFamily: FONT_INTER }}>
      {/* Cabecera fija: el fisio siempre sabe con quién está */}
      <header className="sticky top-0 z-20 bg-white border-b border-zinc-200 px-3 py-2.5 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-1 rounded-lg text-zinc-500 active:bg-zinc-100"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.09em] text-zinc-400 font-semibold">
            Valoración Corporal ACC
          </div>
          <div className="text-[13px] font-semibold text-zinc-800 truncate">
            {paciente.nombreCompleto || 'Paciente sin identificar'}
          </div>
        </div>
        <div className="text-[11px] text-zinc-400 tabular-nums">
          {guardando ? 'Guardando…' : estado === 'cerrada' ? 'Cerrada' : valoracionId ? 'Guardado' : ''}
        </div>
      </header>

      <main className="px-3 pt-3 space-y-3">
        {/* Paciente */}
        <section className="bg-white border border-zinc-200 rounded-xl p-3">
          <h2 className="text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-2.5">
            Paciente
          </h2>
          <div className="space-y-2.5">
            <Texto
              label="Cédula / ID"
              value={paciente.numeroId}
              onChange={(v) => setPaciente((p) => ({ ...p, numeroId: v }))}
              disabled={estado === 'cerrada'}
              inputMode="numeric"
            />
            <Texto
              label="Nombre completo"
              value={paciente.nombreCompleto}
              onChange={(v) => setPaciente((p) => ({ ...p, nombreCompleto: v }))}
              disabled={estado === 'cerrada'}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <Texto
                label="Edad"
                value={paciente.edad}
                onChange={(v) => setPaciente((p) => ({ ...p, edad: v.replace(/\D/g, '') }))}
                disabled={estado === 'cerrada'}
                inputMode="numeric"
              />
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Sexo</label>
                <div className="flex gap-1.5">
                  {(['masculino', 'femenino'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={estado === 'cerrada'}
                      onClick={() => setPaciente((p) => ({ ...p, sexo: s }))}
                      className={`flex-1 h-11 rounded-lg text-[13px] font-medium border transition-colors ${
                        paciente.sexo === s
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-200 active:bg-zinc-50'
                      }`}
                    >
                      {s === 'masculino' ? 'M' : 'F'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {!paciente.sexo && (
            <p className="mt-2 text-[11px] text-amber-700 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              Sin el sexo no se calcula el % graso ni el muscular: las fórmulas son distintas.
            </p>
          )}
        </section>

        {/* Medidas, una sección a la vez */}
        {SECCIONES.map((s) => {
          const abierta = seccionAbierta === s.id;
          const hechos = completos(s);
          return (
            <section key={s.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setSeccionAbierta(abierta ? '' : s.id)}
                className="w-full px-3 py-3 flex items-center gap-2 text-left active:bg-zinc-50"
              >
                <span className="flex-1 text-[13px] font-semibold text-zinc-800">{s.titulo}</span>
                <span
                  className={`text-[11px] tabular-nums px-2 py-0.5 rounded-full ${
                    hechos === s.campos.length
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  {hechos}/{s.campos.length}
                </span>
              </button>

              {abierta && (
                <div className="px-3 pb-3">
                  {s.ayuda && <p className="text-[11px] text-zinc-500 mb-2.5">{s.ayuda}</p>}
                  <div className="grid grid-cols-2 gap-2.5">
                    {s.campos.map((c) => (
                      <Numero
                        key={String(c.key)}
                        label={c.label}
                        unidad={c.unidad}
                        value={String(medidas[c.key] ?? '')}
                        onChange={(v) => setCampo(c.key, v)}
                        alerta={fueraDeRango(c)}
                        disabled={estado === 'cerrada'}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}

        {/* Observaciones */}
        <section className="bg-white border border-zinc-200 rounded-xl p-3">
          <label className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-2">
            Observaciones
          </label>
          <textarea
            value={observaciones}
            disabled={estado === 'cerrada'}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[14px] text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50"
            placeholder="Lo que el paciente deba saber y no salga de los números."
          />
        </section>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[12.5px] text-rose-800">
            {error}
          </div>
        )}
      </main>

      {/* Resultados + acción: fijos abajo, al alcance del pulgar */}
      <footer className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-zinc-200">
        <div className="px-3 py-2.5 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <Metrica label="IMC" v={resultado?.imc} decimales={2} />
            <Metrica label="% Grasa" v={resultado?.porcentajeGrasa} decimales={2} sufijo="%" />
            <Metrica label="% Muscular" v={resultado?.porcentajeMuscular} decimales={2} sufijo="%" />
            <Metrica label="TMB" v={resultado?.tmbKcal} decimales={0} sufijo=" kcal" />
            <Metrica label="ICC" v={resultado?.icc} decimales={2} />
            <Metrica label="ICT" v={resultado?.ict} decimales={2} />
          </div>
        </div>

        {faltantesCierre.length > 0 && (
          <div className="px-3 pb-2 text-[12px] text-amber-800 bg-amber-50 border-t border-amber-200 py-2">
            Falta para emitir el informe: <strong>{faltantesCierre.join(', ')}</strong>.
          </div>
        )}

        <div className="px-3 pb-3 pt-1 flex gap-2">
          {estado === 'cerrada' ? (
            <button
              onClick={() => valoracionId && accService.abrirInforme(valoracionId)}
              className="flex-1 h-12 rounded-xl bg-zinc-900 text-white text-[14px] font-semibold flex items-center justify-center gap-2 active:bg-zinc-800"
            >
              <FileText className="w-4 h-4" />
              Ver informe
            </button>
          ) : (
            <button
              onClick={cerrar}
              disabled={!valoracionId || cerrando}
              className="flex-1 h-12 rounded-xl bg-zinc-900 text-white text-[14px] font-semibold flex items-center justify-center gap-2 disabled:bg-zinc-300 active:bg-zinc-800"
            >
              {cerrando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Cerrar y emitir informe
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

function Texto({
  label,
  value,
  onChange,
  disabled,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <div>
      <label className="block text-[11px] text-zinc-500 mb-1">{label}</label>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-lg border border-zinc-200 px-3 text-[15px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50"
      />
    </div>
  );
}

/**
 * Campo numérico de medida. `inputMode="decimal"` levanta el teclado numérico
 * del celular; el `type` sigue siendo text para no heredar las flechitas ni el
 * scroll-to-change de `type=number`, que en la mano cambian valores sin querer.
 */
function Numero({
  label,
  unidad,
  value,
  onChange,
  alerta,
  disabled,
}: {
  label: string;
  unidad: string;
  value: string;
  onChange: (v: string) => void;
  alerta?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] text-zinc-500 mb-1 leading-tight">{label}</label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-12 rounded-lg border px-3 pr-9 text-[16px] tabular-nums text-zinc-900 focus:outline-none focus:ring-2 disabled:bg-zinc-50 ${
            alerta
              ? 'border-amber-400 focus:ring-amber-400/20 bg-amber-50'
              : 'border-zinc-200 focus:ring-zinc-900/10'
          }`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-400 pointer-events-none">
          {unidad}
        </span>
      </div>
    </div>
  );
}

function Metrica({
  label,
  v,
  decimales,
  sufijo = '',
}: {
  label: string;
  v: { valor: number; evaluacion: Evaluacion | null } | null | undefined;
  decimales: number;
  sufijo?: string;
}) {
  return (
    <div className="min-w-[92px] rounded-lg border border-zinc-200 px-2.5 py-1.5">
      <div className="text-[9.5px] uppercase tracking-[0.06em] text-zinc-400 font-semibold">
        {label}
      </div>
      <div className="text-[15px] font-semibold tabular-nums text-zinc-900 leading-tight">
        {v ? `${v.valor.toFixed(decimales)}${sufijo}` : '—'}
      </div>
      {v?.evaluacion && (
        <div className={`inline-block mt-0.5 text-[9px] font-semibold px-1.5 rounded ${COLOR_EVAL[v.evaluacion]}`}>
          {ETIQUETA_EVAL[v.evaluacion]}
        </div>
      )}
    </div>
  );
}

export default AccValoracionPage;
