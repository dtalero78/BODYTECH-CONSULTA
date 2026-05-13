import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { SelectField, PillToggleField, TextField } from '../fields';
import type { MedicalHistoryFull } from '../types';

interface ConductaTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

const APTITUD_OPTS = [
  'Apto',
  'Apto con restricciones',
  'No apto',
  'En observación',
  'Pendiente evaluación',
].map((v) => ({ value: v, label: v }));

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && v !== false;
}

export function ConductaTab({ historiaId, data, isMaxed, onPatchLocal }: ConductaTabProps) {
  const [openModal, setOpenModal] = useState(false);

  const conductaVals = [data?.aptitud, data?.controlFecha];
  const conductaFilled = conductaVals.filter(isFilled).length;
  const conductaState =
    conductaFilled === 0 ? 'empty' : conductaFilled === conductaVals.length ? 'complete' : 'partial';
  const subtitle =
    conductaFilled === 0
      ? 'Sin información'
      : data?.aptitud
        ? String(data.aptitud)
        : `${conductaFilled} de ${conductaVals.length} campos`;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card
        icon={<ClipboardCheck size={16} />}
        title="Conducta y remisión"
        subtitle={subtitle}
        state={conductaState}
        completionPct={Math.round((conductaFilled / conductaVals.length) * 100)}
        onEdit={() => setOpenModal(true)}
      />

      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        crumb="Conducta · Aptitud y seguimiento"
        title="Conducta y remisión"
        icon={<ClipboardCheck size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="aptitud"
            initialValue={data?.aptitud}
            onSaved={onPatchLocal}
            label="Aptitud"
            options={APTITUD_OPTS}
          />
          <TextField
            historiaId={historiaId}
            field="control_fecha"
            initialValue={
              data?.controlFecha instanceof Date
                ? data.controlFecha.toISOString().split('T')[0]
                : typeof data?.controlFecha === 'string' && data.controlFecha
                  ? data.controlFecha.split('T')[0]
                  : ''
            }
            onSaved={onPatchLocal}
            label="Fecha próximo control"
            type="date"
          />
          <div className="md:col-span-2">
            <PillToggleField
              historiaId={historiaId}
              field="exoneracion_programa"
              initialValue={data?.exoneracionPrograma}
              onSaved={onPatchLocal}
              label="Exoneración de programa"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
