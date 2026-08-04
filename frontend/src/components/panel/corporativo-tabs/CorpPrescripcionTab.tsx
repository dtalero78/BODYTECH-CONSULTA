import { useState } from 'react';
import { FileText, Dumbbell, Send } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, TextareaField } from '../fields';
import { TemplateTextareaField } from './TemplateTextareaField';
import type { MedicalHistoryFull } from '../types';

interface CorpPrescripcionTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'analisis' | 'prescripcion' | 'remision' | null;

const CARDIO_TEMPLATE =
  'Frecuencia: días/semana - Intensidad: mantener en moderada entre a latidos por ' +
  'minuto o por percepción del esfuerzo (test del habla) - Tiempo: iniciar con ' +
  'minutos/día (aumentar 5 minutos cada semana para llegar a hacer al menos 150 ' +
  'minutos/semana). - Tipo: Continua extensiva. Actividades rítmicas, con uso de ' +
  'grandes grupos musculares como caminata, bicicleta estática, natación - ' +
  'Progresión: aumento paulatino de cargas en un periodo de 12 semanas hasta ' +
  'lograr volumen de al menos 300 minutos de ejercicio/semana de intensidad ' +
  'moderada así: aumento inicial en tiempo (5 minutos/sesión), luego frecuencia ' +
  'de sesiones y luego en intensidad. No progresar a alta intensidad continua ' +
  'hasta completar este periodo de acondicionamiento.';

const FUERZA_TEMPLATE =
  'Frecuencia: veces por semana. - Intensidad: 5 RPE - Tiempo: 3 series de - ' +
  'repeticiones, 1-3 minutos de descanso entre series, - ejercicios diferentes ' +
  'semanales que comprometan los grandes grupos musculares - Tipo: máquinas de ' +
  'resistencia, pesa libre, bandas elásticas o peso propio. Ejercicios isotónicos ' +
  'o isométricos, bipodales o unipodales y de acuerdo al tipo de ejercicio definir ' +
  'la velocidad según criterio - Progresión: si el paciente es capaz de completar ' +
  'todas las series y repeticiones de una sesión enfocada en un grupo muscular, ' +
  'con buena técnica y ejecución en dos sesiones consecutivas en el grupo ' +
  'muscular trabajado, incrementar en intensidad y volumen según criterio de ' +
  'entrenador. Recomendaciones: grados de rango de movimiento articular de ' +
  'acuerdo a antecedentes patológicos o percepción de dolor, no realizar alto ' +
  'impacto articular, fortalecimiento de zona core.';

const FLEXIBILIDAD_TEMPLATE =
  'Frecuencia: mínimo 3 días/semana, se recomienda diario - Intensidad: hasta ' +
  'sentir incomodidad o tensión - Tiempo: de 10-30 segundos. 2-4 repeticiones por ' +
  'ejercicio. Tipo: estático, dinámico, facilitación neuromuscular.';

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpPrescripcionTab({ historiaId, data, onPatchLocal }: CorpPrescripcionTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const prescripcionVals = [data?.mcPrescripcionCardio, data?.mcPrescripcionFuerza, data?.mcPrescripcionFlexibilidad];
  const prescripcionFilled = prescripcionVals.filter(isFilled).length;

  return (
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
        icon={<Dumbbell size={16} />}
        title="Prescripción de ejercicio"
        subtitle={
          prescripcionFilled === 0
            ? 'Sin información'
            : `${prescripcionFilled} de ${prescripcionVals.length} campos completos`
        }
        state={prescripcionFilled === 0 ? 'empty' : prescripcionFilled === prescripcionVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((prescripcionFilled / prescripcionVals.length) * 100)}
        onEdit={() => setOpenModal('prescripcion')}
      />
      <Card
        icon={<Send size={16} />}
        title="Remisión"
        subtitle={isFilled(data?.mcRemision) ? data?.mcRemision || 'Completo' : 'Sin remisión'}
        state={isFilled(data?.mcRemision) ? 'complete' : 'empty'}
        span2
        completionPct={isFilled(data?.mcRemision) ? 100 : 0}
        onEdit={() => setOpenModal('remision')}
      />

      <Modal
        open={openModal === 'analisis'}
        onClose={() => setOpenModal(null)}
        crumb="Análisis"
        title="Análisis"
        icon={<FileText size={18} />}
        isMaxed
        showEyePill={false}
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
        open={openModal === 'prescripcion'}
        onClose={() => setOpenModal(null)}
        crumb="Prescripción de ejercicio"
        title="Prescripción de ejercicio"
        icon={<Dumbbell size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="flex flex-col gap-4">
          <TemplateTextareaField
            historiaId={historiaId}
            field="mc_prescripcion_cardio"
            initialValue={data?.mcPrescripcionCardio}
            onSaved={onPatchLocal}
            label="Cardio"
            rows={5}
            template={CARDIO_TEMPLATE}
          />
          <TemplateTextareaField
            historiaId={historiaId}
            field="mc_prescripcion_fuerza"
            initialValue={data?.mcPrescripcionFuerza}
            onSaved={onPatchLocal}
            label="Fuerza"
            rows={5}
            template={FUERZA_TEMPLATE}
          />
          <TemplateTextareaField
            historiaId={historiaId}
            field="mc_prescripcion_flexibilidad"
            initialValue={data?.mcPrescripcionFlexibilidad}
            onSaved={onPatchLocal}
            label="Flexibilidad"
            rows={3}
            template={FLEXIBILIDAD_TEMPLATE}
          />
        </div>
      </Modal>

      <Modal
        open={openModal === 'remision'}
        onClose={() => setOpenModal(null)}
        crumb="Remisión"
        title="Remisión"
        icon={<Send size={18} />}
        isMaxed
        showEyePill={false}
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
