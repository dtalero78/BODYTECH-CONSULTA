import { useEffect, useRef } from 'react';
import { Compass, X, Mic, Sparkles } from 'lucide-react';
import type { Room } from 'twilio-video';
import { useRealtimeTranscription } from '../hooks/useRealtimeTranscription';

/**
 * Consulta guiada para el panel NUTRICIONAL (MedicalHistoryPanel).
 *
 * A diferencia de la guía del panel de consulta (que auto-guarda campo por campo
 * vía PATCH), este panel mantiene estado local y persiste todo junto con
 * "Guardar Historia Clínica". Por eso esta guía es CONTROLADA: lee/escribe el
 * estado del panel vía getValue/setValue (que el panel rutea a `datosNutricionales`
 * o a los campos top-level peso/talla). El coach guarda al final como siempre.
 *
 * El guion cubre la ANAMNESIS NUTRICIONAL completa (no el plan/diagnóstico, que el
 * coach deriva después). Las opciones de los <select> coinciden EXACTAMENTE con
 * las del panel para que los valores no queden en blanco al volver al formulario.
 */

type FieldKind = 'textarea' | 'text' | 'select';

interface GField {
  kind: FieldKind;
  key: string;
  label?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  rows?: number;
  /** Forzar ancho: por defecto los textarea ocupan 2 columnas; `full:false` los compacta. */
  full?: boolean;
}

interface GStep {
  id: string;
  topic: string;
  question: string;
  hint?: string;
  fields: GField[];
}

const opts = (...vals: string[]) => vals.map((v) => ({ value: v, label: v }));

