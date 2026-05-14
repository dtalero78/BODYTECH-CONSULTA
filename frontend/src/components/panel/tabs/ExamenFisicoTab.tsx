import { useState } from 'react';
import { Scale, Stethoscope } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { TextField, SelectField, TextareaField } from '../fields';
import { useFieldAutoSave } from '../hooks/useFieldAutoSave';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';

interface ExamenFisicoTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'composicion' | 'examen' | null;

const POSTURA_OPTS: ReadonlyArray<DropdownOption> = [
  'Normal',
  'Anormal',
].map((v) => ({ value: v, label: v }));

const MOV_TREN_SUPERIOR_OPTS: ReadonlyArray<DropdownOption> = [
  'Normal',
  'Limitada',
  'Muy limitada',
].map((v) => ({ value: v, label: v }));

const EQUILIBRIO_OPTS: ReadonlyArray<DropdownOption> = [
  'Conservado',
  'Disminuido',
  'Ausente',
].map((v) => ({ value: v, label: v }));

const MARCHA_FUNCIONAL_OPTS: ReadonlyArray<DropdownOption> = [
  'Logra',
  'No logra',
  'Logra con apoyo',
  'Logra parcialmente',
].map((v) => ({ value: v, label: v }));

const RIESGO_OM_OPTS: ReadonlyArray<DropdownOption> = [
  'Sin riesgo',
  'Riesgo leve',
  'Riesgo moderado',
  'Riesgo alto',
].map((v) => ({ value: v, label: v }));

type Direction = 'down-good' | 'up-good' | 'neutral';

interface CCRow {
  label: string;
  anteriorField: string;
  nuevoField: string;
  anteriorValue: number | undefined;
  nuevoValue: number | undefined;
  direction: Direction;
  /** Si es true, el "nuevo" se muestra readonly (calculated) en vez de input. */
  nuevoReadonly?: boolean;
  /** Valor calculado para nuevoReadonly (ej. IMC). */
  nuevoCalculated?: number | null;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? null : n;
}

function pillTone(
  delta: number | null,
  direction: Direction
): { className: string; text: string } {
  if (delta === null) {
    return {
      className: 'bg-[#1a2530] border border-[#324049] text-[#6b7882]',
      text: '—',
    };
  }
  // tolerancia: |delta| < 0.05 → 0
  if (Math.abs(delta) < 0.05) {
    return {
      className: 'bg-[#1a2530] border border-[#324049] text-[#a4b1b9]',
      text: '0.0 NEUTRO',
    };
  }
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta).toFixed(1);
  const text = `${sign}${abs}`;
  if (direction === 'neutral') {
    return {
      className: 'bg-[#1a2530] border border-[#324049] text-[#a4b1b9]',
      text,
    };
  }
  const isGood =
    (direction === 'down-good' && delta < 0) || (direction === 'up-good' && delta > 0);
  if (isGood) {
    return {
      className: 'bg-[rgba(52,211,153,0.12)] border border-[rgba(52,211,153,0.35)] text-[#34d399]',
      text,
    };
  }
  return {
    className: 'bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.35)] text-[#ef4444]',
    text,
  };
}

