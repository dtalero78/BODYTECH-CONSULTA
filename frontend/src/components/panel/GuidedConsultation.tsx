import { useEffect, useMemo, useState } from 'react';
import { Compass, ChevronLeft, ChevronRight, X, Mic, Check } from 'lucide-react';
import { TextField, SelectField, TextareaField, PillToggleField } from './fields';
import { EyeOnPatientPill } from './EyeOnPatientPill';
import type { DropdownOption } from './Dropdown';
import type { MedicalHistoryFull } from './types';

/**
 * Consulta guiada ("modo entrevista").
 *
 * Recorre un guion curado de los campos que el coach realmente PREGUNTA al
 * afiliado (no los 200+ campos del panel ni los calculados/medidos). En cada
 * paso muestra la pregunta a hacer y un campo para escribir la respuesta; el
 * coach puede tipearla o "preguntar de viva voz" y saltar — la transcripción
 * post-llamada intentará llenar esos campos al finalizar.
 *
 * Reutiliza los mismos field components (auto-save + coerción idénticos al panel),
 * así que cualquier respuesta escrita aquí persiste como en las pestañas.
 *
 * Para extender el guion: agregar entradas a SCRIPT (key = camelCase para leer el
 * valor; field = snake_case para guardar). Ambos deben existir en MedicalHistoryFull
 * y en EDITABLE_FIELDS del backend.
 */

type FieldKind = 'textarea' | 'text' | 'number' | 'select' | 'flag';

interface GuideField {
  kind: FieldKind;
  /** snake_case — campo que se guarda (debe estar en EDITABLE_FIELDS). */
  field: string;
  /** camelCase — clave para leer el valor inicial de `data`. */
  key: keyof MedicalHistoryFull;
  label?: string;
  placeholder?: string;
  options?: ReadonlyArray<DropdownOption>;
  rows?: number;
}

interface GuideStep {
  id: string;
  /** Etiqueta de sección (chip). */
  topic: string;
  /** Pregunta destacada que el coach hace al afiliado. */
  question: string;
  /** Ayuda breve opcional. */
  hint?: string;
  /** Condición para mostrar el paso (ej. solo Femenino). */
  when?: (d: MedicalHistoryFull | null) => boolean;
  /** Campos siempre visibles del paso. */
  fields: GuideField[];
  /** Campos que se revelan cuando `reveal.whenKey` es verdadero (ej. flag en Sí). */
  reveal?: { whenKey: keyof MedicalHistoryFull; fields: GuideField[] };
}

const OBJETIVO_OPTS: ReadonlyArray<DropdownOption> = [
  'Bajar de Peso',
  'Tonificar y Definición',
  'Aumentar Masa muscular',
  'Mejorar condición Física',
  'Fortalecimiento y Estabilidad',
  'Rehabilitación Funcional',
  'Salud',
].map((v) => ({ value: v, label: v }));

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
}

