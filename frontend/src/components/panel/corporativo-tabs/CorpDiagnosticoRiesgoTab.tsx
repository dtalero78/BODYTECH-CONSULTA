import { useState } from 'react';
import { Stethoscope, ShieldAlert } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField } from '../fields';
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
const RIESGO_BODYTECH_OPTS = opt(['Bajo', 'Moderado', 'Alto']);

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
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          <SelectField historiaId={historiaId} field="mc_riesgo_acsm" initialValue={data?.mcRiesgoAcsm} onSaved={onPatchLocal} label="Riesgo ACSM" options={ACSM_OPTS} placeholder="Seleccionar..." />
          <SelectField historiaId={historiaId} field="mc_riesgo_bodytech" initialValue={data?.mcRiesgoBodytech} onSaved={onPatchLocal} label="Riesgo Bodytech" options={RIESGO_BODYTECH_OPTS} placeholder="Seleccionar..." />
          <SelectField historiaId={historiaId} field="aptitud" initialValue={data?.aptitud} onSaved={onPatchLocal} label="Aptitud" options={APTITUD_OPTS} placeholder="Seleccionar..." />
        </div>
      </Modal>
    </div>
  );
}
