import { useState } from 'react';
import { ClipboardList, HeartPulse, Dumbbell, Activity, Users } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, TextareaField, SelectField } from '../fields';
import { TemplateTextareaField } from '../corporativo-tabs/TemplateTextareaField';
import type { MedicalHistoryFull } from '../types';

/**
 * Tab t8 — Prescripción de ejercicio (panel de consulta médica).
 *
 * Estructura las 5 secciones del proceso de prescripción de Bodytech (basado en
 * el principio FIT del ACSM: Frecuencia, Intensidad, Tiempo, Tipo/modo):
 *   1. Recomendaciones generales (resumen)
 *   2. Cardiovascular (FIT)
 *   3. Fuerza (FIT + series/repeticiones)
 *   4. Flexibilidad
 *   5. Clases grupales (modalidad + si reemplaza o complementa)
 *
 * Enfoque híbrido: campos discretos por variable + dropdowns alimentados por los
 * "tableros dummies" (zonas de intensidad %FC/RPE y %RM), tableros de referencia
 * read-only dentro de cada modal, y un textarea de notas con plantilla FIT.
 */

interface PrescripcionTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
  /**
   * El panel Médico Corporativo reusa este tab tal cual, pero es standalone a
   * pantalla completa y sin videollamada: no aplica el pill de "afiliado
   * visible" y los modales van anchos. Los defaults conservan el
   * comportamiento del panel de consulta.
   */
  showEyePill?: boolean;
  modalSize?: 'default' | 'wide';
}

type ModalKey = 'generales' | 'cardio' | 'fuerza' | 'flexibilidad' | 'clases' | null;

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

function sectionState(vals: unknown[]): 'empty' | 'partial' | 'complete' {
  const filled = vals.filter(isFilled).length;
  return filled === 0 ? 'empty' : filled === vals.length ? 'complete' : 'partial';
}

// ---- Opciones de dropdown (de los "tableros dummies" de medicina del deporte) ----
const opt = (vals: string[]) => vals.map((v) => ({ value: v, label: v }));

const CARDIO_INTENSIDAD = opt([
  'Muy ligera (50-59% FCmáx · RPE 1-2)',
  'Ligera / Leve (60-69% FCmáx · RPE 3)',
  'Moderada (70-79% FCmáx · RPE 4)',
  'Fuerte / Vigorosa (80-89% FCmáx · RPE 5-7)',
  'Muy fuerte / Maximal (≥90% FCmáx · RPE 8-10)',
]);

const FUERZA_INTENSIDAD = opt([
  '< 60% RM (resistencia · ~15+ reps)',
  '60-75% RM (~12-15 reps)',
  '70-85% RM (~7-12 reps)',
  '> 85% RM (fuerza máx · 1-6 reps)',
]);

const FUERZA_TIPO = opt(['Peso propio', 'Bandas / therabands', 'Máquinas', 'Peso libre']);

/** Una serie se puede pautar por repeticiones o por tiempo: "tres series de 20
 *  segundos y haces las que puedas en esos 20 segundos". */
const FUERZA_MODO_SERIE = opt(['Repeticiones', 'Tiempo']);

const FLEX_TIPO = opt(['Estático / sostenido', 'Dinámico', 'Balístico', 'Asistido (FNP)']);

const CLASE_MODALIDAD = opt([
  'Cardio y ritmo',
  'Zonas (indoor cycling)',
  'Fuerza y tono',
  'Cuerpo y mente',
]);

const CLASE_REEMPLAZA = opt(['Reemplaza fuerza', 'Reemplaza cardio', 'Complementario']);

// ---- Plantillas FIT para el textarea de notas ----
const CARDIO_TEMPLATE =
  'Frecuencia: __ días/semana · Intensidad: moderada (70-79% FCmáx o percepción del ' +
  'esfuerzo — test del habla) · Tiempo: __ min/día · Tipo: actividades rítmicas de grandes ' +
  'grupos musculares (caminata, bicicleta, natación).';
