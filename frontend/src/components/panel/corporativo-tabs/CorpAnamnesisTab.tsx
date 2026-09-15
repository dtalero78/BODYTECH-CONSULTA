import { ClipboardList, HeartPulse } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextareaField, PillToggleField } from '../fields';
import { TemplateTextareaField } from './TemplateTextareaField';
import { AccionRapida } from './LlenadoRapido';
import { soloVacios } from './llenado';
import { useAbrirSolicitado } from './useAbrirSolicitado';
import { camelCampo, tieneValor } from './completitud';
import type { MedicalHistoryFull } from '../types';
import { useModalChain } from '../useModalChain';
import { SINTOMAS } from './camposCorporativo';

interface CorpAnamnesisTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
  /** Modal que el panel pide abrir (salto desde "lo que falta"). */
  abrir?: string | null;
  onAbierto?: () => void;
}

type ModalKey = 'motivo' | 'sintomas';

/** Recorrido clínico de la sección: define el "Siguiente" del pie de cada modal. */
const ORDEN: ReadonlyArray<ModalKey> = ['motivo', 'sintomas'];
const ETIQUETAS: Record<ModalKey, string> = {
  motivo: 'Motivo y enfermedad actual',
  sintomas: 'Síntomas en ejercicio',
};

const ENFERMEDAD_ACTUAL_TEMPLATE =
  'Paciente femenina/masculino de años de edad, quien asiste a valoración médico ' +
  'deportiva de ingreso a BODYTECH. Actualmente se encuentra en buen estado ' +
  'general, asintomático cardiovascular u osteomuscular.';


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

export function CorpAnamnesisTab({ historiaId, data, onPatchLocal, abrir, onAbierto }: CorpAnamnesisTabProps) {
  const { setOpen: setOpenModal, chain } = useModalChain(ORDEN, ETIQUETAS);
  useAbrirSolicitado(abrir, ORDEN, setOpenModal, onAbierto);

  const motivoVals = [data?.motivoConsultaTexto, data?.mcEnfermedadActual];
  const motivoFilled = motivoVals.filter(isFilled).length;
  const motivoState = motivoFilled === 0 ? 'empty' : motivoFilled === motivoVals.length ? 'complete' : 'partial';

  // Un síntoma sin responder NO es un síntoma negado. Antes el card decía "Niega
  // todos los síntomas" con los seis sin tocar, y la historia se veía lista.
  const sintomasActivos = SINTOMAS.filter((s) => coerceBool(data?.[camelCampo(s.field)])).length;
  const sintomasSinResponder = SINTOMAS.filter((s) => !tieneValor(data?.[camelCampo(s.field)])).length;
  const sintomasState: 'empty' | 'partial' | 'complete' =
    sintomasSinResponder === SINTOMAS.length ? 'empty' : sintomasSinResponder > 0 ? 'partial' : 'complete';
  const sintomasSubtitle =
    sintomasSinResponder === SINTOMAS.length
      ? 'Sin responder'
      : [
          sintomasActivos > 0
            ? `${sintomasActivos} de ${SINTOMAS.length} síntomas referidos`
            : sintomasSinResponder === 0
              ? 'Niega todos los síntomas'
              : null,
          sintomasSinResponder > 0 ? `${sintomasSinResponder} sin responder` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const nieganSintomas = soloVacios(data, Object.fromEntries(SINTOMAS.map((s) => [s.field, false])));
  const accionSintomas = (
    <AccionRapida
      label="Niega todos"
      titulo="Marca «Niega» en los síntomas que siguen sin responder. No cambia los que ya marcaste."
      valores={nieganSintomas}
      historiaId={historiaId}
      onPatchLocal={onPatchLocal}
    />
  );

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
        subtitle={sintomasSubtitle}
        state={sintomasState}
        completionPct={Math.round(((SINTOMAS.length - sintomasSinResponder) / SINTOMAS.length) * 100)}
        onEdit={() => setOpenModal('sintomas')}
      >
        {accionSintomas}
      </Card>

      <Modal
        {...chain('motivo')}
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

      <Modal
        {...chain('sintomas')}
        crumb="Anamnesis · Síntomas en ejercicio"
        title="Síntomas en ejercicio"
        icon={<HeartPulse size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="-mt-3 mb-3">{accionSintomas}</div>
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
                initialValue={data?.[camelCampo(s.field)]}
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
