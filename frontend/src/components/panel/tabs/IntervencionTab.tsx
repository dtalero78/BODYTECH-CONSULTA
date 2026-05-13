import { useState } from 'react';
import { FlaskConical, Target, FileText } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField, TextareaField, PillToggleField } from '../fields';
import type { MedicalHistoryFull } from '../types';

interface IntervencionTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

const TIPO_TECNOLOGIA_OPTS = [
  'Tecnología en salud',
  'Procedimiento',
  'Consulta médica',
  'Rehabilitación',
  'Terapia física',
  'Otro',
].map((v) => ({ value: v, label: v }));

const TIPO_META_OPTS = [
  'Reducción de peso corporal',
  'Aumento de masa muscular',
  'Mejora de condición física',
  'Rehabilitación funcional',
  'Control de enfermedad crónica',
  'Prevención cardiovascular',
  'Otro',
].map((v) => ({ value: v, label: v }));

const DX_TIPO_OPTS = [
  'Confirmado nuevo',
  'Confirmado repetido',
  'Sospecha diagnóstica',
  'Descartado',
].map((v) => ({ value: v, label: v }));

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && v !== false;
}

type ModalKey = 'intervencion' | 'metas' | 'dx' | null;

export function IntervencionTab({ historiaId, data, isMaxed, onPatchLocal }: IntervencionTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const intervVals = [data?.intervencionAnalisis, data?.intervencionTipoTecnologia];
  const intervFilled = intervVals.filter(isFilled).length;
  const intervState = intervFilled === 0 ? 'empty' : intervFilled === intervVals.length ? 'complete' : 'partial';

  const metaVals = [data?.intervencionTipoMeta, data?.intervencionMetaTexto];
  const metaFilled = metaVals.filter(isFilled).length;
  const metaState = metaFilled === 0 ? 'empty' : metaFilled === metaVals.length ? 'complete' : 'partial';

  const dxVals = [data?.dxTecnologiaSalud, data?.dxProcedimiento, data?.dxTipo];
  const dxFilled = dxVals.filter(isFilled).length;
  const dxState = dxFilled === 0 ? 'empty' : dxFilled === dxVals.length ? 'complete' : 'partial';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<FlaskConical size={16} />}
        title="Intervención"
        subtitle={intervFilled === 0 ? 'Sin información' : `${intervFilled} de ${intervVals.length} campos`}
        state={intervState}
        completionPct={Math.round((intervFilled / intervVals.length) * 100)}
        onEdit={() => setOpenModal('intervencion')}
      />
      <Card
        icon={<Target size={16} />}
        title="Metas de intervención"
        subtitle={metaFilled === 0 ? 'Sin información' : `${metaFilled} de ${metaVals.length} campos`}
        state={metaState}
        completionPct={Math.round((metaFilled / metaVals.length) * 100)}
        onEdit={() => setOpenModal('metas')}
      />
      <Card
        icon={<FileText size={16} />}
        title="Diagnóstico / CUPS"
        subtitle={dxFilled === 0 ? 'Sin información' : `${dxFilled} de ${dxVals.length} campos`}
        state={dxState}
        span2
        completionPct={Math.round((dxFilled / dxVals.length) * 100)}
        onEdit={() => setOpenModal('dx')}
      />

      <Modal
        open={openModal === 'intervencion'}
        onClose={() => setOpenModal(null)}
        crumb="Intervención · Análisis"
        title="Intervención y procedimiento"
        icon={<FlaskConical size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="intervencion_tipo_tecnologia"
            initialValue={data?.intervencionTipoTecnologia}
            onSaved={onPatchLocal}
            label="Tipo de tecnología"
            options={TIPO_TECNOLOGIA_OPTS}
          />
          <PillToggleField
            historiaId={historiaId}
            field="intervencion_educacion_si"
            initialValue={data?.intervencionEducacionSi}
            onSaved={onPatchLocal}
            label="Incluye educación al paciente"
          />
          {data?.intervencionEducacionSi && (
            <div className="md:col-span-2">
              <TextField
                historiaId={historiaId}
                field="intervencion_educacion_tipo"
                initialValue={data?.intervencionEducacionTipo}
                onSaved={onPatchLocal}
                label="Tipo de educación"
                placeholder="Ej: Autocuidado, Estilo de vida saludable..."
              />
            </div>
          )}
          <div className="md:col-span-2">
            <TextareaField
              historiaId={historiaId}
              field="intervencion_analisis"
              initialValue={data?.intervencionAnalisis}
              onSaved={onPatchLocal}
              label="Análisis de intervención"
              rows={4}
              placeholder="Descripción del plan de intervención..."
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={openModal === 'metas'}
        onClose={() => setOpenModal(null)}
        crumb="Intervención · Metas"
        title="Metas de intervención"
        icon={<Target size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="intervencion_tipo_meta"
            initialValue={data?.intervencionTipoMeta}
            onSaved={onPatchLocal}
            label="Tipo de meta"
            options={TIPO_META_OPTS}
          />
          <TextareaField
            historiaId={historiaId}
            field="intervencion_meta_texto"
            initialValue={data?.intervencionMetaTexto}
            onSaved={onPatchLocal}
            label="Descripción de la meta"
            rows={4}
            placeholder="Meta SMART: específica, medible, alcanzable, relevante, temporal..."
          />
        </div>
      </Modal>

      <Modal
        open={openModal === 'dx'}
        onClose={() => setOpenModal(null)}
        crumb="Intervención · Diagnóstico"
        title="Diagnóstico y procedimiento"
        icon={<FileText size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField
            historiaId={historiaId}
            field="dx_tecnologia_salud"
            initialValue={data?.dxTecnologiaSalud}
            onSaved={onPatchLocal}
            label="Tecnología en salud (CIE-10)"
            placeholder="Código CIE-10"
          />
          <SelectField
            historiaId={historiaId}
            field="dx_tipo"
            initialValue={data?.dxTipo}
            onSaved={onPatchLocal}
            label="Tipo de diagnóstico"
            options={DX_TIPO_OPTS}
          />
          <div className="md:col-span-2">
            <TextField
              historiaId={historiaId}
              field="dx_procedimiento"
              initialValue={data?.dxProcedimiento}
              onSaved={onPatchLocal}
              label="Procedimiento (CUPS)"
              placeholder="Código CUPS"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