const SCRIPT_NUTRI: GStep[] = [
  {
    id: 'motivo',
    topic: 'Motivo y objetivo',
    question: '¿Qué te trae a la consulta y cuál es tu objetivo?',
    fields: [
      { kind: 'select', key: 'tipoConsulta', label: 'Tipo de consulta', options: opts('Primera vez', 'Control') },
      {
        kind: 'select',
        key: 'objetivoPrincipal',
        label: 'Objetivo principal',
        options: opts(
          'Pérdida de grasa',
          'Ganancia de masa muscular',
          'Rendimiento deportivo',
          'Salud general',
          'Otro'
        ),
      },
      { kind: 'textarea', key: 'motivoConsultaTexto', label: 'Motivo (descripción)', placeholder: 'Resumen del motivo...', rows: 3 },
      { kind: 'textarea', key: 'objetivosEspecificos', label: 'Objetivos específicos', placeholder: 'Metas concretas del afiliado...', rows: 2 },
    ],
  },
  {
    id: 'enfermedad',
    topic: 'Antecedentes',
    question: '¿Tienes alguna enfermedad o condición de salud actual?',
    fields: [
      { kind: 'textarea', key: 'descripcionEnfermedad', placeholder: 'Diagnósticos, condiciones crónicas, síntomas actuales...', rows: 3 },
    ],
  },
  {
    id: 'medicamentos_alergias',
    topic: 'Antecedentes',
    question: '¿Tomas medicamentos? ¿Tienes alergias?',
    fields: [
      { kind: 'textarea', key: 'medicamentosActuales', label: 'Medicamentos actuales', placeholder: 'Medicamento, dosis y frecuencia...', rows: 2, full: false },
      { kind: 'textarea', key: 'alergias', label: 'Alergias', placeholder: 'Agente y tipo de reacción...', rows: 2, full: false },
    ],
  },
  {
    id: 'cirugias',
    topic: 'Antecedentes',
    question: '¿Te han operado u hospitalizado?',
    fields: [
      { kind: 'textarea', key: 'cirugias', label: 'Cirugías', placeholder: 'Cirugía y fecha aproximada...', rows: 2, full: false },
      { kind: 'textarea', key: 'hospitalizaciones', label: 'Hospitalizaciones', placeholder: 'Motivo y fecha...', rows: 2, full: false },
    ],
  },
  {
    id: 'actividad',
    topic: 'Actividad física',
    question: '¿Realizas actividad física? ¿Cómo es tu rutina?',
    fields: [
      { kind: 'select', key: 'realizaActividadFisica', label: '¿Realiza actividad física?', options: opts('Sí', 'No') },
      { kind: 'text', key: 'frecuenciaEjercicio', label: 'Frecuencia (veces/semana)', placeholder: 'Ej: 3' },
      { kind: 'select', key: 'tipoEntrenamiento', label: 'Tipo de entrenamiento', options: opts('Fuerza', 'Cardio', 'Mixto', 'Otro') },
      { kind: 'select', key: 'intensidadPercibida', label: 'Intensidad percibida', options: opts('Baja', 'Media', 'Alta') },
      { kind: 'select', key: 'horarioEjercicio', label: 'Horario habitual', options: opts('AM', 'PM', 'Mixto') },
    ],
  },
  {
    id: 'estilo',
    topic: 'Estilo de vida',
    question: '¿Cómo es tu sueño y tu nivel de estrés?',
    fields: [
      { kind: 'text', key: 'horasSueno', label: 'Horas de sueño', placeholder: 'Ej: 7' },
      { kind: 'select', key: 'calidadSueno', label: 'Calidad del sueño', options: opts('Buena', 'Regular', 'Mala') },
      { kind: 'select', key: 'nivelEstres', label: 'Nivel de estrés', options: opts('Bajo', 'Medio', 'Alto') },
    ],
  },
  {
    id: 'antropometria',
    topic: 'Composición corporal',
    question: 'Medidas y composición corporal',
    hint: 'Registra las medidas tomadas en la consulta.',
    fields: [
      { kind: 'text', key: 'peso', label: 'Peso actual (kg)', placeholder: '0' },
      { kind: 'text', key: 'talla', label: 'Estatura (cm)', placeholder: '0' },
      { kind: 'text', key: 'pesoHabitual', label: 'Peso habitual (kg)', placeholder: '0' },
      { kind: 'text', key: 'porcentajeGrasa', label: '% grasa corporal', placeholder: '0' },
      { kind: 'text', key: 'masaMuscular', label: 'Masa muscular (kg)', placeholder: '0' },
      { kind: 'text', key: 'circunferenciaCintura', label: 'Cintura (cm)', placeholder: '0' },
      { kind: 'text', key: 'circunferenciaCadera', label: 'Cadera (cm)', placeholder: '0' },
    ],
  },
  {
    id: 'habitos',
    topic: 'Hábitos alimentarios',
    question: '¿Cómo son tus hábitos alimentarios generales?',
    fields: [
      { kind: 'text', key: 'numComidasDia', label: 'Comidas por día', placeholder: 'Ej: 4' },
      { kind: 'text', key: 'consumoAgua', label: 'Agua (L/día)', placeholder: 'Ej: 2' },
      { kind: 'text', key: 'horariosComida', label: 'Horarios de comida', placeholder: 'Ej: 7am, 12m, 7pm' },
      { kind: 'textarea', key: 'suplementos', label: 'Suplementos', placeholder: 'Tipo, dosis...', rows: 2, full: false },
      { kind: 'textarea', key: 'cambiosPesoRecientes', label: 'Cambios de peso recientes', placeholder: 'Subió/bajó, cuánto y cuándo...', rows: 2, full: false },
    ],
  },
  {
    id: 'alcohol',
    topic: 'Hábitos',
    question: '¿Consumes alcohol? ¿Con qué frecuencia?',
    fields: [
      { kind: 'select', key: 'consumoAlcohol', label: 'Consumo de alcohol', options: opts('Sí', 'No') },
      { kind: 'text', key: 'frecuenciaAlcohol', label: 'Frecuencia', placeholder: 'Ej: 1 vez/semana' },
    ],
  },
  {
    id: 'recordatorio',
    topic: 'Recordatorio 24h',
    question: 'Recordatorio de 24h: ¿qué comiste ayer?',
    hint: 'Desayuno, media mañana, almuerzo, media tarde, cena y snacks.',
    fields: [
      { kind: 'textarea', key: 'recordatorio24h', placeholder: 'Detalle de lo consumido en las últimas 24 horas...', rows: 4 },
    ],
  },
  {
    id: 'anamnesis_semana',
    topic: 'Anamnesis alimentaria',
    question: 'Patrón alimentario habitual',
    hint: 'Lo que suele comer en cada momento del día.',
    fields: [
      { kind: 'textarea', key: 'anamnesisDesayuno', label: 'Desayuno', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisMediaManana', label: 'Media mañana', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisAlmuerzo', label: 'Almuerzo', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisMediaTarde', label: 'Media tarde', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisCena', label: 'Cena', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisFinSemana', label: 'Fin de semana', rows: 2, full: false },
    ],
  },
  {
    id: 'preferencias',
    topic: 'Preferencias',
    question: '¿Qué alimentos prefieres, rechazas o no toleras?',
    fields: [
      { kind: 'textarea', key: 'alimentosPreferidos', label: 'Alimentos preferidos', rows: 2, full: false },
      { kind: 'textarea', key: 'alimentosRechazados', label: 'Alimentos rechazados', rows: 2, full: false },
      { kind: 'textarea', key: 'preferenciasAlimentarias', label: 'Preferencias (vegetariano, etc.)', rows: 2, full: false },
      { kind: 'textarea', key: 'alergiasAlimentarias', label: 'Alergias alimentarias', rows: 2, full: false },
      { kind: 'textarea', key: 'intoleranciasAlimentarias', label: 'Intolerancias', rows: 2, full: false },
    ],
  },
  {
    id: 'signos',
    topic: 'Signos clínicos',
    question: '¿Síntomas digestivos o signos clínicos a considerar?',
    fields: [
      { kind: 'textarea', key: 'signosClinicos', label: 'Signos clínicos', rows: 2, full: false },
      { kind: 'textarea', key: 'problemasDigestivos', label: 'Problemas digestivos', rows: 2, full: false },
      { kind: 'textarea', key: 'masticacionDeglucion', label: 'Masticación y deglución', rows: 2, full: false },
    ],
  },
];

const INPUT_CLS =
  'w-full bg-[#2a3942] text-white text-[15px] px-3 py-2.5 rounded-lg border border-[#324049] focus:border-[#00a884] focus:outline-none transition placeholder:text-[#6b7882]';

interface GuidedNutricionProps {
  open: boolean;
  onClose: () => void;
  getValue: (key: string) => string;
  setValue: (key: string, value: string) => void;
  /** Sala de Twilio — fuente del audio (coach + paciente) para la transcripción. */
  room?: Room | null;
  /** Procesa el transcript completo con IA y guarda la historia. */
  onFinalize: (transcript: string) => Promise<void>;
  /** True mientras la IA procesa + guarda. */
  aiProcessing: boolean;
}

function GFieldView({
  f,
  getValue,
  setValue,
}: {
  f: GField;
  getValue: (key: string) => string;
  setValue: (key: string, value: string) => void;
}) {
  const value = getValue(f.key) ?? '';
  return (
    <div className="flex flex-col gap-1.5">
      {f.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {f.label}
        </label>
      )}
      {f.kind === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => setValue(f.key, e.target.value)}
          rows={f.rows ?? 3}
          placeholder={f.placeholder}
          className={`${INPUT_CLS} resize-y`}
        />
      ) : f.kind === 'select' ? (
        <select value={value} onChange={(e) => setValue(f.key, e.target.value)} className={INPUT_CLS}>
          <option value="">Seleccione</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(f.key, e.target.value)}
          placeholder={f.placeholder}
          className={INPUT_CLS}
        />
      )}
    </div>
  );
}

