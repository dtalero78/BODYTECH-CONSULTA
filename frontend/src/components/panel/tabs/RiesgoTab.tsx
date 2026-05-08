import { useEffect, useState, useRef } from 'react';
import { Activity, HeartPulse, Shield } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { PillToggleField } from '../fields';
import { useFieldAutoSave } from '../hooks/useFieldAutoSave';
import type { MedicalHistoryFull } from '../types';

interface RiesgoTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'downton' | 'acsm' | 'bodytech' | null;

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
}

// ===== Downton =====
function downtonCategoria(score: number): string {
  if (score >= 4) return 'Riesgo alto';
  if (score >= 2) return 'Riesgo intermedio';
  return 'Bajo riesgo';
}

function computeDowntonScore(d: MedicalHistoryFull | null): number {
  const caidas = coerceBool(d?.downtonCaidas) ? 1 : 0;
  const mental = coerceBool(d?.downtonEstadoMental) ? 1 : 0;
  const meds =
    coerceBool(d?.downtonMedicamentos) &&
    (coerceBool(d?.downtonMedAntiparkinson) ||
      coerceBool(d?.downtonMedAntidepresivos) ||
      coerceBool(d?.downtonMedOtros))
      ? 1
      : 0;
  const sens =
    coerceBool(d?.downtonDeficitsSensoriales) &&
    (coerceBool(d?.downtonVisual) ||
      coerceBool(d?.downtonAuditivo) ||
      coerceBool(d?.downtonDefExtremidades))
      ? 1
      : 0;
  return caidas + mental + meds + sens;
}

// ===== ACSM =====
function acsmCategoria(count: number): string {
  if (count >= 7) return 'MUY ALTO';
  if (count >= 4) return 'ALTO';
  if (count >= 2) return 'MEDIO';
  return 'BAJO';
}

function acsmBadgeColor(cat: string): string {
  switch (cat) {
    case 'MUY ALTO':
      return '#ef4444';
    case 'ALTO':
      return '#f97316';
    case 'MEDIO':
      return '#fbbf24';
    default:
      return '#34d399';
  }
}

function computeAcsmCount(d: MedicalHistoryFull | null): number {
  return [
    coerceBool(d?.acsmSedentarismo),
    coerceBool(d?.acsmTabaquismo),
    coerceBool(d?.acsmHipertension),
    coerceBool(d?.acsmDislipidemia),
    coerceBool(d?.acsmObesidad),
    coerceBool(d?.acsmEdad),
    coerceBool(d?.acsmFamiliarCardiaco),
    coerceBool(d?.acsmGenero),
    coerceBool(d?.acsmDiabetes),
    coerceBool(d?.acsmEnfPulmonar),
    coerceBool(d?.acsmEnfCardiovascular),
    coerceBool(d?.acsmEnfRenal),
  ].filter(Boolean).length;
}

// ===== Bodytech final =====
function computeRiesgoFinal(d: MedicalHistoryFull | null, acsmCat: string): string {
  const altoTriggers =
    coerceBool(d?.btFactor1) ||
    coerceBool(d?.btFactor2) ||
    coerceBool(d?.btFactor3) ||
    acsmCat === 'ALTO' ||
    acsmCat === 'MUY ALTO' ||
    (coerceBool(d?.antQuirurgicoFlag) && d?.antQuirurgicoTiempo === 'Menor a 3 meses') ||
    coerceBool(d?.embarazoActual);
  if (altoTriggers) return 'ALTO';
  if (acsmCat === 'MEDIO') return 'MEDIO';
  return 'BAJO';
}

// ====== Sub-component: persists a calculated string field via autosave ======
function CalcAutosave({
  historiaId,
  field,
  value,
  onPatchLocal,
}: {
  historiaId: string | undefined;
  field: string;
  value: string | null;
  onPatchLocal: (field: string, value: unknown) => void;
}) {
  useFieldAutoSave({
    historiaId,
    field,
    value,
    onSaved: onPatchLocal,
  });
  return null;
}

// ====== Sub-component: contador con bump ======
function BumpCounter({ count, total }: { count: number; total: number }) {
  const [pulse, setPulse] = useState(false);
  const lastCount = useRef(count);
  useEffect(() => {
    if (lastCount.current !== count) {
      lastCount.current = count;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 240);
      return () => clearTimeout(t);
    }
  }, [count]);
  return (
    <span
      className={`inline-block text-[12px] font-semibold text-[#a4b1b9] ${pulse ? 'is-bumping' : ''}`}
    >
      {count} / {total} factores activos
    </span>
  );
}

