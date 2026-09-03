import { useEffect, useState } from 'react';
import { Stethoscope, ShieldAlert } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField, PillToggleField } from '../fields';
import { CalcAutosave } from './CalcAutosave';
import type { FormulaDef } from '../FormulaHint';
import { DowntonCard } from '../DowntonCard';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';
import { Cie10Field } from './Cie10Field';

interface CorpDiagnosticoRiesgoTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'diagnosticos' | 'riesgo' | null;

const opt = (vals: string[]): ReadonlyArray<DropdownOption> =>
  vals.map((v) => ({ value: v, label: v }));

/** Estratificación ACSM tal como la maneja Bodytech (hoja "Listas" del Excel). */
const ACSM_OPTS = opt(['A1', 'A2', 'A3', 'B', 'C', 'D']);

/** Riesgo Bodytech: escala propia que combina ACSM + Downton. */
/**
 * Cuestionario del Riesgo Bodytech (equipo médico). Tres preguntas Sí/No y una
 * regla fija:
 *   Q1 o Q2 en Sí        → Alto
 *   sólo Q3 en Sí        → Moderado
 *   las tres en No       → Bajo
 * Se conserva el vocabulario que ya vive en la columna (`Bajo/Moderado/Alto`);
 * la tabla del equipo dice "Medio" para el intermedio — es el mismo nivel.
 */
const PREGUNTAS_RIESGO_BODYTECH: ReadonlyArray<{ field: string; key: 'mcRbSintomasCv' | 'mcRbRazonNoEjercicio' | 'mcRbDolorOsteomuscularAf'; label: string }> = [
  { field: 'mc_rb_sintomas_cv', key: 'mcRbSintomasCv', label: '¿Ha tenido pérdida del conocimiento, dolor en el pecho o dificultad para respirar en el último mes, palpitaciones o inflamación constante en piernas?' },
  { field: 'mc_rb_razon_no_ejercicio', key: 'mcRbRazonNoEjercicio', label: '¿Tiene alguna razón por la cual no deba hacer ejercicio?' },
  { field: 'mc_rb_dolor_osteomuscular_af', key: 'mcRbDolorOsteomuscularAf', label: '¿Presencia de dolor osteomuscular o articular que empeore con la actividad física?' },
];

/** Tri-estado: null = sin responder. Mismo criterio que PillToggleField. */
function siNo(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === 'Sí' || v === 'SI' || v === 'si' || v === 'sí') return true;
  if (v === false || v === 'false') return false;
  return null;
}

function calcRiesgoBodytech(q1: boolean | null, q2: boolean | null, q3: boolean | null): 'Bajo' | 'Moderado' | 'Alto' | null {
  // Un Sí en Q1 o Q2 basta para Alto aunque el resto no esté respondido.
  if (q1 === true || q2 === true) return 'Alto';
  // Para Moderado o Bajo hace falta que Q1 y Q2 estén respondidas en No.
  if (q1 === false && q2 === false) {
    if (q3 === true) return 'Moderado';
    if (q3 === false) return 'Bajo';
  }
  return null; // incompleto: no se calcula ni se pisa lo guardado
}

const FORMULAS_RIESGO: ReadonlyArray<FormulaDef> = [
  {
    campo: 'Riesgo Bodytech',
    formula: 'Alto si Q1 o Q2 es Sí · Moderado si sólo Q3 es Sí · Bajo si las tres son No',
    nota: 'No se digita: sale de las tres preguntas. Queda vacío hasta que estén respondidas las que hagan falta para decidir.',
  },
];

/** Catálogo de la hoja "Listas". El equipo pidió cambiar "Aplazado" por
 *  "Pendiente aptitud" y agregar "Apto con restricciones". */
