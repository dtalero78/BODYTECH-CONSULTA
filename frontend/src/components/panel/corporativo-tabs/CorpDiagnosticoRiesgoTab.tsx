import { useState } from 'react';
import { Stethoscope, ShieldAlert } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField } from '../fields';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';

interface CorpDiagnosticoRiesgoTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'diagnosticos' | 'riesgo' | null;

const NIVEL_OPTS: ReadonlyArray<DropdownOption> = [
  'Principiante', 'Intermedio', 'Avanzado',
].map((v) => ({ value: v, label: v }));

const APTITUD_OPTS: ReadonlyArray<DropdownOption> = [
  'Apto', 'Apto con recomendaciones', 'No apto', 'Aplazado',
].map((v) => ({ value: v, label: v }));

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpDiagnosticoRiesgoTab({ historiaId, data, onPatchLocal }: CorpDiagnosticoRiesgoTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const dxVals = [data?.mcDxNutricional, data?.mcDxCardiovascular, data?.mcDxOsteomuscular, data?.mcDxCie10, data?.mcDxOsiics];
  const dxFilled = dxVals.filter(isFilled).length;

  const riesgoVals = [data?.mcRiesgoAcsm, data?.mcRiesgoFramingham, data?.mcRiesgoBodytech, data?.mcNivel, data?.aptitud];
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
          <TextField historiaId={historiaId} field="mc_dx_cie10" initialValue={data?.mcDxCie10} onSaved={onPatchLocal} label="CIE-10" placeholder="Ej. Z103" />
          <TextField historiaId={historiaId} field="mc_dx_osiics" initialValue={data?.mcDxOsiics} onSaved={onPatchLocal} label="OSIICS" />
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
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField historiaId={historiaId} field="mc_riesgo_acsm" initialValue={data?.mcRiesgoAcsm} onSaved={onPatchLocal} label="Riesgo ACSM" />
          <TextField historiaId={historiaId} field="mc_riesgo_framingham" initialValue={data?.mcRiesgoFramingham} onSaved={onPatchLocal} label="Riesgo Framingham" />
          <TextField historiaId={historiaId} field="mc_riesgo_bodytech" initialValue={data?.mcRiesgoBodytech} onSaved={onPatchLocal} label="Riesgo Bodytech" />
          <SelectField historiaId={historiaId} field="mc_nivel" initialValue={data?.mcNivel} onSaved={onPatchLocal} label="Nivel" options={NIVEL_OPTS} />
          <SelectField historiaId={historiaId} field="aptitud" initialValue={data?.aptitud} onSaved={onPatchLocal} label="Aptitud" options={APTITUD_OPTS} />
        </div>
      </Modal>
    </div>
  );
}