const SCRIPT: GuideStep[] = [
  {
    id: 'motivo',
    topic: 'Motivo',
    question: '¿Qué te trae a la consulta hoy? ¿Cuál es tu objetivo principal?',
    hint: 'Resume en una o dos frases lo que busca el afiliado.',
    fields: [
      {
        kind: 'textarea',
        field: 'motivo_consulta_texto',
        key: 'motivoConsultaTexto',
        placeholder: 'Describir el motivo de la consulta...',
        rows: 4,
      },
      {
        kind: 'select',
        field: 'objetivo_bodytech',
        key: 'objetivoBodytech',
        label: 'Objetivo',
        options: OBJETIVO_OPTS,
      },
    ],
  },
  {
    id: 'ant_patologico',
    topic: 'Antecedentes',
    question: '¿Has tenido enfermedades, diagnósticos o condiciones de salud importantes?',
    hint: 'Hipertensión, diabetes, tiroides, asma, etc.',
    fields: [{ kind: 'flag', field: 'ant_patologico_flag', key: 'antPatologicoFlag' }],
    reveal: {
      whenKey: 'antPatologicoFlag',
      fields: [
        {
          kind: 'textarea',
          field: 'ant_patologico_obs',
          key: 'antPatologicoObs',
          label: '¿Cuáles? ¿Desde cuándo?',
          rows: 3,
        },
      ],
    },
  },
  {
    id: 'ant_quirurgico',
    topic: 'Antecedentes',
    question: '¿Te han realizado alguna cirugía?',
    fields: [{ kind: 'flag', field: 'ant_quirurgico_flag', key: 'antQuirurgicoFlag' }],
    reveal: {
      whenKey: 'antQuirurgicoFlag',
      fields: [
        {
          kind: 'textarea',
          field: 'ant_quirurgico_obs',
          key: 'antQuirurgicoObs',
          label: '¿Cuál y hace cuánto?',
          rows: 3,
        },
      ],
    },
  },
  {
    id: 'ant_osteomuscular',
    topic: 'Antecedentes',
    question: '¿Has tenido lesiones musculares, óseas o articulares?',
    hint: 'Fracturas, esguinces, lesiones de tendón/ligamento, luxaciones.',
    fields: [{ kind: 'flag', field: 'ant_osteomuscular_flag', key: 'antOsteomuscularFlag' }],
    reveal: {
      whenKey: 'antOsteomuscularFlag',
      fields: [
        {
          kind: 'textarea',
          field: 'ant_osteomuscular_obs',
          key: 'antOsteomuscularObs',
          label: '¿Qué lesión, dónde y cuándo?',
          rows: 3,
        },
      ],
    },
  },
  {
    id: 'ant_farmacologico',
    topic: 'Antecedentes',
    question: '¿Tomas algún medicamento de forma habitual?',
    fields: [{ kind: 'flag', field: 'ant_farmacologico_flag', key: 'antFarmacologicoFlag' }],
    reveal: {
      whenKey: 'antFarmacologicoFlag',
      fields: [
        {
          kind: 'textarea',
          field: 'ant_farmacologico_obs',
          key: 'antFarmacologicoObs',
          label: '¿Cuáles y qué dosis/frecuencia?',
          rows: 3,
        },
      ],
    },
  },
  {
    id: 'ant_alergicos',
    topic: 'Antecedentes',
    question: '¿Eres alérgico a algún medicamento, alimento o sustancia?',
    fields: [{ kind: 'flag', field: 'ant_alergicos_flag', key: 'antAlergicosFlag' }],
    reveal: {
      whenKey: 'antAlergicosFlag',
      fields: [
        {
          kind: 'textarea',
          field: 'ant_alergicos_obs',
          key: 'antAlergicosObs',
          label: 'Agente, reacción y manejo',
          rows: 3,
        },
      ],
    },
  },
  {
    id: 'ant_familiares',
    topic: 'Antecedentes',
    question: '¿Hay antecedentes de enfermedad en tu familia cercana?',
    hint: 'Diabetes, enfermedad cardiovascular o cáncer en padres/hermanos.',
    fields: [{ kind: 'flag', field: 'ant_familiares_flag', key: 'antFamiliaresFlag' }],
    reveal: {
      whenKey: 'antFamiliaresFlag',
      fields: [
        {
          kind: 'textarea',
          field: 'ant_familiares_obs',
          key: 'antFamiliaresObs',
          label: '¿Qué enfermedad y qué parentesco?',
          rows: 3,
        },
      ],
    },
  },
  {
    id: 'embarazo',
    topic: 'Antecedentes',
    question: '¿Estás en embarazo actualmente?',
    when: (d) => d?.generoBiologico === 'Femenino',
    fields: [{ kind: 'flag', field: 'embarazo_actual', key: 'embarazoActual' }],
  },
  {
    id: 'actividad',
    topic: 'Hábitos',
    question: '¿Cuántos días por semana haces actividad física y cuánto dura cada sesión?',
    fields: [
      {
        kind: 'number',
        field: 'actividad_frecuencia',
        key: 'actividadFrecuencia',
        label: 'Días/semana (0–7)',
        placeholder: '0',
      },
      {
        kind: 'number',
        field: 'actividad_duracion_min',
        key: 'actividadDuracionMin',
        label: 'Minutos/sesión',
        placeholder: '0',
      },
    ],
  },
  {
    id: 'dolor',
    topic: 'Estado actual',
    question: '¿Tienes dolor en alguna parte del cuerpo?',
    hint: 'Zona, tiempo de evolución, tipo, qué lo aumenta o alivia.',
    fields: [
      {
        kind: 'textarea',
        field: 'hallazgos_dolor',
        key: 'hallazgosDolor',
        placeholder: 'Describir el dolor (zona, evolución, características)...',
        rows: 4,
      },
    ],
  },
  {
    id: 'medidas',
    topic: 'Estado actual',
    question: '¿Sabes tu peso y estatura actuales?',
    fields: [
      { kind: 'number', field: 'cc_peso_nuevo', key: 'ccPesoNuevo', label: 'Peso (kg)', placeholder: '0' },
      {
        kind: 'number',
        field: 'cc_estatura_nuevo',
        key: 'ccEstaturaNuevo',
        label: 'Estatura (cm)',
        placeholder: '0',
      },
    ],
  },
  {
    id: 'hallazgos',
    topic: 'Estado actual',
    question: 'Hallazgos relevantes de la consulta',
    hint: 'Observaciones del coach durante la evaluación (opcional).',
    fields: [
      {
        kind: 'textarea',
        field: 'hallazgos_descripcion',
        key: 'hallazgosDescripcion',
        placeholder: 'Hallazgos, observaciones del examen...',
        rows: 4,
      },
    ],
  },
];