/**
 * Render de los campos del guion nutricional (mismo set que usa el modal).
 * Lo reutiliza el panel para que, al cerrar la guía, los campos visibles sean
 * EXACTAMENTE los mismos que el asistente guiado.
 */
export function GuidedNutricionFields({
  getValue,
  setValue,
}: {
  getValue: (key: string) => string;
  setValue: (key: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {SCRIPT_NUTRI.map((step) => (
        <div key={step.id}>
          <div className="text-[14px] font-bold text-[#e9edef] mb-0.5">{step.question}</div>
          {step.hint ? (
            <div className="text-[11.5px] text-[#6b7882] mb-2.5">{step.hint}</div>
          ) : (
            <div className="mb-2" />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {step.fields.map((f) => {
              const spanFull = f.full ?? f.kind === 'textarea';
              return (
                <div key={f.key} className={spanFull ? 'md:col-span-2' : ''}>
                  <GFieldView f={f} getValue={getValue} setValue={setValue} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GuidedNutricion({
  open,
  onClose,
  getValue,
  setValue,
  room,
  onFinalize,
  aiProcessing,
}: GuidedNutricionProps) {
  // Transcribe TODA la consulta (coach + paciente) en vivo y la acumula.
  const live = useRealtimeTranscription(room ?? null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Transcribir mientras la guía está abierta.
  useEffect(() => {
    if (!live.supported) return;
    if (open) live.start();
    else live.stop();
    return () => live.stop();
  }, [open, live.supported, live.start, live.stop]);

  // Auto-scroll del panel de transcripción.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live.transcript, live.interim]);

  // Esc para cerrar (no mientras la IA procesa).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !aiProcessing) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, aiProcessing]);

  if (!open) return null;

  const handleFinalize = async () => {
    await onFinalize(live.getTranscript());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-stretch justify-center p-3 sm:p-5"
      style={{ background: 'rgba(11,20,26,0.9)', backdropFilter: 'blur(6px)' }}
    >
      <div className="relative bg-[#1f2c34] border border-[#3b4a54] rounded-2xl w-full max-w-6xl shadow-2xl flex flex-col my-auto max-h-[calc(100%-8px)]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#324049] flex-shrink-0">
          <div className="w-[38px] h-[38px] rounded-[11px] bg-[rgba(0,168,132,0.12)] text-[#00a884] grid place-items-center flex-shrink-0">
            <Compass size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-[#6b7882] tracking-widest uppercase font-semibold">
              Consulta guiada · Nutrición
            </div>
            <div className="text-[12px] text-[#a4b1b9] mt-0.5">
              Pregunta y anota; la plataforma completa la historia con la transcripción al finalizar.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={aiProcessing}
            className="w-[34px] h-[34px] rounded-[10px] grid place-items-center text-[#a4b1b9] hover:bg-[#2a3942] hover:text-white transition disabled:opacity-30"
            aria-label="Cerrar guía"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo: dos columnas (campos | transcripción) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2">
          {/* Izquierda — campos para preguntar/anotar */}
          <div className="overflow-y-auto px-6 py-5 lg:border-r border-[#324049]">
            <GuidedNutricionFields getValue={getValue} setValue={setValue} />
          </div>

          {/* Derecha — transcripción simultánea */}
          <div className="flex flex-col min-h-0 px-6 py-5 bg-[#1a262e]">
            <div className="flex items-center gap-2 mb-2.5 flex-shrink-0">
              <Mic size={14} className="text-[#00a884]" />
              <div className="text-[12px] font-semibold text-[#a4b1b9] tracking-wide uppercase flex-1">
                Transcripción simultánea
              </div>
              {live.supported ? (
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                    live.listening ? 'text-[#00a884]' : 'text-[#6b7882]'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      live.listening ? 'bg-[#00a884] animate-pulse' : 'bg-[#6b7882]'
                    }`}
                  />
                  {live.listening ? 'Escuchando' : 'Conectando…'}
                </span>
              ) : (
                <span className="text-[10.5px] text-[#6b7882]">No disponible (usa Chrome)</span>
              )}
            </div>
            <div
              ref={transcriptRef}
              className="flex-1 min-h-[220px] overflow-y-auto rounded-xl bg-[#0b141a] border border-[#324049] p-3.5 text-[13.5px] leading-relaxed text-[#cfd8dd] whitespace-pre-wrap"
            >
              {live.transcript ? (
                <span>{live.transcript}</span>
              ) : (
                !live.interim && (
                  <span className="text-[#6b7882] italic">
                    La conversación con el afiliado se irá transcribiendo aquí…
                  </span>
                )
              )}
              {live.interim && (
                <span className="text-[#8a99a1] italic">
                  {live.transcript ? ' ' : ''}
                  {live.interim}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer — finalizar y guardar */}
        <div className="px-6 py-4 border-t border-[#324049] bg-[#1a262e] rounded-b-2xl flex-shrink-0">
          <button
            type="button"
            onClick={handleFinalize}
            disabled={aiProcessing}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-[#00a884] text-[#001b14] hover:bg-[#008f6f] transition shadow-[0_4px_14px_rgba(0,168,132,0.25)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {aiProcessing ? (
              <>
                <span className="w-4 h-4 border-2 border-[#001b14]/40 border-t-[#001b14] rounded-full animate-spin" />
                Analizando y guardando…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Finalizar y guardar
              </>
            )}
          </button>
          <div className="text-[11px] text-[#6b7882] text-center mt-2">
            La plataforma analiza la transcripción, respeta lo que anotaste y diligencia la historia.
          </div>
        </div>
      </div>
    </div>
  );
}
