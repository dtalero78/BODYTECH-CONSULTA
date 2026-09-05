import { useState } from 'react';
import { Dumbbell } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { TextField, SelectField, PillToggleField, MultiPillField } from '../fields';
import { CalcAutosave } from './CalcAutosave';
import type { FormulaDef } from '../FormulaHint';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';

interface CorpActividadFisicaTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

const opt = (vals: string[]): ReadonlyArray<DropdownOption> =>
  vals.map((v) => ({ value: v, label: v }));

/** Dónde entrena. La plantilla traía tipos de deporte; el equipo médico pidió
 *  el lugar, porque en sedes corporativas se mezcla gimnasio y casa.
 *
 *  Selección múltiple, no una sola: el mismo equipo reportó que hay gente que
 *  combina (gimnasio y casa, o gimnasio y aire libre) y con una única opción
 *  quedaba obligado a elegir una y perder la otra. Se guarda separado por coma
 *  en la misma columna, así que lo ya diligenciado se sigue leyendo. */
const MODALIDAD_OPTS: ReadonlyArray<string> = ['Gym', 'Casa', 'Outdoor'];

/** Catálogo de la hoja "Listas" del Excel, sin la opción "Otro" (decisión del
 *  equipo médico: "esos son los seis, sin ningún otro"). */
const OBJETIVO_OPTS = opt([
  'Salud',
  'Mejorar condición física',
  'Bajar de peso',
  'Aumento de masa muscular',
  'Tonificar y definir',
  'Rehabilitación de lesión',
]);

// ---- Umbrales acordados con el equipo médico ----
/** Minutos/semana a partir de los cuales se considera Activo. */
const MIN_SEMANA_ACTIVO = 300;
/** Meses entrenando de forma regular para pasar de Principiante a Intermedio. */
const MESES_INTERMEDIO = 3;
/** Meses entrenando de forma regular para pasar de Intermedio a Avanzado. */
const MESES_AVANZADO = 12;

