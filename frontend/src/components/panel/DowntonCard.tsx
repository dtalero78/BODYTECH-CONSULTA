import { useState } from 'react';
import { Activity } from 'lucide-react';
import { Card } from './Card';
import { Modal } from './Modal';
import { Calculated } from './Calculated';
import { PillToggleField } from './fields';
import { useFieldAutoSave } from './hooks/useFieldAutoSave';
import type { MedicalHistoryFull } from './types';

/**
 * Índice Downton — riesgo de caídas.
 *
 * Vive aquí (y no dentro de `RiesgoTab`) porque lo usan dos paneles: el de
 * consulta médica y el Médico Corporativo. Al ser un único componente, la escala
 * y su puntaje no se pueden desincronizar entre ambos.
 */

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
}

export function downtonCategoria(score: number): string {
  if (score >= 4) return 'Riesgo alto';
  if (score >= 2) return 'Riesgo intermedio';
  return 'Bajo riesgo';
}

export function computeDowntonScore(d: MedicalHistoryFull | null): number {
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

function CalcAutosave({
  historiaId,
  field,
  value,
  serverValue,
  onPatchLocal,
}: {
  historiaId: string | undefined;
  field: string;
  value: string | null;
  serverValue?: unknown;
  onPatchLocal: (field: string, value: unknown) => void;
}) {
  useFieldAutoSave({ historiaId, field, value, serverValue, onSaved: onPatchLocal });
  return null;
}

interface DowntonCardProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
  /** El corporativo es standalone y sin videollamada. */
  showEyePill?: boolean;
  modalSize?: 'default' | 'wide';
}

export function DowntonCard({
  historiaId,
  data,
  isMaxed,
  onPatchLocal,
  showEyePill = true,
  modalSize = 'default',
}: DowntonCardProps) {
  const [open, setOpen] = useState(false);

  const score = computeDowntonScore(data);
  const cat = downtonCategoria(score);

  const isSet = (v: unknown) => v !== null && v !== undefined;
  const mainFilled = [
    data?.downtonCaidas,
    data?.downtonEstadoMental,
    data?.downtonMedicamentos,
    data?.downtonDeficitsSensoriales,
  ].filter(isSet).length;
  const pct = Math.round((mainFilled / 4) * 100);
  const state = mainFilled === 4 ? 'complete' : mainFilled > 0 ? 'partial' : 'empty';

  const subCls =
    cat === 'Riesgo alto'
      ? 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]'
      : cat === 'Riesgo intermedio'
        ? 'bg-[rgba(251,191,36,0.15)] text-[#fbbf24]'
        : 'bg-[rgba(52,211,153,0.15)] text-[#34d399]';

  return (
    <>
      <Card
        icon={<Activity size={16} />}
        title="Índice Downton"
        subtitle={
          <span>
            <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold mr-2 ${subCls}`}>
              {cat}
            </span>
            <span className="text-[#6b7882]">Score: {score}/4</span>
          </span>
        }
        state={state}
        completionPct={pct}
        onEdit={() => setOpen(true)}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        crumb="Riesgo · Downton"
        title="Índice Downton"
        icon={<Activity size={18} />}
        isMaxed={isMaxed}
        showEyePill={showEyePill}
        size={modalSize}
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
                  {[
                    { label: 'Antiparkinsonianos', field: 'downton_med_antiparkinson', value: data?.downtonMedAntiparkinson },
                    { label: 'Antidepresivos', field: 'downton_med_antidepresivos', value: data?.downtonMedAntidepresivos },
                    { label: 'Otros', field: 'downton_med_otros', value: data?.downtonMedOtros },
                  ].map((r) => (
                    <div key={r.field} className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                      <span className="text-[12px] text-[#a4b1b9]">{r.label}</span>
                      <PillToggleField
                        historiaId={historiaId}
                        field={r.field}
                        initialValue={r.value}
                        onSaved={onPatchLocal}
                        inline
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

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
            <div className={`reveal-grid ${coerceBool(data?.downtonDeficitsSensoriales) ? 'is-open' : ''}`}>
              <div>
                <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Visual', field: 'downton_visual', value: data?.downtonVisual },
                    { label: 'Auditivo', field: 'downton_auditivo', value: data?.downtonAuditivo },
                    { label: 'Extremidades', field: 'downton_def_extremidades', value: data?.downtonDefExtremidades },
                  ].map((r) => (
                    <div key={r.field} className="flex items-center justify-between bg-[#1a2530] rounded-xl px-3 py-2 border border-[#324049]">
                      <span className="text-[12px] text-[#a4b1b9]">{r.label}</span>
                      <PillToggleField
                        historiaId={historiaId}
                        field={r.field}
                        initialValue={r.value}
                        onSaved={onPatchLocal}
                        inline
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Calculated label="Riesgo Downton" value={cat} unit={`Score ${score}/4`} />
            <CalcAutosave
              historiaId={historiaId}
              field="downton_riesgo"
              value={cat}
              serverValue={data?.downtonRiesgo ?? null}
              onPatchLocal={onPatchLocal}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