const FUERZA_TEMPLATE =
  'Frecuencia: __ días/semana · Intensidad: __% RM (o RPE) · __ series x __ repeticiones · ' +
  'Descanso: __ min entre series · Tipo: __ (máquinas / peso libre / bandas / peso propio).';

// ---- Tablero de referencia read-only (colapsable) ----
function RefTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <details className="mt-1 rounded-xl border border-[#324049] bg-[#1a2530] overflow-hidden">
      <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[11px] font-semibold text-[#00a884] tracking-wide">
        {title}
      </summary>
      <div className="overflow-x-auto px-3.5 pb-3">
        <table className="w-full text-[11.5px] text-[#a4b1b9] border-collapse">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className="text-left font-semibold text-[#e9edef] py-1.5 pr-3 border-b border-[#324049]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="py-1.5 pr-3 border-b border-[#26323b] whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const CARDIO_BOARD = {
  title: 'Ver tabla de referencia — intensidad cardiovascular',
  headers: ['Intensidad', '% FC máx', '% FC reserva', 'RPE (1-10)'],
  rows: [
    ['Muy ligera', '50-59%', '30-39%', '1-2'],
    ['Ligera / Leve', '60-69%', '40-49%', '3'],
    ['Moderada', '70-79%', '50-59%', '4'],
    ['Fuerte / Vigorosa', '80-89%', '60-69%', '5-7'],
    ['Muy fuerte / Maximal', '≥90%', '≥70%', '8-10'],
  ],
};

const FUERZA_BOARD = {
  title: 'Ver tabla de referencia — carga (%RM) vs repeticiones',
  headers: ['% RM', 'Reps posibles', 'Objetivo'],
  rows: [
    ['95%', '2', 'Fuerza máxima'],
    ['90%', '4', 'Fuerza máxima'],
    ['85%', '7', 'Fuerza / hipertrofia'],
    ['80%', '10', 'Hipertrofia'],
    ['75%', '12', 'Hipertrofia'],
    ['70%', '15', 'Resistencia'],
  ],
};

export function PrescripcionTab({
  historiaId,
  data,
  isMaxed,
  onPatchLocal,
  showEyePill = true,
  modalSize = 'default',
}: PrescripcionTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const cardioVals = [data?.prescCardioFrecuencia, data?.prescCardioIntensidad, data?.prescCardioTiempo, data?.prescCardioTipo];
  const fuerzaVals = [data?.prescFuerzaFrecuencia, data?.prescFuerzaIntensidad, data?.prescFuerzaSeries, data?.prescFuerzaRepeticiones, data?.prescFuerzaTipo];
  const flexVals = [data?.prescFlexFrecuencia, data?.prescFlexTiempo, data?.prescFlexTipo];
  const claseVals = [data?.prescClaseModalidad, data?.prescClaseNombre, data?.prescClaseReemplaza];

  const subtitle = (vals: unknown[]) => {
    const filled = vals.filter(isFilled).length;
    return filled === 0 ? 'Sin información' : `${filled} de ${vals.length} campos`;
  };
  const pct = (vals: unknown[]) => Math.round((vals.filter(isFilled).length / vals.length) * 100);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<ClipboardList size={16} />}
        title="Recomendaciones generales"
        subtitle={isFilled(data?.prescGenerales) ? 'Completo' : 'Sin información'}
        state={isFilled(data?.prescGenerales) ? 'complete' : 'empty'}
        completionPct={isFilled(data?.prescGenerales) ? 100 : 0}
        span2
        onEdit={() => setOpenModal('generales')}
      />
      <Card
        icon={<HeartPulse size={16} />}
        title="Ejercicio cardiovascular"
        subtitle={subtitle(cardioVals)}
        state={sectionState(cardioVals)}
        completionPct={pct(cardioVals)}
        onEdit={() => setOpenModal('cardio')}
      />
      <Card
        icon={<Dumbbell size={16} />}
        title="Fuerza"
        subtitle={subtitle(fuerzaVals)}
        state={sectionState(fuerzaVals)}
        completionPct={pct(fuerzaVals)}
        onEdit={() => setOpenModal('fuerza')}
      />
      <Card
        icon={<Activity size={16} />}
        title="Flexibilidad"
        subtitle={subtitle(flexVals)}
        state={sectionState(flexVals)}
        completionPct={pct(flexVals)}
        onEdit={() => setOpenModal('flexibilidad')}
      />
      <Card
        icon={<Users size={16} />}
        title="Clases grupales"
        subtitle={subtitle(claseVals)}
        state={sectionState(claseVals)}
        completionPct={pct(claseVals)}
        onEdit={() => setOpenModal('clases')}
      />

      {/* 1. Recomendaciones generales */}
      <Modal
        open={openModal === 'generales'}
        onClose={() => setOpenModal(null)}
        crumb="Prescripción · General"
        title="Recomendaciones generales"
        icon={<ClipboardList size={18} />}
        isMaxed={isMaxed}
        showEyePill={showEyePill}
        size={modalSize}
      >
        <TextareaField
          historiaId={historiaId}
          field="presc_generales"
          initialValue={data?.prescGenerales}
          onSaved={onPatchLocal}
          label="Resumen del programa"
          rows={4}
          placeholder="Ej: programa de 3 días, énfasis en intervalos, cargas moderadas, objetivo bajar de peso."
        />
      </Modal>

      {/* 2. Cardiovascular */}
      <Modal
        open={openModal === 'cardio'}
        onClose={() => setOpenModal(null)}
        crumb="Prescripción · Cardiovascular"
        title="Ejercicio cardiovascular (FIT)"
        icon={<HeartPulse size={18} />}
        isMaxed={isMaxed}
        showEyePill={showEyePill}
        size={modalSize}
      >
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <TextField historiaId={historiaId} field="presc_cardio_frecuencia" initialValue={data?.prescCardioFrecuencia} onSaved={onPatchLocal} label="Frecuencia" placeholder="Ej: 3 días/semana" />
            <SelectField historiaId={historiaId} field="presc_cardio_intensidad" initialValue={data?.prescCardioIntensidad} onSaved={onPatchLocal} label="Intensidad" options={CARDIO_INTENSIDAD} placeholder="Seleccionar zona" />
            <TextField historiaId={historiaId} field="presc_cardio_tiempo" initialValue={data?.prescCardioTiempo} onSaved={onPatchLocal} label="Tiempo (duración)" placeholder="Ej: 30 min/día" />
            <TextField historiaId={historiaId} field="presc_cardio_tipo" initialValue={data?.prescCardioTipo} onSaved={onPatchLocal} label="Tipo / modo" placeholder="Ej: caminadora, bici, piscina, calle" />
          </div>
          <RefTable {...CARDIO_BOARD} />
          <TemplateTextareaField historiaId={historiaId} field="presc_cardio_notas" initialValue={data?.prescCardioNotas} onSaved={onPatchLocal} label="Notas / detalle" rows={3} template={CARDIO_TEMPLATE} />
        </div>
      </Modal>

      {/* 3. Fuerza */}
      <Modal
        open={openModal === 'fuerza'}
        onClose={() => setOpenModal(null)}
        crumb="Prescripción · Fuerza"
        title="Ejercicio de fuerza (FIT)"
        icon={<Dumbbell size={18} />}
        isMaxed={isMaxed}
        showEyePill={showEyePill}
        size={modalSize}
      >
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <TextField historiaId={historiaId} field="presc_fuerza_frecuencia" initialValue={data?.prescFuerzaFrecuencia} onSaved={onPatchLocal} label="Frecuencia" placeholder="Ej: 3 días/semana" />
            <SelectField historiaId={historiaId} field="presc_fuerza_intensidad" initialValue={data?.prescFuerzaIntensidad} onSaved={onPatchLocal} label="Intensidad (%RM)" options={FUERZA_INTENSIDAD} placeholder="Seleccionar zona" />
            <TextField historiaId={historiaId} field="presc_fuerza_series" initialValue={data?.prescFuerzaSeries} onSaved={onPatchLocal} label="Series" placeholder="Ej: 3 series" />
            <SelectField historiaId={historiaId} field="presc_fuerza_modo_serie" initialValue={data?.prescFuerzaModoSerie} onSaved={onPatchLocal} label="Cada serie se mide por" options={FUERZA_MODO_SERIE} placeholder="Seleccionar" />
            <TextField
              historiaId={historiaId}
              field="presc_fuerza_repeticiones"
              initialValue={data?.prescFuerzaRepeticiones}
              onSaved={onPatchLocal}
              label={data?.prescFuerzaModoSerie === 'Tiempo' ? 'Tiempo por serie' : 'Repeticiones'}
              placeholder={data?.prescFuerzaModoSerie === 'Tiempo' ? 'Ej: 20 s' : 'Ej: 8-12'}
            />
            <SelectField historiaId={historiaId} field="presc_fuerza_tipo" initialValue={data?.prescFuerzaTipo} onSaved={onPatchLocal} label="Tipo / modo" options={FUERZA_TIPO} placeholder="Seleccionar" />
          </div>
          <RefTable {...FUERZA_BOARD} />
          <TemplateTextareaField historiaId={historiaId} field="presc_fuerza_notas" initialValue={data?.prescFuerzaNotas} onSaved={onPatchLocal} label="Notas / detalle" rows={3} template={FUERZA_TEMPLATE} />
        </div>
      </Modal>

      {/* 4. Flexibilidad */}
      <Modal
        open={openModal === 'flexibilidad'}
        onClose={() => setOpenModal(null)}
        crumb="Prescripción · Flexibilidad"
        title="Ejercicio de flexibilidad"
        icon={<Activity size={18} />}
        isMaxed={isMaxed}
        showEyePill={showEyePill}
        size={modalSize}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField historiaId={historiaId} field="presc_flex_frecuencia" initialValue={data?.prescFlexFrecuencia} onSaved={onPatchLocal} label="Frecuencia" placeholder="Ej: diario / 3 días/semana" />
          <TextField historiaId={historiaId} field="presc_flex_tiempo" initialValue={data?.prescFlexTiempo} onSaved={onPatchLocal} label="Tiempo por estiramiento" placeholder="Ej: 20-30 s" />
          <SelectField historiaId={historiaId} field="presc_flex_tipo" initialValue={data?.prescFlexTipo} onSaved={onPatchLocal} label="Tipo de estiramiento" options={FLEX_TIPO} placeholder="Seleccionar" />
          <TextField historiaId={historiaId} field="presc_flex_enfasis" initialValue={data?.prescFlexEnfasis} onSaved={onPatchLocal} label="Énfasis (zona)" placeholder="Ej: isquiotibiales" />
        </div>
      </Modal>

      {/* 5. Clases grupales */}
      <Modal
        open={openModal === 'clases'}
        onClose={() => setOpenModal(null)}
        crumb="Prescripción · Clases grupales"
        title="Clases grupales"
        icon={<Users size={18} />}
        isMaxed={isMaxed}
        showEyePill={showEyePill}
        size={modalSize}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <SelectField historiaId={historiaId} field="presc_clase_modalidad" initialValue={data?.prescClaseModalidad} onSaved={onPatchLocal} label="Modalidad" options={CLASE_MODALIDAD} placeholder="Seleccionar modalidad" />
          <TextField historiaId={historiaId} field="presc_clase_nombre" initialValue={data?.prescClaseNombre} onSaved={onPatchLocal} label="Clase específica" placeholder="Ej: pilates, body pump, GAP" />
          <SelectField historiaId={historiaId} field="presc_clase_reemplaza" initialValue={data?.prescClaseReemplaza} onSaved={onPatchLocal} label="¿Reemplaza o complementa?" options={CLASE_REEMPLAZA} placeholder="Seleccionar" />
        </div>
      </Modal>
    </div>
  );
}
