import { useState } from 'react';
import { Dumbbell } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { TextField } from '../fields';
import { CalcAutosave } from './CalcAutosave';
import type { FormulaDef } from '../FormulaHint';
import type { MedicalHistoryFull } from '../types';

const FORMULAS: ReadonlyArray<FormulaDef> = [
  {
    campo: 'Horas entrenamiento/semana',
    formula: 'Sesiones entreno/semana × Horas entrenamiento/día',
  },
  {
    campo: 'Recomendación act. física/semana',
    formula: 'Activo si horas/semana > 2.5 · Inactivo si no',
  },
  {
    campo: 'Activo según tiempo entrenando',
    formula: 'Activo si meses de entrenamiento > 3 · Inactivo si no',
  },
];

interface CorpActividadFisicaTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? null : n;
}

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function CorpActividadFisicaTab({ historiaId, data, onPatchLocal }: CorpActividadFisicaTabProps) {
  const [open, setOpen] = useState(false);

  // ---- Fórmulas de la plantilla (hoja "Historia clinica") ----
  // I28 = L29*D28  → horas/semana = sesiones/semana × horas/día
  const horasDia = toNum(data?.mcAfHorasDia);
  const sesionesSemana = toNum(data?.mcAfSesionesSemana);
  const horasSemanaCalc =
    horasDia !== null && sesionesSemana !== null
      ? Math.round(horasDia * sesionesSemana * 100) / 100
      : null;

  // D29 = IF(I28>2.5,"Activo","Inactivo")
  const recomendacionCalc =
    horasSemanaCalc !== null ? (horasSemanaCalc > 2.5 ? 'Activo' : 'Inactivo') : null;

  // I29 = IF(L28>3,"Activo","Inactivo")  → L28 = meses de entrenamiento
  const meses = toNum(data?.mcAfMeses);
  const nivelCalc = meses !== null ? (meses > 3 ? 'Activo' : 'Inactivo') : null;

  const vals = [
    data?.mcAfHorasDia,
    horasSemanaCalc,
    data?.mcAfMeses,
    data?.mcAfModalidad,
    recomendacionCalc,
    nivelCalc,
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
          recomendacionCalc
            ? `${recomendacionCalc} · ${horasSemanaCalc} h/semana`
            : filled === 0
              ? 'Sin información'
              : `${filled} de ${vals.length} campos completos`
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
        size="wide"
        formulas={FORMULAS}
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
            field="mc_af_sesiones_semana"
            initialValue={data?.mcAfSesionesSemana}
            onSaved={onPatchLocal}
            label="Sesiones entreno/semana"
            type="number"
            min={0}
            max={14}
          />
          {/* Calculado: sesiones/semana × horas/día */}
          <Calculated
            label="Horas entrenamiento/semana"
            value={horasSemanaCalc ?? '—'}
            unit="h"
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
          {/* Calculado: > 2.5 h/semana → Activo */}
          <Calculated
            label="Recomendación act. física/semana"
            value={recomendacionCalc ?? '—'}
            unit="> 2.5 h/sem"
          />
          {/* Calculado: > 3 meses entrenando → Activo */}
          <Calculated
            label="Activo según tiempo entrenando"
            value={nivelCalc ?? '—'}
            unit="> 3 meses"
          />
          <TextField
            historiaId={historiaId}
            field="mc_af_modalidad"
            initialValue={data?.mcAfModalidad}
            onSaved={onPatchLocal}
            label="Modalidad"
            placeholder="Ej. Pesas, cardio, funcional..."
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

        {/* Persistencia de los tres campos derivados */}
        <CalcAutosave
          historiaId={historiaId}
          field="mc_af_horas_semana"
          value={horasSemanaCalc}
          serverValue={data?.mcAfHorasSemana ?? null}
          onPatchLocal={onPatchLocal}
        />
        <CalcAutosave
          historiaId={historiaId}
          field="mc_af_recomendacion"
          value={recomendacionCalc}
          serverValue={data?.mcAfRecomendacion ?? null}
          onPatchLocal={onPatchLocal}
        />
        <CalcAutosave
          historiaId={historiaId}
          field="mc_af_nivel"
          value={nivelCalc}
          serverValue={data?.mcAfNivel ?? null}
          onPatchLocal={onPatchLocal}
        />
      </Modal>
    </div>
  );
}