interface GuidedConsultationProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  open: boolean;
  onClose: () => void;
  onPatchLocal: (field: string, value: unknown) => void;
}

function GuideFieldView({
  f,
  historiaId,
  data,
  onPatchLocal,
}: {
  f: GuideField;
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}) {
  const initialValue = data ? (data[f.key] as unknown) : undefined;

  if (f.kind === 'flag') {
    return (
      <PillToggleField
        historiaId={historiaId}
        field={f.field}
        initialValue={initialValue}
        onSaved={onPatchLocal}
        label={f.label}
        trueLabel="Sí"
        falseLabel="No"
      />
    );
  }
  if (f.kind === 'select') {
    return (
      <SelectField
        historiaId={historiaId}
        field={f.field}
        initialValue={initialValue}
        onSaved={onPatchLocal}
        label={f.label}
        options={f.options ?? []}
        placeholder={f.placeholder ?? 'Seleccionar...'}
      />
    );
  }
  if (f.kind === 'textarea') {
    return (
      <TextareaField
        historiaId={historiaId}
        field={f.field}
        initialValue={initialValue}
        onSaved={onPatchLocal}
        label={f.label}
        placeholder={f.placeholder}
        rows={f.rows ?? 3}
      />
    );
  }
  return (
    <TextField
      historiaId={historiaId}
      field={f.field}
      initialValue={initialValue}
      onSaved={onPatchLocal}
      label={f.label}
      placeholder={f.placeholder}
      type={f.kind === 'number' ? 'number' : 'text'}
    />
  );
}

export function GuidedConsultation({
  historiaId,
  data,
  isMaxed,
  open,
  onClose,
  onPatchLocal,
}: GuidedConsultationProps) {
  const steps = useMemo(() => SCRIPT.filter((s) => !s.when || s.when(data)), [data]);
  const [index, setIndex] = useState(0);

  // Mantener el índice en rango si el set de pasos cambia (ej. carga el género).
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  // Esc para cerrar.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || steps.length === 0) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const isFirst = index === 0;
  const progress = Math.round(((index + 1) / steps.length) * 100);
  const showReveal = step.reveal ? coerceBool(data?.[step.reveal.whenKey]) : false;

  const goNext = () => {
    if (isLast) onClose();
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  return (
    <div
      className="absolute inset-0 z-[60] flex items-start justify-center p-6 overflow-y-auto"
      style={{ background: 'rgba(11,20,26,0.86)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative bg-[#1f2c34] border border-[#3b4a54] rounded-[20px] w-full max-w-2xl shadow-2xl flex flex-col my-auto"
        style={{
          maxHeight: 'calc(100% - 8px)',
          animation: 'panelScaleY 200ms ease-out',
          transformOrigin: 'top center',
        }}
      >
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
          <EyeOnPatientPill isMaxed={isMaxed} />
          <button
            type="button"
            onClick={onClose}
            className="w-[34px] h-[34px] rounded-[10px] grid place-items-center text-[#a4b1b9] hover:bg-[#2a3942] hover:text-[#e9edef] transition"
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
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="text-[19px] leading-snug font-bold text-[#e9edef] mb-1.5">
            {step.question}
          </div>
          {step.hint && <div className="text-[12.5px] text-[#6b7882] mb-4">{step.hint}</div>}
          {!step.hint && <div className="mb-4" />}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {step.fields.map((f) => (
              <div key={f.field} className={f.kind === 'textarea' ? 'md:col-span-2' : ''}>
                <GuideFieldView f={f} historiaId={historiaId} data={data} onPatchLocal={onPatchLocal} />
              </div>
            ))}
          </div>

          {step.reveal && (
            <div className={`reveal-grid ${showReveal ? 'is-open' : ''}`}>
              <div>
                <div className="pt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {step.reveal.fields.map((f) => (
                    <div key={f.field} className={f.kind === 'textarea' ? 'md:col-span-2' : ''}>
                      <GuideFieldView
                        f={f}
                        historiaId={historiaId}
                        data={data}
                        onPatchLocal={onPatchLocal}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer / navegación */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#324049] bg-[#1a262e] rounded-b-[20px]">
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirst}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold text-[#a4b1b9] hover:text-[#e9edef] hover:bg-[#2a3942] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={15} />
            Atrás
          </button>

          <div className="flex items-center gap-2.5">
            {!isLast && (
              <button
                type="button"
                onClick={goNext}
                title="La transcripción intentará llenarlo al finalizar la llamada"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-xs font-semibold text-[#a4b1b9] hover:text-[#e9edef] hover:bg-[#2a3942] transition"
              >
                <Mic size={14} />
                Preguntar de viva voz
              </button>
            )}
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
