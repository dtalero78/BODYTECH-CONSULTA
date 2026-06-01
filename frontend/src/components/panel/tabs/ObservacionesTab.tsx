import { useState } from 'react';
import { MessageSquare, FileText } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextareaField, TextField } from '../fields';
import type { MedicalHistoryFull } from '../types';

interface ObservacionesTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

type ModalKey = 'concepto' | 'diagnostico' | null;

export function ObservacionesTab({ historiaId, data, isMaxed, onPatchLocal }: ObservacionesTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const conceptoVals = [data?.mdConceptoFinal, data?.mdRecomendacionesMedicasAdicionales];
  const conceptoFilled = conceptoVals.filter(isFilled).length;
  const conceptoState =
    conceptoFilled === 0 ? 'empty' : conceptoFilled === conceptoVals.length ? 'complete' : 'partial';

  const dxVals = [data?.mdDx1, data?.mdDx2];
  const dxFilled = dxVals.filter(isFilled).length;
  const dxState = dxFilled === 0 ? 'empty' : dxFilled === dxVals.length ? 'complete' : 'partial';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<MessageSquare size={16} />}
        title="Concepto y recomendaciones"
        subtitle={
          conceptoFilled === 0 ? 'Sin información' : `${conceptoFilled} de ${conceptoVals.length} campos`
        }
        state={conceptoState}
        completionPct={Math.round((conceptoFilled / conceptoVals.length) * 100)}
        onEdit={() => setOpenModal('concepto')}
      />
      <Card
        icon={<FileText size={16} />}
        title="Diagnósticos y observaciones"
        subtitle={dxFilled === 0 ? 'Sin información' : `${dxFilled} de ${dxVals.length} campos`}
        state={dxState}
        completionPct={Math.round((dxFilled / dxVals.length) * 100)}
        onEdit={() => setOpenModal('diagnostico')}
      />

      <Modal
        open={openModal === 'concepto'}
        onClose={() => setOpenModal(null)}
        crumb="Observaciones · Concepto final"
        title="Concepto final y recomendaciones"
        icon={<MessageSquare size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 gap-3.5">
          <TextareaField
            historiaId={historiaId}
            field="mdConceptoFinal"
            initialValue={data?.mdConceptoFinal}
            onSaved={onPatchLocal}
            label="Concepto final"
            rows={4}
            placeholder="Resumen del estado clínico y conclusión de la consulta..."
          />
          <TextareaField
            historiaId={historiaId}
            field="mdRecomendacionesMedicasAdicionales"
            initialValue={data?.mdRecomendacionesMedicasAdicionales}
            onSaved={onPatchLocal}
            label="Recomendaciones médicas adicionales"
            rows={4}
            placeholder="Indicaciones específicas para el afiliado..."
          />
          <TextareaField
            historiaId={historiaId}
            field="mdObservacionesCertificado"
            initialValue={data?.mdObservacionesCertificado}
            onSaved={onPatchLocal}
            label="Observaciones para certificado"
            rows={3}
            placeholder="Texto para incluir en el certificado médico..."
          />
        </div>
      </Modal>

      <Modal
        open={openModal === 'diagnostico'}
        onClose={() => setOpenModal(null)}
        crumb="Observaciones · Diagnósticos"
        title="Diagnósticos"
        icon={<FileText size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField
            historiaId={historiaId}
            field="mdDx1"
            initialValue={data?.mdDx1}
            onSaved={onPatchLocal}
            label="Diagnóstico 1 (CIE-10)"
            placeholder="Código o descripción"
          />
          <TextField
            historiaId={historiaId}
            field="mdDx2"
            initialValue={data?.mdDx2}
            onSaved={onPatchLocal}
            label="Diagnóstico 2 (CIE-10)"
            placeholder="Código o descripción"
          />
        </div>
      </Modal>
    </div>
  );
}
