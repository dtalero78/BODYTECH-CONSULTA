import { useEffect, useRef } from 'react';
import { Compass, X, Mic, Sparkles } from 'lucide-react';
import type { VideoEngine } from '../video/video-engine';
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

type FieldKind = 'textarea' | 'text' | 'select' | 'readonly';

export interface GField {
  kind: FieldKind;
  key: string;
  label?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  rows?: number;
  /** Forzar ancho: por defecto los textarea ocupan 2 columnas; `full:false` los compacta. */
  full?: boolean;
}

export interface GStep {
  id: string;
  topic: string;
  question: string;
  hint?: string;
  fields: GField[];
}

const opts = (...vals: string[]) => vals.map((v) => ({ value: v, label: v }));

export const SCRIPT_NUTRI: GStep[] = [
  {
    id: 'confirmar',
    topic: 'Datos',
    question: '1. Confirmemos los datos',
    hint: 'Peso y estatura de la consulta; edad y fecha de nacimiento de referencia.',
    fields: [
      { kind: 'text', key: 'peso', label: 'Peso actual (kg)', placeholder: '0' },
      { kind: 'text', key: 'talla', label: 'Estatura (cm)', placeholder: '0' },
      { kind: 'readonly', key: 'edad', label: 'Edad' },
      { kind: 'readonly', key: 'fechaNacimiento', label: 'Fecha de nacimiento' },
    ],
  },
  {
    id: 'anamnesis_alim',
    topic: 'Alimentación',
    question: '2. Anamnesis alimentaria',
    hint: 'Cuántas veces come al día, cómo come y horarios de las comidas.',
    fields: [
      { kind: 'text', key: 'numComidasDia', label: '¿Cuántas veces come al día?', placeholder: 'Ej: 4' },
      { kind: 'text', key: 'horariosComida', label: 'Horarios de comida', placeholder: 'Ej: 7am, 12m, 7pm' },
      { kind: 'textarea', key: 'anamnesisDesayuno', label: 'Desayuno', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisMediaManana', label: 'Media mañana', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisAlmuerzo', label: 'Almuerzo', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisMediaTarde', label: 'Media tarde', rows: 2, full: false },
      { kind: 'textarea', key: 'anamnesisCena', label: 'Cena', rows: 2, full: false },
    ],
  },
  {
    id: 'historia',
    topic: 'Historia clínica',
    question: '3. Historia clínica',
    hint: 'Antecedentes del paciente, medicamentos y cirugías.',
    fields: [
      { kind: 'textarea', key: 'descripcionEnfermedad', label: 'Antecedentes / condición actual', placeholder: 'Diagnósticos, condiciones, síntomas...', rows: 3 },
      { kind: 'textarea', key: 'medicamentosActuales', label: '¿Toma algún medicamento?', placeholder: 'Medicamento, dosis y frecuencia...', rows: 2, full: false },
      { kind: 'textarea', key: 'cirugias', label: 'Cirugías', placeholder: 'Cirugía y fecha aproximada...', rows: 2, full: false },
    ],
  },
  {
    id: 'actividad',
    topic: 'Actividad física',
    question: '4. Actividad física',
    hint: 'Cuántos días entrena y en qué horario.',
    fields: [
      { kind: 'select', key: 'realizaActividadFisica', label: '¿Realiza actividad física?', options: opts('Sí', 'No') },
      { kind: 'text', key: 'frecuenciaEjercicio', label: '¿Cuántos días entrena?', placeholder: 'Ej: 3 días/semana' },
      { kind: 'select', key: 'horarioEjercicio', label: 'Horario', options: opts('AM', 'PM', 'Mixto') },
      { kind: 'select', key: 'tipoEntrenamiento', label: 'Tipo de entrenamiento', options: opts('Fuerza', 'Cardio', 'Mixto', 'Otro') },
    ],
  },
  {
    id: 'sueno',
    topic: 'Sueño',
    question: '5. Nivel de sueño',
    hint: 'Cuántas horas duerme y calidad del sueño.',
    fields: [
      { kind: 'text', key: 'horasSueno', label: '¿Cuántas horas duerme?', placeholder: 'Ej: 7' },
      { kind: 'select', key: 'calidadSueno', label: 'Calidad del sueño', options: opts('Buena', 'Regular', 'Mala') },
    ],
  },
  {
    id: 'consumos',
    topic: 'Consumos',
    question: '6. Consumo de agua, alcohol y suplementos',
    fields: [
      { kind: 'text', key: 'consumoAgua', label: 'Agua (L/día)', placeholder: 'Ej: 2' },
      { kind: 'select', key: 'consumoAlcohol', label: 'Consumo de alcohol', options: opts('Sí', 'No') },
      { kind: 'text', key: 'frecuenciaAlcohol', label: 'Frecuencia de alcohol', placeholder: 'Ej: 1 vez/semana' },
      { kind: 'textarea', key: 'suplementos', label: 'Suplementos', placeholder: 'Tipo, dosis...', rows: 2 },
    ],
  },
  {
    id: 'alergias',
    topic: 'Alergias',
    question: '7. Alergias o intolerancias a alimentos',
    fields: [
      { kind: 'textarea', key: 'alergiasAlimentarias', label: 'Alergias alimentarias', rows: 2, full: false },
      { kind: 'textarea', key: 'intoleranciasAlimentarias', label: 'Intolerancias', rows: 2, full: false },
    ],
  },
  {
    id: 'gustos',
    topic: 'Gustos',
    question: '8. Gustos de alimentos',
    hint: 'Qué le gusta y qué NO consume.',
    fields: [
      { kind: 'textarea', key: 'alimentosPreferidos', label: 'Alimentos que le gustan', rows: 2, full: false },
      { kind: 'textarea', key: 'alimentosRechazados', label: 'Alimentos que NO consume', rows: 2, full: false },
    ],
  },
  {
    id: 'composicion',
    topic: 'Composición corporal',
    question: '9. Análisis de composición corporal',
    hint: '% de grasa y masa muscular; circunferencias si las tomas.',
    fields: [
      { kind: 'text', key: 'porcentajeGrasa', label: '% grasa corporal', placeholder: '0' },
      { kind: 'text', key: 'masaMuscular', label: 'Masa muscular (kg)', placeholder: '0' },
      { kind: 'text', key: 'circunferenciaCintura', label: 'Cintura (cm)', placeholder: '0' },
      { kind: 'text', key: 'circunferenciaCadera', label: 'Cadera (cm)', placeholder: '0' },
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
  room?: VideoEngine | null;
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
      {f.kind === 'readonly' ? (
        <div className="w-full bg-[#0b141a] text-[#a4b1b9] text-[15px] px-3 py-2.5 rounded-lg border border-[#324049]">
          {value || '—'}
        </div>
      ) : f.kind === 'textarea' ? (
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
          {/* Si el valor (p.ej. el que mandó Trepsi) no está en las opciones,
              lo agregamos para que se muestre y no se pierda. */}
          {value && !(f.options ?? []).some((o) => o.value === value) && (
            <option value={value}>{value}</option>
          )}
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
      className="fixed inset-0 z-[100] flex items-stretch justify-end p-3 sm:p-5 pointer-events-none"
    >
      <div className="relative bg-[#111c23] border border-[#3b4a54] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col my-auto max-h-[calc(100%-8px)] pointer-events-auto">
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

        {/* Cuerpo: campos (ancho) | transcripción (angosta) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px]">
          {/* Izquierda — campos para preguntar/anotar */}
          <div className="overflow-y-auto px-6 py-5 lg:border-r border-[#324049]">
            <GuidedNutricionFields getValue={getValue} setValue={setValue} />
          </div>

          {/* Derecha — transcripción simultánea */}
          <div className="flex flex-col min-h-0 px-6 py-5 bg-[#111c23]">
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
        <div className="px-6 py-4 border-t border-[#324049] bg-[#111c23] rounded-b-2xl flex-shrink-0">
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
