import { useState } from 'react';
import { ClipboardList, HeartPulse } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextareaField, PillToggleField } from '../fields';
import { TemplateTextareaField } from './TemplateTextareaField';
import type { MedicalHistoryFull } from '../types';

interface CorpAnamnesisTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'motivo' | 'sintomas' | null;

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

      <Modal
        open={openModal === 'motivo'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Motivo de consulta"
        title="Motivo y enfermedad actual"
        icon={<ClipboardList size={18} />}
        isMaxed
        showEyePill={false}
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

      <Modal
        open={openModal === 'sintomas'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Síntomas en ejercicio"
        title="Síntomas en ejercicio"
        icon={<HeartPulse size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="flex flex-col gap-3">
          {SINTOMAS.map((s) => (
            <div
              key={s.field}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[#324049] bg-[#1a2530]"
            >
              <span className="text-[13.5px] text-[#e9edef]">{s.label}</span>
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
      </Modal>
    </div>
  );
}

// snake_case -> camelCase (mismo mapeo que usa el backend)
function camel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
