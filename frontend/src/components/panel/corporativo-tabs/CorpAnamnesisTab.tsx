import { useState } from 'react';
import { ClipboardList, HeartPulse, Stethoscope } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, TextareaField, PillToggleField } from '../fields';
import { TemplateTextareaField } from './TemplateTextareaField';
import type { MedicalHistoryFull } from '../types';

interface CorpAnamnesisTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'motivo' | 'sintomas' | 'sistemas' | null;

const ENFERMEDAD_ACTUAL_TEMPLATE =
  'Paciente femenina/masculino de años de edad, quien asiste a valoración médico ' +
  'deportiva de ingreso a BODYTECH. Actualmente se encuentra en buen estado ' +
  'general, asintomático cardiovascular u osteomuscular.';

const SINTOMAS: ReadonlyArray<{ label: string; field: keyof MedicalHistoryFull & string }> = [
  { label: 'Dolor torácico', field: 'mc_sint_dolor_toracico' },
  { label: 'Palpitaciones', field: 'mc_sint_palpitaciones' },
  { label: 'Disnea', field: 'mc_sint_disnea' },
  { label: 'Edema de MMII', field: 'mc_sint_edema_mmii' },
  { label: 'Síncope', field: 'mc_sint_sincope' },
  { label: 'Claudicación', field: 'mc_sint_claudicacion' },
];

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
}

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpAnamnesisTab({ historiaId, data, onPatchLocal }: CorpAnamnesisTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const sistemasVals = [
    data?.mcRsCabeza, data?.mcRsParesCraneales, data?.mcRsCara, data?.mcRsAbdPelvis,
    data?.mcRsCuello, data?.mcRsTorax, data?.mcRsPiel, data?.mcRsAbdomen, data?.mcRsPulsos,
    data?.mcRsFuerzaMmss, data?.mcRsFuerzaMmii, data?.mcRsPushUps, data?.mcRsAbdominales,
    data?.mcRsOsteomuscular,
  ];
  const sistemasFilled = sistemasVals.filter(isFilled).length;


  const motivoVals = [data?.motivoConsultaTexto, data?.mcEnfermedadActual];
  const motivoFilled = motivoVals.filter(isFilled).length;
  const motivoState = motivoFilled === 0 ? 'empty' : motivoFilled === motivoVals.length ? 'complete' : 'partial';

  const sintomasActivos = SINTOMAS.map((s) => coerceBool(data?.[camel(s.field)])).filter(Boolean).length;
  const sintomasState: 'empty' | 'partial' | 'complete' =
    sintomasActivos === 0 ? 'empty' : 'partial';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<ClipboardList size={16} />}
        title="Motivo y enfermedad actual"
        subtitle={
          motivoFilled === 0
            ? 'Sin información'
            : `${motivoFilled} de ${motivoVals.length} campos completos`
        }
        state={motivoState}
        completionPct={Math.round((motivoFilled / motivoVals.length) * 100)}
        onEdit={() => setOpenModal('motivo')}
      />
      <Card
        icon={<HeartPulse size={16} />}
        title="Síntomas en ejercicio"
        subtitle={
          sintomasActivos === 0
            ? 'Niega todos los síntomas'
            : `${sintomasActivos} de ${SINTOMAS.length} síntomas referidos`
        }
        state={sintomasState}
        completionPct={100}
        onEdit={() => setOpenModal('sintomas')}
      />
      <Card
        icon={<Stethoscope size={16} />}
        title="Revisión por sistemas"
        subtitle={sistemasFilled === 0 ? 'Sin hallazgos registrados' : `${sistemasFilled} de ${sistemasVals.length} campos completos`}
        state={sistemasFilled === 0 ? 'empty' : sistemasFilled === sistemasVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((sistemasFilled / sistemasVals.length) * 100)}
        onEdit={() => setOpenModal('sistemas')}
      />

      <Modal
        open={openModal === 'motivo'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Motivo de consulta"
        title="Motivo y enfermedad actual"
        icon={<ClipboardList size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="flex flex-col gap-4">
          <TextareaField
            historiaId={historiaId}
            field="motivo_consulta_texto"
            initialValue={data?.motivoConsultaTexto}
            onSaved={onPatchLocal}
            label="Motivo de consulta"
            rows={3}
            placeholder="Describir motivo de la consulta..."
          />
          <TemplateTextareaField
            historiaId={historiaId}
            field="mc_enfermedad_actual"
            initialValue={data?.mcEnfermedadActual}
            onSaved={onPatchLocal}
            label="Enfermedad actual"
            rows={4}
            template={ENFERMEDAD_ACTUAL_TEMPLATE}
            placeholder="Descripción de la enfermedad actual..."
          />
        </div>
      </Modal>

      {/* ============ Revisión por sistemas ============ */}
      <Modal
        open={openModal === 'sistemas'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Revisión por sistemas"
        title="Revisión por sistemas"
        icon={<Stethoscope size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        {/* 3 columnas en pantallas anchas: son 14 campos cortos, así baja de 7 a 5 filas */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          <TextField historiaId={historiaId} field="mc_rs_cabeza" initialValue={data?.mcRsCabeza} onSaved={onPatchLocal} label="Cabeza" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_pares_craneales" initialValue={data?.mcRsParesCraneales} onSaved={onPatchLocal} label="Pares craneales" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_cara" initialValue={data?.mcRsCara} onSaved={onPatchLocal} label="Cara" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_abd_pelvis" initialValue={data?.mcRsAbdPelvis} onSaved={onPatchLocal} label="ABD y pelvis" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_cuello" initialValue={data?.mcRsCuello} onSaved={onPatchLocal} label="Cuello" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_torax" initialValue={data?.mcRsTorax} onSaved={onPatchLocal} label="Tórax" placeholder="Incluye ruidos cardíacos y pulmonares" />
          <TextField historiaId={historiaId} field="mc_rs_piel" initialValue={data?.mcRsPiel} onSaved={onPatchLocal} label="Piel" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_abdomen" initialValue={data?.mcRsAbdomen} onSaved={onPatchLocal} label="Abdomen" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_pulsos" initialValue={data?.mcRsPulsos} onSaved={onPatchLocal} label="Pulsos" placeholder="Simétricos, de adecuada amplitud" />
          <TextField historiaId={historiaId} field="mc_rs_fuerza_mmss" initialValue={data?.mcRsFuerzaMmss} onSaved={onPatchLocal} label="Fuerza muscular MMSS" placeholder="5 de 5" />
          <TextField historiaId={historiaId} field="mc_rs_fuerza_mmii" initialValue={data?.mcRsFuerzaMmii} onSaved={onPatchLocal} label="Fuerza muscular MMII" placeholder="5 de 5" />
          <TextField historiaId={historiaId} field="mc_rs_push_ups" initialValue={data?.mcRsPushUps} onSaved={onPatchLocal} label="Push ups (a la fatiga)" type="number" min={0} max={200} />
          <TextField historiaId={historiaId} field="mc_rs_abdominales" initialValue={data?.mcRsAbdominales} onSaved={onPatchLocal} label="Abdominales (a la fatiga)" type="number" min={0} max={200} />
          <div>
            <TextareaField historiaId={historiaId} field="mc_rs_osteomuscular" initialValue={data?.mcRsOsteomuscular} onSaved={onPatchLocal} label="Osteoarticular / extremidades" rows={3} />
          </div>
        </div>
      </Modal>

      <Modal
        open={openModal === 'sintomas'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Síntomas en ejercicio"
        title="Síntomas en ejercicio"
        icon={<HeartPulse size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SINTOMAS.map((s) => (
            <div
              key={s.field}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--p-line)] bg-[var(--p-surface-2)]"
            >
              <span className="text-[13.5px] text-[var(--p-text)]">{s.label}</span>
              <PillToggleField
                historiaId={historiaId}
                field={s.field}
                initialValue={data?.[camel(s.field)]}
                onSaved={onPatchLocal}
                trueLabel="Refiere"
                falseLabel="Niega"
                inline
              />
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-dashed border-[var(--p-line)]">
          <TextareaField
            historiaId={historiaId}
            field="mc_sint_observaciones"
            initialValue={data?.mcSintObservaciones}
            onSaved={onPatchLocal}
            label="Observaciones"
            rows={3}
            placeholder="Detalle de los síntomas referidos: desencadenante, duración, intensidad…"
          />
        </div>
      </Modal>
    </div>
  );
}

// snake_case -> camelCase (mismo mapeo que usa el backend)
function camel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