function DeltaPill({
  anterior,
  nuevo,
  direction,
}: {
  anterior: number | null;
  nuevo: number | null;
  direction: Direction;
}) {
  let delta: number | null = null;
  if (anterior !== null && nuevo !== null) {
    delta = nuevo - anterior;
  }
  const tone = pillTone(delta, direction);
  return (
    <span
      className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[12px] font-bold tracking-wider ${tone.className}`}
    >
      {tone.text}
    </span>
  );
}

// Persists a calc field via autosave (no UI)
function CalcAutosave({
  historiaId,
  field,
  value,
  serverValue,
  onPatchLocal,
}: {
  historiaId: string | undefined;
  field: string;
  value: number | string | null;
  serverValue?: unknown;
  onPatchLocal: (field: string, value: unknown) => void;
}) {
  // Si el calculado es null (peso/estatura/edad faltan), NO emitimos PATCH —
  // preservamos el valor que ya hay en DB. Si los inputs cambian a algo válido,
  // `enabled` vuelve a true y el debounce normal de useAutoSave persistirá.
  const hasValue = value !== null && value !== undefined;
  useFieldAutoSave({
    historiaId,
    field,
    value,
    serverValue,
    onSaved: onPatchLocal,
    enabled: hasValue,
  });
  return null;
}

export function ExamenFisicoTab({
  historiaId,
  data,
  isMaxed,
  onPatchLocal,
}: ExamenFisicoTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  // Para IMC nuevo en vivo + subtitle.
  const pesoNuevo = toNum(data?.ccPesoNuevo);
  const estaturaNuevo = toNum(data?.ccEstaturaNuevo);
  const masaNuevo = toNum(data?.ccMasaMuscularNuevo);
  const immNuevo = toNum(data?.ccImmNuevo);
  const grasaNuevo = toNum(data?.ccGrasaNuevo);
  const perimetroNuevo = toNum(data?.ccPerimetroAbdominalNuevo);

  // IMC nuevo calculado en vivo. Si peso o estatura faltan, devuelve null.
  let imcNuevoCalc: number | null = null;
  if (pesoNuevo !== null && estaturaNuevo !== null && estaturaNuevo > 0) {
    const m = estaturaNuevo / 100;
    imcNuevoCalc = Math.round((pesoNuevo / (m * m)) * 10) / 10;
  }

  // ---- Card 4.1 subtitle ----
  const ccVals = [pesoNuevo, estaturaNuevo, masaNuevo, imcNuevoCalc, immNuevo, grasaNuevo, perimetroNuevo];
  const ccFilled = ccVals.filter((v) => v !== null).length;
  const ccState =
    ccFilled === 0 ? 'empty' : ccFilled === ccVals.length ? 'complete' : 'partial';
  const ccSubtitle =
    ccFilled === 0
      ? 'Sin medidas registradas'
      : ccState === 'complete'
        ? `Peso ${pesoNuevo} kg · IMC ${imcNuevoCalc ?? '—'}`
        : `${ccFilled} de ${ccVals.length} medidas`;

  // ---- Card 4.2 subtitle (examen físico) ----
  const examenVals = [
    data?.posturaEspalda,
    data?.posturaCadSup,
    data?.posturaCadInf,
    data?.hallazgosDescripcion,
    data?.hallazgosDolor,
    data?.movTrenSuperior,
    data?.fuerzaSuperior,
    data?.fuerzaAbdominal,
    data?.fuerzaInferior,
    data?.fcm,
    data?.tas,
    data?.tad,
    data?.equilibrioUnipodal,
    data?.riesgoMarcha,
    data?.riesgoOm,
  ];
  const examenFilled = examenVals.filter(
    (v) => v !== null && v !== undefined && v !== ''
  ).length;
  const examenState =
    examenFilled === 0 ? 'empty' : examenFilled === examenVals.length ? 'complete' : 'partial';
  const examenSubtitle =
    examenFilled === 0
      ? 'Sin hallazgos registrados'
      : `${examenFilled} de ${examenVals.length} campos completos`;

  const rows: CCRow[] = [
    {
      label: 'Peso (kg)',
      anteriorField: 'cc_peso_anterior',
      nuevoField: 'cc_peso_nuevo',
      anteriorValue: data?.ccPesoAnterior,
      nuevoValue: data?.ccPesoNuevo,
      direction: 'neutral',
      type: 'number', min: 20, max: 300,
    },
    {
      label: 'Estatura (cm)',
      anteriorField: 'cc_estatura_anterior',
      nuevoField: 'cc_estatura_nuevo',
      anteriorValue: data?.ccEstaturaAnterior,
      nuevoValue: data?.ccEstaturaNuevo,
      direction: 'neutral',
      type: 'number', min: 100, max: 250,
    },
    {
      label: '% Masa muscular',
      anteriorField: 'cc_masa_muscular_anterior',
      nuevoField: 'cc_masa_muscular_nuevo',
      anteriorValue: data?.ccMasaMuscularAnterior,
      nuevoValue: data?.ccMasaMuscularNuevo,
      direction: 'up-good',
      type: 'number', min: 0, max: 100,
    },
    {
      label: 'IMC',
      anteriorField: 'cc_imc_anterior',
      nuevoField: 'cc_imc_nuevo',
      anteriorValue: data?.ccImcAnterior,
      nuevoValue: data?.ccImcNuevo,
      direction: 'neutral',
      nuevoReadonly: true,
      nuevoCalculated: imcNuevoCalc,
      type: 'number', min: 10, max: 60,
    },
    {
      label: 'IMM',
      anteriorField: 'cc_imm_anterior',
      nuevoField: 'cc_imm_nuevo',
      anteriorValue: data?.ccImmAnterior,
      nuevoValue: data?.ccImmNuevo,
      direction: 'up-good',
      type: 'number', min: 0, max: 30,
    },
    {
      label: '% Grasa',
      anteriorField: 'cc_grasa_anterior',
      nuevoField: 'cc_grasa_nuevo',
      anteriorValue: data?.ccGrasaAnterior,
      nuevoValue: data?.ccGrasaNuevo,
      direction: 'down-good',
      type: 'number', min: 0, max: 80,
    },
    {
      label: 'Perímetro abdominal (cm)',
      anteriorField: 'cc_perimetro_abdominal_anterior',
      nuevoField: 'cc_perimetro_abdominal_nuevo',
      anteriorValue: data?.ccPerimetroAbdominalAnterior,
      nuevoValue: data?.ccPerimetroAbdominalNuevo,
      direction: 'down-good',
      type: 'number', min: 40, max: 200,
    },
  ];

  // FCR calculated from edad. Persists separately.
  const fcrCalc =
    typeof data?.edad === 'number' && !isNaN(data.edad)
      ? Math.round(208 - data.edad * 0.7)
      : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<Scale size={16} />}
        title="Análisis de composición corporal"
        subtitle={ccSubtitle}
        state={ccState}
        completionPct={Math.round((ccFilled / ccVals.length) * 100)}
        onEdit={() => setOpenModal('composicion')}
      />
      <Card
        icon={<Stethoscope size={16} />}
        title="Examen físico"
        subtitle={examenSubtitle}
        state={examenState}
        completionPct={Math.round((examenFilled / examenVals.length) * 100)}
        onEdit={() => setOpenModal('examen')}
      />

      {/* ============ Modal Composición Corporal ============ */}
      <Modal
        open={openModal === 'composicion'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Composición Corporal"
        title="Análisis de composición corporal"
        icon={<Scale size={18} />}
        isMaxed={isMaxed}
      >
        <div className="flex flex-col">
          {/* Header columnas */}
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 pb-2 border-b border-[#324049] mb-3">
            <div className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
              Medida
            </div>
            <div className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
              Anterior
            </div>
            <div className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
              Nuevo
            </div>
            <div className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
              Δ
            </div>
          </div>

          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 items-center py-2 border-b border-dashed border-[#324049] last:border-b-0"
            >
              <div className="text-[13px] text-[#e9edef] font-medium">{row.label}</div>
              <TextField
                historiaId={historiaId}
                field={row.anteriorField}
                initialValue={row.anteriorValue}
                onSaved={onPatchLocal}
                type={row.type ?? 'text'}
                min={row.min}
                max={row.max}
                placeholder="—"
              />
              {row.nuevoReadonly ? (
                <div className="w-full bg-[#1a2530] border border-[#324049] text-[#a4b1b9] px-3.5 py-2.5 rounded-xl text-[13.5px]">
                  {row.nuevoCalculated !== null && row.nuevoCalculated !== undefined
                    ? row.nuevoCalculated
                    : '—'}
                </div>
              ) : (
                <TextField
                  historiaId={historiaId}
                  field={row.nuevoField}
                  initialValue={row.nuevoValue}
                  onSaved={onPatchLocal}
                  type={row.type ?? 'text'}
                  min={row.min}
                  max={row.max}
                  placeholder="—"
                />
              )}
              <DeltaPill
                anterior={toNum(row.anteriorValue)}
                nuevo={
                  row.nuevoReadonly
                    ? row.nuevoCalculated ?? null
                    : toNum(row.nuevoValue)
                }
                direction={row.direction}
              />
            </div>
          ))}

          {/* Persistencia automática del IMC nuevo calculado */}
          <CalcAutosave
            historiaId={historiaId}
            field="cc_imc_nuevo"
            value={imcNuevoCalc}
            serverValue={data?.ccImcNuevo ?? null}
            onPatchLocal={onPatchLocal}
          />

          <div className="mt-5">
            <TextareaField
              historiaId={historiaId}
              field="cc_observacion"
              initialValue={data?.ccObservacion}
              onSaved={onPatchLocal}
              label="Observaciones"
              rows={3}
              placeholder="Notas sobre la composición corporal..."
            />
          </div>
        </div>
      </Modal>

      {/* ============ Modal Examen físico (form largo) ============ */}
      <Modal
        open={openModal === 'examen'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Hallazgos clínicos"
        title="Examen físico"
        icon={<Stethoscope size={18} />}
        isMaxed={isMaxed}
      >
        <div className="flex flex-col">
          {/* Subsección Postura */}
          <div className="pb-5">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              Postura
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <SelectField
                historiaId={historiaId}
                field="postura_espalda"
                initialValue={data?.posturaEspalda}
                onSaved={onPatchLocal}
                label="Espalda"
                options={POSTURA_OPTS}
              />
              <SelectField
                historiaId={historiaId}
                field="postura_cad_sup"
                initialValue={data?.posturaCadSup}
                onSaved={onPatchLocal}
                label="Cadena superior"
                options={POSTURA_OPTS}
              />
              <SelectField
                historiaId={historiaId}
                field="postura_cad_inf"
                initialValue={data?.posturaCadInf}
                onSaved={onPatchLocal}
                label="Cadena inferior"
                options={POSTURA_OPTS}
              />
              {/* Descripción libre cuando hay hallazgos anormales */}
              {(data?.posturaEspalda === 'Anormal' ||
                data?.posturaCadSup === 'Anormal' ||
                data?.posturaCadInf === 'Anormal') && (
                <div className="md:col-span-3">
                  <TextareaField
                    historiaId={historiaId}
                    field="postura_descripcion"
                    initialValue={data?.posturaDescripcion}
                    onSaved={onPatchLocal}
                    label="Descripción de hallazgos posturales"
                    rows={2}
                    placeholder="Describir las alteraciones encontradas..."
                  />
                </div>
              )}
            </div>
          </div>

          {/* Subsección Hallazgos */}
          <div className="pt-5 pb-5 border-t border-dashed border-[#324049]">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              Hallazgos
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="md:col-span-2">
                <TextareaField
                  historiaId={historiaId}
                  field="hallazgos_descripcion"
                  initialValue={data?.hallazgosDescripcion}
                  onSaved={onPatchLocal}
                  label="Descripción de hallazgos"
                  rows={3}
                />
              </div>
              <TextField
                historiaId={historiaId}
                field="hallazgos_stretching_cm"
                initialValue={data?.hallazgosStretchingCm}
                onSaved={onPatchLocal}
                label="Stretching isquiotibiales (cm)"
                type="number"
                placeholder="cm"
                min={-50}
                max={50}
              />
              <TextField
                historiaId={historiaId}
                field="hallazgos_dolor"
                initialValue={data?.hallazgosDolor}
                onSaved={onPatchLocal}
                label="Dolor EVA (0–10)"
                type="number"
                placeholder="0"
                min={0}
                max={10}
              />
              <div className="md:col-span-2">
                <TextareaField
                  historiaId={historiaId}
                  field="hallazgos_observaciones"
                  initialValue={data?.hallazgosObservaciones}
                  onSaved={onPatchLocal}
                  label="Observaciones"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Subsección Fuerza y movilidad */}
          <div className="pt-5 pb-5 border-t border-dashed border-[#324049]">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              Fuerza y movilidad
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <SelectField
                historiaId={historiaId}
                field="mov_tren_superior"
                initialValue={data?.movTrenSuperior}
                onSaved={onPatchLocal}
                label="Movilidad tren superior"
                options={MOV_TREN_SUPERIOR_OPTS}
              />
              <TextField
                historiaId={historiaId}
                field="fuerza_superior"
                initialValue={data?.fuerzaSuperior}
                onSaved={onPatchLocal}
                label="Fuerza superior (reps)"
                type="number"
                placeholder="repeticiones"
                min={0}
                max={200}
              />
              <TextField
                historiaId={historiaId}
                field="fuerza_abdominal"
                initialValue={data?.fuerzaAbdominal}
                onSaved={onPatchLocal}
                label="Fuerza abdominal (reps)"
                type="number"
                placeholder="repeticiones"
                min={0}
                max={200}
              />
              <TextField
                historiaId={historiaId}
                field="fuerza_inferior"
                initialValue={data?.fuerzaInferior}
                onSaved={onPatchLocal}
                label="Fuerza inferior (reps)"
                type="number"
                placeholder="repeticiones"
                min={0}
                max={200}
              />
              <TextField
                historiaId={historiaId}
                field="tecnica_sentadilla"
                initialValue={data?.tecnicaSentadilla}
                onSaved={onPatchLocal}
                label="Técnica de sentadilla"
                type="text"
              />
              <TextField
                historiaId={historiaId}
                field="estabilidad_plancha"
                initialValue={data?.estabilidadPlancha}
                onSaved={onPatchLocal}
                label="Estabilidad plancha (s)"
                type="number"
                placeholder="segundos"
                min={0}
                max={600}
              />
            </div>
          </div>

          {/* Subsección Signos y evaluación */}
          <div className="pt-5 pb-5 border-t border-dashed border-[#324049]">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              Signos y evaluación
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
              <Calculated
                label="FCR"
                value={fcrCalc !== null ? fcrCalc : '—'}
                unit="lpm"
              />
              <TextField
                historiaId={historiaId}
                field="fcm"
                initialValue={data?.fcm}
                onSaved={onPatchLocal}
                label="FCM (lpm)"
                type="number"
                placeholder="lpm"
                min={40}
                max={220}
              />
              <TextField
                historiaId={historiaId}
                field="tas"
                initialValue={data?.tas}
                onSaved={onPatchLocal}
                label="TAS (mmHg)"
                type="number"
                placeholder="mmHg"
                min={60}
                max={250}
              />
              <TextField
                historiaId={historiaId}
                field="tad"
                initialValue={data?.tad}
                onSaved={onPatchLocal}
                label="TAD (mmHg)"
                type="number"
                placeholder="mmHg"
                min={40}
                max={180}
              />
            </div>
            {/* Persistencia FCR — solo si existe edad */}
            {fcrCalc !== null && (
              <CalcAutosave
                historiaId={historiaId}
                field="fcr"
                value={fcrCalc}
                serverValue={data?.fcr ?? null}
                onPatchLocal={onPatchLocal}
              />
            )}
          </div>

          {/* Subsección final */}
          <div className="pt-5 border-t border-dashed border-[#324049]">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              Equilibrio y marcha
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <SelectField
                historiaId={historiaId}
                field="equilibrio_unipodal"
                initialValue={data?.equilibrioUnipodal}
                onSaved={onPatchLocal}
                label="Equilibrio unipodal"
                options={EQUILIBRIO_OPTS}
              />
              <TextField
                historiaId={historiaId}
                field="equilibrio_unipodal_segundos"
                initialValue={data?.equilibrioUnipodalSegundos}
                onSaved={onPatchLocal}
                label="Equilibrio unipodal (segundos)"
                type="number"
                placeholder="seg"
                min={0}
                max={300}
              />
              <SelectField
                historiaId={historiaId}
                field="riesgo_marcha"
                initialValue={data?.riesgoMarcha}
                onSaved={onPatchLocal}
                label="Evaluación funcional de marcha"
                options={MARCHA_FUNCIONAL_OPTS}
              />
              <SelectField
                historiaId={historiaId}
                field="riesgo_om"
                initialValue={data?.riesgoOm}
                onSaved={onPatchLocal}
                label="Riesgo osteomuscular"
                options={RIESGO_OM_OPTS}
              />
              <TextField
                historiaId={historiaId}
                field="marcha_estacionaria"
                initialValue={data?.marchaEstacionaria}
                onSaved={onPatchLocal}
                label="Marcha estacionaria"
                type="number"
                placeholder="pasos"
                min={0}
                max={500}
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

