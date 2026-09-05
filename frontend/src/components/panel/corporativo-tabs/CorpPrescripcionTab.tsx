import { useState } from 'react';
import { FileText, Send } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, TextareaField } from '../fields';
import { PrescripcionTab, type PrescModalKey } from '../tabs/PrescripcionTab';
import type { MedicalHistoryFull } from '../types';

interface CorpPrescripcionTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'analisis' | 'remision' | null;

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

/**
 * Prescripción del examen ocupacional.
 *
 * La prescripción de ejercicio es EXACTAMENTE la del panel del rol Médico: se
 * reusa `PrescripcionTab` (mismas 5 secciones FIT, mismos dropdowns, mismas
 * tablas de referencia y mismas columnas `presc_*`), sólo ajustando el modal a
 * este panel (sin pill de videollamada y a ancho completo). Al ser el mismo
 * componente, ambos paneles no se pueden desincronizar.
 *
 * Encima se conservan Análisis y Remisión, que son propios de la plantilla del
 * examen ocupacional y no existen en el panel de consulta.
 */
export function CorpPrescripcionTab({ historiaId, data, onPatchLocal }: CorpPrescripcionTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);
  // Paso abierto DENTRO de PrescripcionTab. Vive acá porque el recorrido del
  // examen ocupacional entra y sale de ese componente:
  //   Análisis → generales → cardio → fuerza → flexibilidad → clases → Remisión
  // Los extremos son de este tab y el medio del otro, así que alguien tiene que
  // sostener el hilo; el padre es el único que ve las dos mitades.
  const [prescStep, setPrescStep] = useState<PrescModalKey | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* Prescripción de ejercicio — idéntica a la del rol Médico */}
      <PrescripcionTab
        historiaId={historiaId}
        data={data}
        isMaxed
        onPatchLocal={onPatchLocal}
        showEyePill={false}
        modalSize="wide"
        openStep={prescStep}
        onStepChange={setPrescStep}
        chainStart={{ onBack: () => setOpenModal('analisis') }}
        chainEnd={{ label: 'Remisión', onNext: () => setOpenModal('remision') }}
      />

      {/* Propios del examen ocupacional */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          icon={<FileText size={16} />}
          title="Análisis"
          subtitle={isFilled(data?.mcAnalisis) ? 'Completo' : 'Sin información'}
          state={isFilled(data?.mcAnalisis) ? 'complete' : 'empty'}
          completionPct={isFilled(data?.mcAnalisis) ? 100 : 0}
          onEdit={() => setOpenModal('analisis')}
        />
        <Card
          icon={<Send size={16} />}
          title="Remisión"
          subtitle={isFilled(data?.mcRemision) ? data?.mcRemision || 'Completo' : 'Sin remisión'}
          state={isFilled(data?.mcRemision) ? 'complete' : 'empty'}
          completionPct={isFilled(data?.mcRemision) ? 100 : 0}
          onEdit={() => setOpenModal('remision')}
        />
      </div>

      <Modal
        open={openModal === 'analisis'}
        onClose={() => setOpenModal(null)}
        nextLabel="Recomendaciones generales"
        onNext={() => {
          setOpenModal(null);
          setPrescStep('generales');
        }}
        crumb="Análisis"
        title="Análisis"
        icon={<FileText size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <TextareaField
          historiaId={historiaId}
          field="mc_analisis"
          initialValue={data?.mcAnalisis}
          onSaved={onPatchLocal}
          label="Análisis de la consulta"
          rows={6}
          placeholder="Paciente en buenas condiciones generales, sin síntomas de alarma..."
        />
      </Modal>

      <Modal
        open={openModal === 'remision'}
        onClose={() => setOpenModal(null)}
        onBack={() => {
          setOpenModal(null);
          setPrescStep('clases');
        }}
        crumb="Remisión"
        title="Remisión"
        icon={<Send size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <TextField
          historiaId={historiaId}
          field="mc_remision"
          initialValue={data?.mcRemision}
          onSaved={onPatchLocal}
          label="Remitido a"
          placeholder="Ej. Medicina del deporte"
        />
      </Modal>
    </div>
  );
}