export function RiesgoTab({ historiaId, data, isMaxed, onPatchLocal }: RiesgoTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const downtonScore = computeDowntonScore(data);
  const downtonCat = downtonCategoria(downtonScore);

  const acsmCount = computeAcsmCount(data);
  const acsmCat = acsmCategoria(acsmCount);
  const acsmColor = acsmBadgeColor(acsmCat);

  const riesgoFinal = computeRiesgoFinal(data, acsmCat);

  // ===== Card states =====
  const downtonComplete = !!data?.downtonRiesgo;
  const downtonCardState = downtonComplete
    ? 'complete'
    : data?.downtonRiesgo || downtonScore > 0
      ? 'partial'
      : 'empty';

  const acsmComplete = !!data?.acsmRiesgo;
  const acsmCardState = acsmComplete
    ? 'complete'
    : data?.acsmRiesgo || acsmCount > 0
      ? 'partial'
      : 'empty';

  const btFlagsCount = [
    coerceBool(data?.btFactor1),
    coerceBool(data?.btFactor2),
    coerceBool(data?.btFactor3),
  ].filter(Boolean).length;
  const btState: 'empty' | 'partial' | 'complete' = data?.riesgoFinal
    ? 'complete'
    : btFlagsCount > 0
      ? 'partial'
      : 'empty';

  const finalColorBadge =
    riesgoFinal === 'ALTO' ? '#ef4444' : riesgoFinal === 'MEDIO' ? '#fbbf24' : '#34d399';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* ============ Card 3.1: Downton ============ */}
      <Card
        icon={<Activity size={16} />}
        title="Índice Downton"
        subtitle={
          <span>
            <span
              className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold mr-2 ${
                downtonCat === 'Riesgo alto'
                  ? 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]'
                  : downtonCat === 'Riesgo intermedio'
                    ? 'bg-[rgba(251,191,36,0.15)] text-[#fbbf24]'
                    : 'bg-[rgba(52,211,153,0.15)] text-[#34d399]'
              }`}
            >
              {downtonCat}
            </span>
            <span className="text-[#6b7882]">Score: {downtonScore}/4</span>
          </span>
        }
        state={downtonCardState}
        completionPct={Math.min(100, downtonScore * 25)}
        onEdit={() => setOpenModal('downton')}
      />

      {/* ============ Card 3.2: ACSM ============ */}
      <Card
        icon={<HeartPulse size={16} />}
        title="Riesgo Cardiovascular ACSM"
        subtitle={
          <span>
            <span
              className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold mr-2"
              style={{
                background: `${acsmColor}26`,
                color: acsmColor,
              }}
            >
              {acsmCat}
            </span>
            <span className="text-[#6b7882]">{acsmCount}/12 factores</span>
          </span>
        }
        state={acsmCardState}
        completionPct={Math.round((acsmCount / 12) * 100)}
        onEdit={() => setOpenModal('acsm')}
      />

      {/* ============ Card 3.3: Riesgo Bodytech ============ */}
      <Card
        icon={<Shield size={16} />}
        title="Riesgo Bodytech"
        subtitle={
          <span>
            <span
              className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold mr-2"
              style={{
                background: `${finalColorBadge}26`,
                color: finalColorBadge,
              }}
            >
              {riesgoFinal === 'ALTO' ? '⚠️ ALTO' : riesgoFinal === 'MEDIO' ? 'MEDIO' : 'BAJO'}
            </span>
            <span className="text-[#6b7882]">
              Resumen final · {btFlagsCount}/3 factores BT
            </span>
          </span>
        }
        state={btState}
        span2
        completionPct={btState === 'complete' ? 100 : Math.round((btFlagsCount / 3) * 100)}
        onEdit={() => setOpenModal('bodytech')}
      />

      {/* ============ Modal Downton ============ */}
      <Modal
        open={openModal === 'downton'}
        onClose={() => setOpenModal(null)}
        crumb="Riesgo · Downton"
        title="Índice Downton"
        icon={<Activity size={18} />}
        isMaxed={isMaxed}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-dashed border-[#324049] pb-3">
            <span className="text-[13.5px] text-[#e9edef]">Antecedente de caídas</span>
            <PillToggleField
              historiaId={historiaId}
              field="downton_caidas"
              initialValue={data?.downtonCaidas}
              onSaved={onPatchLocal}
              inline
            />
          </div>
          <div className="flex items-center justify-between border-b border-dashed border-[#324049] pb-3">
            <span className="text-[13.5px] text-[#e9edef]">Estado mental confuso/desorientado</span>
            <PillToggleField
              historiaId={historiaId}
              field="downton_estado_mental"
              initialValue={data?.downtonEstadoMental}
              onSaved={onPatchLocal}
              inline
            />
          </div>

          {/* Medicamentos */}
          <div className="border-b border-dashed border-[#324049] pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] text-[#e9edef]">Toma medicamentos</span>
              <PillToggleField
                historiaId={historiaId}
                field="downton_medicamentos"
                initialValue={data?.downtonMedicamentos}
                onSaved={onPatchLocal}
                inline
              />
            </div>
            <div className={`reveal-grid ${coerceBool(data?.downtonMedicamentos) ? 'is-open' : ''}`}>
              <div>
                <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                    <span className="text-[12px] text-[#a4b1b9]">Antiparkinsonianos</span>
                    <PillToggleField
                      historiaId={historiaId}
                      field="downton_med_antiparkinson"
                      initialValue={data?.downtonMedAntiparkinson}
                      onSaved={onPatchLocal}
                      inline
                    />
                  </div>
                  <div className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                    <span className="text-[12px] text-[#a4b1b9]">Antidepresivos</span>
                    <PillToggleField
                      historiaId={historiaId}
                      field="downton_med_antidepresivos"
                      initialValue={data?.downtonMedAntidepresivos}
                      onSaved={onPatchLocal}
                      inline
                    />
                  </div>
                  <div className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                    <span className="text-[12px] text-[#a4b1b9]">Otros</span>
                    <PillToggleField
                      historiaId={historiaId}
                      field="downton_med_otros"
                      initialValue={data?.downtonMedOtros}
                      onSaved={onPatchLocal}
                      inline
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Déficits sensoriales */}
          <div className="border-b border-dashed border-[#324049] pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] text-[#e9edef]">Déficits sensoriales</span>
              <PillToggleField
                historiaId={historiaId}
                field="downton_deficits_sensoriales"
                initialValue={data?.downtonDeficitsSensoriales}
                onSaved={onPatchLocal}
                inline
              />
            </div>
            <div
              className={`reveal-grid ${coerceBool(data?.downtonDeficitsSensoriales) ? 'is-open' : ''}`}
            >
              <div>
                <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                    <span className="text-[12px] text-[#a4b1b9]">Visual</span>
                    <PillToggleField
                      historiaId={historiaId}
                      field="downton_visual"
                      initialValue={data?.downtonVisual}
                      onSaved={onPatchLocal}
                      inline
                    />
                  </div>
                  <div className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                    <span className="text-[12px] text-[#a4b1b9]">Auditivo</span>
                    <PillToggleField
                      historiaId={historiaId}
                      field="downton_auditivo"
                      initialValue={data?.downtonAuditivo}
                      onSaved={onPatchLocal}
                      inline
                    />
                  </div>
                  <div className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                    <span className="text-[12px] text-[#a4b1b9]">Extremidades</span>
                    <PillToggleField
                      historiaId={historiaId}
                      field="downton_def_extremidades"
                      initialValue={data?.downtonDefExtremidades}
                      onSaved={onPatchLocal}
                      inline
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Calculated label="Riesgo Downton" value={downtonCat} unit={`Score ${downtonScore}/4`} />
            <CalcAutosave
              historiaId={historiaId}
              field="downton_riesgo"
              value={downtonCat}
              onPatchLocal={onPatchLocal}
            />
          </div>
        </div>
      </Modal>

      {/* ============ Modal ACSM ============ */}
      <Modal
        open={openModal === 'acsm'}
        onClose={() => setOpenModal(null)}
        crumb="Riesgo · ACSM"
        title="Riesgo Cardiovascular ACSM"
        icon={<HeartPulse size={18} />}
        isMaxed={isMaxed}
      >
        <div className="flex flex-col gap-4">
          {/* Header reactivo */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[#324049] bg-[#1a2530]">
            <div
              className="px-3 py-1.5 rounded-lg text-[13px] font-bold tracking-wider"
              style={{
                background: `${acsmColor}26`,
                color: acsmColor,
                border: `1px solid ${acsmColor}55`,
              }}
            >
              RIESGO {acsmCat}
            </div>
            <BumpCounter count={acsmCount} total={12} />
          </div>

          {/* Grid 2-col con 12 toggles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { label: 'Sedentarismo', field: 'acsm_sedentarismo', value: data?.acsmSedentarismo },
              { label: 'Tabaquismo', field: 'acsm_tabaquismo', value: data?.acsmTabaquismo },
              { label: 'Hipertensión', field: 'acsm_hipertension', value: data?.acsmHipertension },
              { label: 'Dislipidemia', field: 'acsm_dislipidemia', value: data?.acsmDislipidemia },
              { label: 'Obesidad', field: 'acsm_obesidad', value: data?.acsmObesidad },
              { label: 'Edad (criterio)', field: 'acsm_edad', value: data?.acsmEdad },
              {
                label: 'Antecedente familiar cardíaco',
                field: 'acsm_familiar_cardiaco',
                value: data?.acsmFamiliarCardiaco,
              },
              { label: 'Género (criterio)', field: 'acsm_genero', value: data?.acsmGenero },
              { label: 'Diabetes', field: 'acsm_diabetes', value: data?.acsmDiabetes },
              { label: 'Enfermedad pulmonar', field: 'acsm_enf_pulmonar', value: data?.acsmEnfPulmonar },
              {
                label: 'Enfermedad cardiovascular',
                field: 'acsm_enf_cardiovascular',
                value: data?.acsmEnfCardiovascular,
              },
              { label: 'Enfermedad renal', field: 'acsm_enf_renal', value: data?.acsmEnfRenal },
            ].map((row) => (
              <AcsmRow
                key={row.field}
                label={row.label}
                field={row.field}
                value={row.value}
                historiaId={historiaId}
                onPatchLocal={onPatchLocal}
              />
            ))}
          </div>

          <CalcAutosave
            historiaId={historiaId}
            field="acsm_riesgo"
            value={acsmCat}
            onPatchLocal={onPatchLocal}
          />
        </div>
      </Modal>

      {/* ============ Modal Bodytech ============ */}
      <Modal
        open={openModal === 'bodytech'}
        onClose={() => setOpenModal(null)}
        crumb="Riesgo · Bodytech"
        title="Riesgo Bodytech"
        icon={<Shield size={18} />}
        isMaxed={isMaxed}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-dashed border-[#324049] pb-3">
              <span className="text-[13.5px] text-[#e9edef]">Pérdida de conocimiento</span>
              <PillToggleField
                historiaId={historiaId}
                field="bt_factor_1"
                initialValue={data?.btFactor1}
                onSaved={onPatchLocal}
                inline
              />
            </div>
            <div className="flex items-center justify-between border-b border-dashed border-[#324049] pb-3">
              <span className="text-[13.5px] text-[#e9edef]">Razón médica para no ejercitarse</span>
              <PillToggleField
                historiaId={historiaId}
                field="bt_factor_2"
                initialValue={data?.btFactor2}
                onSaved={onPatchLocal}
                inline
              />
            </div>
            <div className="flex items-center justify-between border-b border-dashed border-[#324049] pb-3">
              <span className="text-[13.5px] text-[#e9edef]">
                Dolor osteomuscular que empeora con ejercicio
              </span>
              <PillToggleField
                historiaId={historiaId}
                field="bt_factor_3"
                initialValue={data?.btFactor3}
                onSaved={onPatchLocal}
                inline
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
            <Calculated
              label="Calificación Riesgo Cardiovascular"
              value={data?.acsmRiesgo || acsmCat || '—'}
            />
            <Calculated
              label="Procedimiento quirúrgico < 3 meses"
              value={
                coerceBool(data?.antQuirurgicoFlag) && data?.antQuirurgicoTiempo === 'Menor a 3 meses'
                  ? 'Sí'
                  : 'No'
              }
            />
            <Calculated label="Embarazo" value={coerceBool(data?.embarazoActual) ? 'Sí' : 'No'} />
            <Calculated label="Riesgo final" value={riesgoFinal} />
          </div>

          <CalcAutosave
            historiaId={historiaId}
            field="riesgo_final"
            value={riesgoFinal}
            onPatchLocal={onPatchLocal}
          />
        </div>
      </Modal>
    </div>
  );
}

// ============ ACSM toggle row con flash al activar ============
interface AcsmRowProps {
  label: string;
  field: string;
  value: unknown;
  historiaId: string | undefined;
  onPatchLocal: (field: string, value: unknown) => void;
}

function AcsmRow({ label, field, value, historiaId, onPatchLocal }: AcsmRowProps) {
  const [flash, setFlash] = useState(false);
  const lastVal = useRef<boolean>(coerceBool(value));
  const cur = coerceBool(value);

  useEffect(() => {
    if (!lastVal.current && cur) {
      // false -> true: flash
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 320);
      lastVal.current = cur;
      return () => clearTimeout(t);
    }
    lastVal.current = cur;
  }, [cur]);

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[#324049] bg-[#1a2530] ${
        flash ? 'is-flashing' : ''
      }`}
    >
      <span className="text-[13px] text-[#e9edef]">{label}</span>
      <PillToggleField
        historiaId={historiaId}
        field={field}
        initialValue={value}
        onSaved={onPatchLocal}
        inline
      />
    </div>
  );
}