const APTITUD_OPTS = opt([
  'Apto',
  'Apto con recomendaciones',
  'Apto con restricciones',
  'Pendiente aptitud',
  'No apto',
]);

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpDiagnosticoRiesgoTab({ historiaId, data, onPatchLocal }: CorpDiagnosticoRiesgoTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const dxVals = [data?.mcDxNutricional, data?.mcDxCardiovascular, data?.mcDxOsteomuscular, data?.mcDxCie10];
  const dxFilled = dxVals.filter(isFilled).length;

  // Framingham se retiró (requiere paraclínicos que esta consulta no toma) y
  // "Nivel" se movió a Actividad física, donde es el nivel de entrenamiento.
  // Las respuestas viven en estado local, actualizado EN EL CLIC vía `onChange`,
  // y se re-sincronizan cuando `data` cambia (refetch). Si el riesgo se derivara
  // sólo de `data`, el badge reaccionaría ~1 s tarde: `data` recién se actualiza
  // cuando el auto-guardado del toggle termina su debounce y vuelve por onSaved.
  const [rb, setRb] = useState<{ q1: boolean | null; q2: boolean | null; q3: boolean | null }>({
    q1: siNo(data?.mcRbSintomasCv), q2: siNo(data?.mcRbRazonNoEjercicio), q3: siNo(data?.mcRbDolorOsteomuscularAf),
  });
  useEffect(() => {
    setRb({ q1: siNo(data?.mcRbSintomasCv), q2: siNo(data?.mcRbRazonNoEjercicio), q3: siNo(data?.mcRbDolorOsteomuscularAf) });
  }, [data?.mcRbSintomasCv, data?.mcRbRazonNoEjercicio, data?.mcRbDolorOsteomuscularAf]);
  const riesgoBodytech = calcRiesgoBodytech(rb.q1, rb.q2, rb.q3);
  const riesgoTone =
    riesgoBodytech === 'Alto' ? 'bg-[rgba(var(--p-danger-rgb),0.12)] text-[var(--p-danger)] border-[rgba(var(--p-danger-rgb),0.30)]'
    : riesgoBodytech === 'Moderado' ? 'bg-[rgba(var(--p-warn-rgb),0.12)] text-[var(--p-warn)] border-[rgba(var(--p-warn-rgb),0.30)]'
    : riesgoBodytech === 'Bajo' ? 'bg-[rgba(var(--p-ok-rgb),0.12)] text-[var(--p-ok)] border-[rgba(var(--p-ok-rgb),0.30)]'
    : 'bg-[var(--p-input-2)] text-[var(--p-text-3)] border-[var(--p-line)]';

  const riesgoVals = [data?.mcRiesgoAcsm, data?.mcRiesgoBodytech, data?.aptitud];
  const riesgoFilled = riesgoVals.filter(isFilled).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<Stethoscope size={16} />}
        title="Diagnósticos"
        subtitle={dxFilled === 0 ? 'Sin diagnósticos registrados' : `${dxFilled} de ${dxVals.length} campos completos`}
        state={dxFilled === 0 ? 'empty' : dxFilled === dxVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((dxFilled / dxVals.length) * 100)}
        onEdit={() => setOpenModal('diagnosticos')}
      />
      <Card
        icon={<ShieldAlert size={16} />}
        title="Riesgo y aptitud"
        subtitle={riesgoFilled === 0 ? 'Sin información' : `${riesgoFilled} de ${riesgoVals.length} campos completos`}
        state={riesgoFilled === 0 ? 'empty' : riesgoFilled === riesgoVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((riesgoFilled / riesgoVals.length) * 100)}
        onEdit={() => setOpenModal('riesgo')}
      />

      {/* Riesgo de caídas — el equipo lo pidió expresamente aquí ("ese sí lo
          necesitamos"). Mismo componente que usa el panel de consulta. */}
      <DowntonCard
        historiaId={historiaId}
        data={data}
        isMaxed
        onPatchLocal={onPatchLocal}
        showEyePill={false}
        modalSize="wide"
      />

      <Modal
        open={openModal === 'diagnosticos'}
        onClose={() => setOpenModal(null)}
        crumb="Diagnósticos"
        title="Diagnósticos"
        icon={<Stethoscope size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField historiaId={historiaId} field="mc_dx_nutricional" initialValue={data?.mcDxNutricional} onSaved={onPatchLocal} label="Nutricional" />
          <TextField historiaId={historiaId} field="mc_dx_cardiovascular" initialValue={data?.mcDxCardiovascular} onSaved={onPatchLocal} label="Cardiovascular" />
          <TextField historiaId={historiaId} field="mc_dx_osteomuscular" initialValue={data?.mcDxOsteomuscular} onSaved={onPatchLocal} label="Osteomuscular" />
          {/* Buscador multi-selección a ancho completo. OSIICS se retiró: el equipo
              médico lo descartó en la revisión (cambio 3) y su columna queda
              huérfana pero intacta por si hubiera datos. */}
          <div className="md:col-span-2">
            <Cie10Field historiaId={historiaId} field="mc_dx_cie10" initialValue={data?.mcDxCie10} onSaved={onPatchLocal} label="Diagnósticos CIE-10" />
          </div>
        </div>
      </Modal>

      <Modal
        open={openModal === 'riesgo'}
        onClose={() => setOpenModal(null)}
        crumb="Riesgo y aptitud"
        title="Riesgo y aptitud"
        icon={<ShieldAlert size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
        formulas={FORMULAS_RIESGO}
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">Cuestionario Riesgo Bodytech</div>
            <div className="flex flex-col gap-2.5">
              {PREGUNTAS_RIESGO_BODYTECH.map((q, i) => (
                <div key={q.field} className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-[var(--p-line)] bg-[var(--p-surface-2)]">
                  <span className="text-[13.5px] text-[var(--p-text)]">
                    <span className="font-mono font-bold text-[var(--p-text-3)] mr-2">Q{i + 1}</span>
                    {q.label}
                  </span>
                  <PillToggleField
                    historiaId={historiaId}
                    field={q.field}
                    initialValue={data?.[q.key]}
                    onSaved={onPatchLocal}
                    onChange={(v) => setRb((prev) => ({ ...prev, [(['q1', 'q2', 'q3'] as const)[i]]: v }))}
                    trueLabel="Sí"
                    falseLabel="No"
                    inline
                  />
                </div>
              ))}
            </div>
            {/* El riesgo se persiste en la misma columna de siempre (`mc_riesgo_bodytech`),
                así los contadores, el sidebar y cualquier reporte siguen leyéndolo igual.
                Si faltan respuestas para decidir, no se calcula ni se pisa lo guardado. */}
            <CalcAutosave historiaId={historiaId} field="mc_riesgo_bodytech" value={riesgoBodytech} serverValue={data?.mcRiesgoBodytech} onPatchLocal={onPatchLocal} />
            <div className="mt-3.5 flex items-center gap-3">
              <span className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">Riesgo Bodytech</span>
              <span className={`inline-flex items-center px-3 py-1 rounded-lg text-[12.5px] font-bold uppercase tracking-wide border ${riesgoTone}`}>
                {riesgoBodytech ?? 'Sin calcular'}
              </span>
              {!riesgoBodytech && (
                <span className="text-[11.5px] text-[var(--p-text-3)]">Responde las preguntas para calcularlo.</span>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">Clasificación y aptitud</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <SelectField historiaId={historiaId} field="mc_riesgo_acsm" initialValue={data?.mcRiesgoAcsm} onSaved={onPatchLocal} label="Riesgo ACSM" options={ACSM_OPTS} placeholder="Seleccionar..." />
              <SelectField historiaId={historiaId} field="aptitud" initialValue={data?.aptitud} onSaved={onPatchLocal} label="Aptitud" options={APTITUD_OPTS} placeholder="Seleccionar..." />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
