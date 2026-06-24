import { useEffect, useRef, useState } from 'react';
import { Compass, ChevronLeft, ChevronRight, X, Mic, MicOff, Check } from 'lucide-react';
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
  /** Sala de Twilio — fuente del audio del paciente para la transcripción en vivo. */
  room?: Room | null;
}

function GFieldView({
  f,
  getValue,
  setValue,
  onFocusField,
  dictating,
}: {
  f: GField;
  getValue: (key: string) => string;
  setValue: (key: string, value: string) => void;
  /** Marca este campo como destino del dictado al enfocarlo (solo texto). */
  onFocusField: (key: string | null) => void;
  /** Si el dictado está activo y apunta a este campo, lo resaltamos. */
  dictating: boolean;
}) {
  const value = getValue(f.key) ?? '';
  const ring = dictating ? 'border-[#00a884] ring-2 ring-[#00a884]/40' : '';
  return (
    <div className="flex flex-col gap-1.5">
      {f.label && (
        <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
          {f.label}
        </label>
      )}
      {f.kind === 'textarea' ? (
        <textarea
          data-vkey={f.key}
          value={value}
          onChange={(e) => setValue(f.key, e.target.value)}
          onFocus={() => onFocusField(f.key)}
          rows={f.rows ?? 3}
          placeholder={f.placeholder}
          className={`${INPUT_CLS} resize-y ${ring}`}
        />
      ) : f.kind === 'select' ? (
        <select
          value={value}
          onChange={(e) => setValue(f.key, e.target.value)}
          onFocus={() => onFocusField(null)}
          className={INPUT_CLS}
        >
          <option value="">Seleccione</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          data-vkey={f.key}
          type="text"
          value={value}
          onChange={(e) => setValue(f.key, e.target.value)}
          onFocus={() => onFocusField(f.key)}
          placeholder={f.placeholder}
          className={`${INPUT_CLS} ${ring}`}
        />
      )}
    </div>
  );
}

export function GuidedNutricion({ open, onClose, getValue, setValue, room }: GuidedNutricionProps) {
  const steps = SCRIPT_NUTRI;
  const [index, setIndex] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Transcribe al PACIENTE (audio remoto) en vivo y lo escribe en el campo activo.
  const dict = useRealtimeTranscription(room ?? null, { lang: 'es' });
  const getValueRef = useRef(getValue);
  getValueRef.current = getValue;
  const setValueRef = useRef(setValue);
  setValueRef.current = setValue;
  const activeKeyRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const focusField = (key: string | null) => {
    activeKeyRef.current = key;
    setActiveKey(key);
  };

  // El texto dictado (final) se anexa al campo de texto enfocado.
  useEffect(() => {
    dict.setOnFinal((text) => {
      const k = activeKeyRef.current;
      if (!k) return;
      const cur = getValueRef.current(k) || '';
      const sep = cur && !/\s$/.test(cur) ? ' ' : '';
      setValueRef.current(k, (cur + sep + text).trim());
    });
  }, [dict]);

  // Voz por defecto: el micrófono escucha mientras la guía está abierta.
  useEffect(() => {
    if (!dict.supported) return;
    if (open) dict.start();
    else dict.stop();
    return () => dict.stop();
  }, [open, dict.supported, dict.start, dict.stop]);

  // Al cambiar de paso, enfocar el primer campo de texto (destino del dictado).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector(
        'textarea, input[type="text"]'
      ) as HTMLElement | null;
      if (el) el.focus();
      else focusField(null);
    }, 60);
    return () => window.clearTimeout(t);
  }, [index, open]);

  // Esc para cerrar.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const isFirst = index === 0;
  const progress = Math.round(((index + 1) / steps.length) * 100);

  const goNext = () => {
    if (isLast) onClose();
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6 overflow-y-auto"
      style={{ background: 'rgba(11,20,26,0.86)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-[#1f2c34] border border-[#3b4a54] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col my-auto max-h-[calc(100%-8px)]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#324049]">
          <div className="w-[38px] h-[38px] rounded-[11px] bg-[rgba(0,168,132,0.12)] text-[#00a884] grid place-items-center flex-shrink-0">
            <Compass size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-[#6b7882] tracking-widest uppercase font-semibold">
              Consulta guiada · {step.topic}
            </div>
            <div className="text-[12px] text-[#a4b1b9] mt-0.5">
              Paso {index + 1} de {steps.length}
            </div>
          </div>
          {dict.supported ? (
            <button
              type="button"
              onClick={() => (dict.listening ? dict.stop() : dict.start())}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition flex-shrink-0 ${
                dict.listening
                  ? 'bg-[rgba(0,168,132,0.15)] text-[#00a884] border border-[#00a884]/40'
                  : 'bg-[#2a3942] text-[#a4b1b9] border border-[#324049] hover:text-white'
              }`}
              title={dict.listening ? 'Dictado activo — clic para pausar' : 'Reanudar dictado por voz'}
            >
              {dict.listening ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#00a884] animate-pulse" />
                  Escuchando
                </>
              ) : (
                <>
                  <MicOff size={13} />
                  Pausado
                </>
              )}
            </button>
          ) : (
            <span className="text-[10.5px] text-[#6b7882] flex-shrink-0 max-w-[150px] leading-tight text-right">
              Dictado no disponible (usa Chrome)
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-[34px] h-[34px] rounded-[10px] grid place-items-center text-[#a4b1b9] hover:bg-[#2a3942] hover:text-white transition"
            aria-label="Cerrar guía"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress */}
        <div className="h-1 bg-[#16222a]">
          <div
            className="h-full bg-[#00a884] transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div className="text-[19px] leading-snug font-bold text-white mb-1.5">{step.question}</div>
          {step.hint ? (
            <div className="text-[12.5px] text-[#6b7882] mb-4">{step.hint}</div>
          ) : (
            <div className="mb-4" />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {step.fields.map((f) => {
              const spanFull = f.full ?? f.kind === 'textarea';
              return (
                <div key={f.key} className={spanFull ? 'md:col-span-2' : ''}>
                  <GFieldView
                    f={f}
                    getValue={getValue}
                    setValue={setValue}
                    onFocusField={focusField}
                    dictating={dict.listening && activeKey === f.key}
                  />
                </div>
              );
            })}
          </div>

          {/* Preview en vivo del dictado */}
          {dict.supported && dict.listening && (
            <div className="mt-3 flex items-start gap-2 text-[12.5px] text-[#a4b1b9]">
              <Mic size={14} className="text-[#00a884] mt-0.5 flex-shrink-0 animate-pulse" />
              <span>
                {dict.interim ? (
                  <span className="italic text-[#cfd8dd]">{dict.interim}</span>
                ) : activeKey ? (
                  'Transcribiendo al afiliado en el campo resaltado…'
                ) : (
                  'Toca el campo donde quieres que quede la respuesta del afiliado.'
                )}
              </span>
            </div>
          )}
        </div>

        {/* Footer / navegación */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#324049] bg-[#1a262e] rounded-b-2xl">
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirst}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold text-[#a4b1b9] hover:text-white hover:bg-[#2a3942] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={15} />
            Atrás
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-xs font-bold bg-[#00a884] text-[#001b14] hover:bg-[#008f6f] transition shadow-[0_4px_14px_rgba(0,168,132,0.25)]"
            >
              {isLast ? (
                <>
                  Finalizar guía
                  <Check size={15} />
                </>
              ) : (
                <>
                  Siguiente
                  <ChevronRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
