import { useState } from 'react';
import { Dumbbell } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField } from '../fields';
import type { MedicalHistoryFull } from '../types';

interface CorpActividadFisicaTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpActividadFisicaTab({ historiaId, data, onPatchLocal }: CorpActividadFisicaTabProps) {
  const [open, setOpen] = useState(false);

  const vals = [
    data?.mcAfHorasDia,
    data?.mcAfHorasSemana,
    data?.mcAfMeses,
    data?.mcAfModalidad,
    data?.mcAfRecomendacion,
    data?.mcAfNivel,
    data?.mcAfSesionesSemana,
    data?.mcAfRpe,
    data?.mcAfHorasSedentario,
    data?.mcAfObjetivo,
  ];
  const filled = vals.filter(isFilled).length;
  const state = filled === 0 ? 'empty' : filled === vals.length ? 'complete' : 'partial';

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card
        icon={<Dumbbell size={16} />}
        title="Registro de actividad física"
        subtitle={
          filled === 0 ? 'Sin información' : `${filled} de ${vals.length} campos completos`
        }
        state={state}
        completionPct={Math.round((filled / vals.length) * 100)}
        onEdit={() => setOpen(true)}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        crumb="Registro de actividad física"
        title="Registro de actividad física"
        icon={<Dumbbell size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <TextField
            historiaId={historiaId}
            field="mc_af_horas_dia"
            initialValue={data?.mcAfHorasDia}
            onSaved={onPatchLocal}
            label="Horas entrenamiento/día"
            type="number"
            min={0}
            max={24}
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_horas_semana"
            initialValue={data?.mcAfHorasSemana}
            onSaved={onPatchLocal}
            label="Horas entrenamiento/semana"
            type="number"
            min={0}
            max={168}
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_meses"
            initialValue={data?.mcAfMeses}
            onSaved={onPatchLocal}
            label="Meses de entrenamiento"
            type="number"
            min={0}
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_sesiones_semana"
            initialValue={data?.mcAfSesionesSemana}
            onSaved={onPatchLocal}
            label="Sesiones entreno/semana"
            type="number"
            min={0}
            max={14}
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_rpe"
            initialValue={data?.mcAfRpe}
            onSaved={onPatchLocal}
            label="Intensidad (RPE promedio)"
            type="number"
            min={0}
            max={10}
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_horas_sedentario"
            initialValue={data?.mcAfHorasSedentario}
            onSaved={onPatchLocal}
            label="Horas sedentario/día"
            type="number"
            min={0}
            max={24}
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_modalidad"
            initialValue={data?.mcAfModalidad}
            onSaved={onPatchLocal}
            label="Modalidad"
            placeholder="Ej. Pesas, cardio, funcional..."
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_recomendacion"
            initialValue={data?.mcAfRecomendacion}
            onSaved={onPatchLocal}
            label="Recomendación act. física/semana"
            placeholder="Ej. Activo"
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_nivel"
            initialValue={data?.mcAfNivel}
            onSaved={onPatchLocal}
            label="Nivel según tiempo de entrenamiento"
            placeholder="Ej. Activo"
          />
          <div className="md:col-span-3">
            <TextField
              historiaId={historiaId}
              field="mc_af_objetivo"
              initialValue={data?.mcAfObjetivo}
              onSaved={onPatchLocal}
              label="Objetivo"
              placeholder="Ej. Acondicionamiento físico general"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