const FORMULAS: ReadonlyArray<FormulaDef> = [
  {
    campo: 'Minutos entrenamiento/semana',
    formula: 'Sesiones entreno/semana × Minutos por sesión',
  },
  {
    campo: 'Nivel de actividad física',
    formula: `Sedentario si 0 · Irregularmente activo si 1–${MIN_SEMANA_ACTIVO - 1} · Activo si ${MIN_SEMANA_ACTIVO}+ min/semana`,
    nota: 'Mide cuánto se mueve la persona hoy, sin importar dónde ni desde cuándo.',
  },
  {
    campo: 'Nivel de entrenamiento',
    formula: `Principiante si ≤ ${MESES_INTERMEDIO} meses · Intermedio si ${MESES_INTERMEDIO}–${MESES_AVANZADO} · Avanzado si > ${MESES_AVANZADO}`,
    nota: 'Es distinto del nivel de actividad física: sirve para graduar la exigencia del programa. Alguien puede ser muy activo (corre, monta bici) y aun así principiante en gimnasio. Si está sedentario se toma como Principiante.',
  },
];

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

  // ---- Volumen semanal: sesiones/semana × minutos por sesión ----
  const minutosSesion = toNum(data?.mcAfMinutosSesion);
  const sesionesSemana = toNum(data?.mcAfSesionesSemana);
  const minutosSemanaCalc =
    minutosSesion !== null && sesionesSemana !== null
      ? Math.round(minutosSesion * sesionesSemana)
      : null;

  // ---- Nivel de ACTIVIDAD FÍSICA (cuánto se mueve hoy) ----
  let clasificacionCalc: string | null = null;
  if (minutosSemanaCalc !== null) {
    if (minutosSemanaCalc <= 0) clasificacionCalc = 'Sedentario';
    else if (minutosSemanaCalc < MIN_SEMANA_ACTIVO) clasificacionCalc = 'Irregularmente activo';
    else clasificacionCalc = 'Activo';
  }

  // ---- Nivel de ENTRENAMIENTO (desde cuándo entrena regularmente) ----
  // Es una clasificación distinta a la anterior: gradúa qué tan exigente puede
  // ser el programa. Si la persona está sedentaria arranca como Principiante,
  // aunque en el pasado haya entrenado varios meses.
  const meses = toNum(data?.mcAfMeses);
  let nivelCalc: string | null = null;
  if (clasificacionCalc === 'Sedentario') {
    nivelCalc = 'Principiante';
  } else if (meses !== null) {
    if (meses <= MESES_INTERMEDIO) nivelCalc = 'Principiante';
    else if (meses <= MESES_AVANZADO) nivelCalc = 'Intermedio';
    else nivelCalc = 'Avanzado';
  }

  const vals = [
    data?.mcAfMinutosSesion,
    data?.mcAfSesionesSemana,
    minutosSemanaCalc,
    data?.mcAfMeses,
    nivelCalc,
    data?.mcAfExperienciaGym,
    data?.mcAfHorasSedentario,
    data?.mcAfModalidad,
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
          clasificacionCalc
            ? `${clasificacionCalc} · ${minutosSemanaCalc} min/semana${nivelCalc ? ` · ${nivelCalc}` : ''}`
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
        <div className="flex flex-col gap-5">
          {/* Volumen: lo que determina el nivel de actividad física */}
          <div>
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">
              Volumen de entrenamiento
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              <TextField
                historiaId={historiaId}
                field="mc_af_minutos_sesion"
                initialValue={data?.mcAfMinutosSesion}
                onSaved={onPatchLocal}
                label="Minutos por sesión"
                type="number"
                min={0}
                max={600}
                placeholder="Ej. 50"
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
              <Calculated
                label="Minutos entrenamiento/semana"
                value={minutosSemanaCalc ?? '—'}
                unit="min"
              />
              {/* El detalle de los umbrales vive en el tooltip de fórmulas del
                  header, para no repetirlo aquí y que no parta el renglón. */}
              <Calculated
                label="Nivel de actividad física"
                value={clasificacionCalc ?? '—'}
              />
            </div>
          </div>

          {/* Experiencia: lo que determina qué tan exigente puede ser el programa */}
          <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">
              Experiencia de entrenamiento
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              <TextField
                historiaId={historiaId}
                field="mc_af_meses"
                initialValue={data?.mcAfMeses}
                onSaved={onPatchLocal}
                label="Meses entrenando regularmente"
                type="number"
                min={0}
                max={600}
              />
              <Calculated label="Nivel de entrenamiento" value={nivelCalc ?? '—'} />
              <PillToggleField
                historiaId={historiaId}
                field="mc_af_experiencia_gym"
                initialValue={data?.mcAfExperienciaGym}
                onSaved={onPatchLocal}
                label="¿Experiencia en gimnasio?"
                trueLabel="Sí"
                falseLabel="No"
              />
            </div>
          </div>

          {/* Contexto */}
          <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">
              Contexto y objetivo
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
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
              <MultiPillField
                historiaId={historiaId}
                field="mc_af_modalidad"
                initialValue={data?.mcAfModalidad}
                onSaved={onPatchLocal}
                label="¿Dónde entrena?"
                options={MODALIDAD_OPTS}
              />
              <SelectField
                historiaId={historiaId}
                field="mc_af_objetivo"
                initialValue={data?.mcAfObjetivo}
                onSaved={onPatchLocal}
                label="Objetivo"
                options={OBJETIVO_OPTS}
                placeholder="Seleccionar..."
              />
            </div>
          </div>
        </div>

        {/* Persistencia de los derivados */}
        <CalcAutosave
          historiaId={historiaId}
          field="mc_af_minutos_semana"
          value={minutosSemanaCalc}
          serverValue={data?.mcAfMinutosSemana ?? null}
          onPatchLocal={onPatchLocal}
        />
        <CalcAutosave
          historiaId={historiaId}
          field="mc_af_clasificacion"
          value={clasificacionCalc}
          serverValue={data?.mcAfClasificacion ?? null}
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
