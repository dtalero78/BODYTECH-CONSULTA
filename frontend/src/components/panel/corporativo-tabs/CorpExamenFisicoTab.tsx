import { useState } from 'react';
import { Activity, Scale, HeartPulse, Stethoscope, Gauge, Hand } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { TextField, TextareaField } from '../fields';
import { useFieldAutoSave } from '../hooks/useFieldAutoSave';
import type { MedicalHistoryFull } from '../types';

interface CorpExamenFisicoTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'signos' | 'fc' | 'sistemas' | 'ruffier' | 'handgrip' | 'obs' | null;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? null : n;
}

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Persiste un campo calculado sin renderizar nada (mismo patrón que ExamenFisicoTab/RiesgoTab).
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

export function CorpExamenFisicoTab({ historiaId, data, onPatchLocal }: CorpExamenFisicoTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  // ---- Composición corporal: IMC calculado (peso kg / talla m²) ----
  const peso = toNum(data?.mcPeso);
  const talla = toNum(data?.mcTalla);
  let imcCalc: number | null = null;
  if (peso !== null && talla !== null && talla > 0) {
    imcCalc = round1(peso / (talla * talla));
  }

  // ---- Parámetros de FC ----
  const frecCard = toNum(data?.mcFrecCard); // FC en reposo
  const fcPico = toNum(data?.mcFcPicoPruebaEsfuerzo);
  let fcReservaCalc: number | null = null;
  if (frecCard !== null && fcPico !== null) {
    fcReservaCalc = fcPico - frecCard;
  }
  const fcReservaPct = (pct: number): number | null =>
    frecCard !== null && fcReservaCalc !== null ? Math.round(frecCard + pct * fcReservaCalc) : null;

  const edad = typeof data?.edad === 'number' && !isNaN(data.edad) ? data.edad : null;
  const tanakaCalc = edad !== null ? Math.round(208 - edad * 0.7) : null;
  const tanakaPct = (pct: number): number | null =>
    tanakaCalc !== null ? round1(tanakaCalc * pct) : null;

  // ---- Ruffier (fórmula clásica — validar bandas con el equipo médico) ----
  const fc1 = toNum(data?.mcRuffierFc1);
  const fc2 = toNum(data?.mcRuffierFc2);
  const fc3 = toNum(data?.mcRuffierFc3);
  let ruffierResultado: number | null = null;
  let ruffierCalificacion: string | null = null;
  if (fc1 !== null && fc2 !== null && fc3 !== null) {
    ruffierResultado = round1((fc1 + fc2 + fc3 - 200) / 10);
    if (ruffierResultado <= 0) ruffierCalificacion = 'Excelente';
    else if (ruffierResultado <= 5) ruffierCalificacion = 'Bueno';
    else if (ruffierResultado <= 10) ruffierCalificacion = 'Medio';
    else if (ruffierResultado <= 15) ruffierCalificacion = 'Insuficiente';
    else ruffierCalificacion = 'Malo';
  }

  // ---- Handgrip ----
  const der1 = toNum(data?.mcHandgripDer1);
  const der2 = toNum(data?.mcHandgripDer2);
  const izq1 = toNum(data?.mcHandgripIzq1);
  const izq2 = toNum(data?.mcHandgripIzq2);
  const promDer = der1 !== null && der2 !== null ? round1((der1 + der2) / 2) : der1 ?? der2;
  const promIzq = izq1 !== null && izq2 !== null ? round1((izq1 + izq2) / 2) : izq1 ?? izq2;
  let asimetriaMm: number | null = null;
  let asimetriaPct: number | null = null;
  if (promDer !== null && promDer !== undefined && promIzq !== null && promIzq !== undefined) {
    asimetriaMm = round1(Math.abs(promDer - promIzq));
    const max = Math.max(promDer, promIzq);
    asimetriaPct = max > 0 ? round1((asimetriaMm / max) * 100) : null;
  }

  // ---- Card states ----
  const signosVals = [data?.mcFrecCard, data?.mcFrecResp, data?.mcSato2, data?.tas, data?.tad, data?.mcPerimetroAbdominal, data?.mcTalla, data?.mcPeso, data?.mcPctGrasa, data?.mcPctMusculo, data?.mcGrasaVisceral, data?.mcTmb];
  const signosFilled = signosVals.filter(isFilled).length;

  const fcVals = [data?.mcFcPicoPruebaEsfuerzo];
  const fcFilled = fcVals.filter(isFilled).length;

  const sistemasVals = [
    data?.mcRsCabeza, data?.mcRsParesCraneales, data?.mcRsFuerzaMmss, data?.mcRsFuerzaMmii,
    data?.mcRsCara, data?.mcRsAbdPelvis, data?.mcRsPushUps, data?.mcRsCuello, data?.mcRsGenitales,
    data?.mcRsAbdominales, data?.mcRsTorax, data?.mcRsPiel, data?.mcRsAbdomen, data?.mcRsPulsos,
    data?.mcRsCorazon, data?.mcRsRespiratorio, data?.mcRsOsteomuscular,
  ];
  const sistemasFilled = sistemasVals.filter(isFilled).length;

  const ruffierVals = [data?.mcRuffierFc1, data?.mcRuffierFc2, data?.mcRuffierFc3];
  const ruffierFilled = ruffierVals.filter(isFilled).length;

  const handgripVals = [data?.mcHandgripDer1, data?.mcHandgripIzq1, data?.mcHandgripDer2, data?.mcHandgripIzq2];
  const handgripFilled = handgripVals.filter(isFilled).length;

  const obsVals = [data?.mcIcc, data?.mcWells, data?.mcExamenObservaciones];
  const obsFilled = obsVals.filter(isFilled).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<Scale size={16} />}
        title="Signos y composición corporal"
        subtitle={signosFilled === 0 ? 'Sin medidas registradas' : `${signosFilled} de ${signosVals.length} campos completos`}
        state={signosFilled === 0 ? 'empty' : signosFilled === signosVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((signosFilled / signosVals.length) * 100)}
        onEdit={() => setOpenModal('signos')}
      />
      <Card
        icon={<HeartPulse size={16} />}
        title="Parámetros de frecuencia cardíaca"
        subtitle={
          tanakaCalc !== null
            ? `Tanaka ${tanakaCalc} lpm${fcFilled ? ` · FC pico ${data?.mcFcPicoPruebaEsfuerzo}` : ''}`
            : 'Requiere edad del afiliado'
        }
        state={fcFilled === 0 ? 'empty' : 'complete'}
        completionPct={fcFilled === 0 ? 0 : 100}
        onEdit={() => setOpenModal('fc')}
      />
      <Card
        icon={<Stethoscope size={16} />}
        title="Revisión por sistemas"
        subtitle={sistemasFilled === 0 ? 'Sin hallazgos registrados' : `${sistemasFilled} de ${sistemasVals.length} campos completos`}
        state={sistemasFilled === 0 ? 'empty' : sistemasFilled === sistemasVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((sistemasFilled / sistemasVals.length) * 100)}
        onEdit={() => setOpenModal('sistemas')}
      />
      <Card
        icon={<Gauge size={16} />}
        title="Test de Ruffier"
        subtitle={
          ruffierCalificacion
            ? `${ruffierCalificacion} · IR ${ruffierResultado}`
            : ruffierFilled === 0
              ? 'Sin FC1/FC2/FC3 registradas'
              : `${ruffierFilled} de ${ruffierVals.length} campos completos`
        }
        state={ruffierFilled === 0 ? 'empty' : ruffierFilled === ruffierVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((ruffierFilled / ruffierVals.length) * 100)}
        onEdit={() => setOpenModal('ruffier')}
      />
      <Card
        icon={<Hand size={16} />}
        title="Handgrip"
        subtitle={handgripFilled === 0 ? 'Sin mediciones registradas' : `${handgripFilled} de ${handgripVals.length} intentos registrados`}
        state={handgripFilled === 0 ? 'empty' : handgripFilled === handgripVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((handgripFilled / handgripVals.length) * 100)}
        onEdit={() => setOpenModal('handgrip')}
      />
      <Card
        icon={<Activity size={16} />}
        title="Observaciones del examen"
        subtitle={obsFilled === 0 ? 'Sin observaciones' : `${obsFilled} de ${obsVals.length} campos completos`}
        state={obsFilled === 0 ? 'empty' : obsFilled === obsVals.length ? 'complete' : 'partial'}
        completionPct={Math.round((obsFilled / obsVals.length) * 100)}
        onEdit={() => setOpenModal('obs')}
      />

      {/* ============ Signos y composición corporal ============ */}
      <Modal
        open={openModal === 'signos'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Signos y composición corporal"
        title="Signos y composición corporal"
        icon={<Scale size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">Signos vitales</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
              <TextField historiaId={historiaId} field="tas" initialValue={data?.tas} onSaved={onPatchLocal} label="TAS (mmHg)" type="number" min={60} max={250} />
              <TextField historiaId={historiaId} field="tad" initialValue={data?.tad} onSaved={onPatchLocal} label="TAD (mmHg)" type="number" min={40} max={180} />
              <TextField historiaId={historiaId} field="mc_frec_card" initialValue={data?.mcFrecCard} onSaved={onPatchLocal} label="Frecuencia cardiaca (lpm)" type="number" min={30} max={220} />
              <TextField historiaId={historiaId} field="mc_frec_resp" initialValue={data?.mcFrecResp} onSaved={onPatchLocal} label="Frecuencia respiratoria (rpm)" type="number" min={5} max={60} />
              <TextField historiaId={historiaId} field="mc_sato2" initialValue={data?.mcSato2} onSaved={onPatchLocal} label="SatO2 (%)" type="number" min={50} max={100} />
              <TextField historiaId={historiaId} field="mc_perimetro_abdominal" initialValue={data?.mcPerimetroAbdominal} onSaved={onPatchLocal} label="Perímetro abdominal (cm)" type="number" min={40} max={200} />
              <TextField historiaId={historiaId} field="mc_talla" initialValue={data?.mcTalla} onSaved={onPatchLocal} label="Talla (m)" type="number" min={1} max={2.5} />
            </div>
          </div>
          <div className="pt-4 border-t border-dashed border-[#324049]">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">Composición corporal</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
              <TextField historiaId={historiaId} field="mc_peso" initialValue={data?.mcPeso} onSaved={onPatchLocal} label="Peso (kg)" type="number" min={20} max={300} />
              <TextField historiaId={historiaId} field="mc_pct_grasa" initialValue={data?.mcPctGrasa} onSaved={onPatchLocal} label="% Grasa" type="number" min={0} max={80} />
              <TextField historiaId={historiaId} field="mc_pct_musculo" initialValue={data?.mcPctMusculo} onSaved={onPatchLocal} label="% Músculo" type="number" min={0} max={100} />
              <TextField historiaId={historiaId} field="mc_grasa_visceral" initialValue={data?.mcGrasaVisceral} onSaved={onPatchLocal} label="Grasa visceral" type="number" min={0} max={60} />
              <Calculated label="IMC" value={imcCalc ?? '—'} />
              <TextField historiaId={historiaId} field="mc_tmb" initialValue={data?.mcTmb} onSaved={onPatchLocal} label="TMB (Kcal)" type="number" placeholder="Entrada manual" min={0} />
            </div>
            <CalcAutosave historiaId={historiaId} field="mc_imc" value={imcCalc} serverValue={data?.mcImc ?? null} onPatchLocal={onPatchLocal} />
          </div>
        </div>
      </Modal>

      {/* ============ Parámetros de FC ============ */}
      <Modal
        open={openModal === 'fc'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Parámetros de frecuencia cardíaca"
        title="Parámetros de frecuencia cardíaca"
        icon={<HeartPulse size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              FC de reserva (Karvonen — requiere FC pico de prueba de esfuerzo)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <TextField
                historiaId={historiaId}
                field="mc_fc_pico_prueba_esfuerzo"
                initialValue={data?.mcFcPicoPruebaEsfuerzo}
                onSaved={onPatchLocal}
                label="FC pico (prueba de esfuerzo)"
                type="number"
                min={60}
                max={230}
              />
              <Calculated label="FC de reserva" value={fcReservaCalc ?? '—'} unit="lpm" />
              <Calculated label="80% FCR" value={fcReservaPct(0.8) ?? '—'} unit="lpm" />
              <Calculated label="75% FCR" value={fcReservaPct(0.75) ?? '—'} unit="lpm" />
              <Calculated label="70% FCR" value={fcReservaPct(0.7) ?? '—'} unit="lpm" />
              <Calculated label="60% FCR" value={fcReservaPct(0.6) ?? '—'} unit="lpm" />
            </div>
            <CalcAutosave historiaId={historiaId} field="mc_fc_reserva" value={fcReservaCalc} serverValue={data?.mcFcReserva ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_reserva_80" value={fcReservaPct(0.8)} serverValue={data?.mcFcReserva80 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_reserva_75" value={fcReservaPct(0.75)} serverValue={data?.mcFcReserva75 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_reserva_70" value={fcReservaPct(0.7)} serverValue={data?.mcFcReserva70 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_reserva_60" value={fcReservaPct(0.6)} serverValue={data?.mcFcReserva60 ?? null} onPatchLocal={onPatchLocal} />
          </div>

          <div className="pt-4 border-t border-dashed border-[#324049]">
            <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase mb-3">
              FC predicha (Tanaka: 208 − 0.7 × edad)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <Calculated label="FC predicha (Tanaka)" value={tanakaCalc ?? '—'} unit="lpm" />
              <Calculated label="90% FC pico predicha" value={tanakaPct(0.9) ?? '—'} unit="lpm" />
              <Calculated label="80% FC pico predicha" value={tanakaPct(0.8) ?? '—'} unit="lpm" />
              <Calculated label="75% FC pico predicha" value={tanakaPct(0.75) ?? '—'} unit="lpm" />
              <Calculated label="70% FC pico predicha" value={tanakaPct(0.7) ?? '—'} unit="lpm" />
              <Calculated label="60% FC pico predicha" value={tanakaPct(0.6) ?? '—'} unit="lpm" />
            </div>
            <CalcAutosave historiaId={historiaId} field="mc_fc_tanaka" value={tanakaCalc} serverValue={data?.mcFcTanaka ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_pico_predicha_90" value={tanakaPct(0.9)} serverValue={data?.mcFcPicoPredicha90 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_pico_predicha_80" value={tanakaPct(0.8)} serverValue={data?.mcFcPicoPredicha80 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_pico_predicha_75" value={tanakaPct(0.75)} serverValue={data?.mcFcPicoPredicha75 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_pico_predicha_70" value={tanakaPct(0.7)} serverValue={data?.mcFcPicoPredicha70 ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_fc_pico_predicha_60" value={tanakaPct(0.6)} serverValue={data?.mcFcPicoPredicha60 ?? null} onPatchLocal={onPatchLocal} />
          </div>
        </div>
      </Modal>

      {/* ============ Revisión por sistemas ============ */}
      <Modal
        open={openModal === 'sistemas'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Revisión por sistemas"
        title="Revisión por sistemas"
        icon={<Stethoscope size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField historiaId={historiaId} field="mc_rs_cabeza" initialValue={data?.mcRsCabeza} onSaved={onPatchLocal} label="Cabeza" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_pares_craneales" initialValue={data?.mcRsParesCraneales} onSaved={onPatchLocal} label="Pares craneales" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_cara" initialValue={data?.mcRsCara} onSaved={onPatchLocal} label="Cara" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_abd_pelvis" initialValue={data?.mcRsAbdPelvis} onSaved={onPatchLocal} label="ABD y pelvis" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_cuello" initialValue={data?.mcRsCuello} onSaved={onPatchLocal} label="Cuello" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_genitales" initialValue={data?.mcRsGenitales} onSaved={onPatchLocal} label="Genitales" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_torax" initialValue={data?.mcRsTorax} onSaved={onPatchLocal} label="Tórax" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_piel" initialValue={data?.mcRsPiel} onSaved={onPatchLocal} label="Piel" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_abdomen" initialValue={data?.mcRsAbdomen} onSaved={onPatchLocal} label="Abdomen" placeholder="normal" />
          <TextField historiaId={historiaId} field="mc_rs_pulsos" initialValue={data?.mcRsPulsos} onSaved={onPatchLocal} label="Pulsos" placeholder="Simétricos, de adecuada amplitud" />
          <TextField historiaId={historiaId} field="mc_rs_fuerza_mmss" initialValue={data?.mcRsFuerzaMmss} onSaved={onPatchLocal} label="Fuerza muscular MMSS" placeholder="5 de 5" />
          <TextField historiaId={historiaId} field="mc_rs_fuerza_mmii" initialValue={data?.mcRsFuerzaMmii} onSaved={onPatchLocal} label="Fuerza muscular MMII" placeholder="5 de 5" />
          <TextField historiaId={historiaId} field="mc_rs_push_ups" initialValue={data?.mcRsPushUps} onSaved={onPatchLocal} label="Push ups (a la fatiga)" type="number" min={0} max={200} />
          <TextField historiaId={historiaId} field="mc_rs_abdominales" initialValue={data?.mcRsAbdominales} onSaved={onPatchLocal} label="Abdominales (a la fatiga)" type="number" min={0} max={200} />
          <div className="md:col-span-2">
            <TextareaField historiaId={historiaId} field="mc_rs_corazon" initialValue={data?.mcRsCorazon} onSaved={onPatchLocal} label="Corazón" rows={2} placeholder="RsCs rítmicos, sin soplos" />
          </div>
          <div className="md:col-span-2">
            <TextareaField historiaId={historiaId} field="mc_rs_respiratorio" initialValue={data?.mcRsRespiratorio} onSaved={onPatchLocal} label="Respiratorio" rows={2} />
          </div>
          <div className="md:col-span-2">
            <TextareaField historiaId={historiaId} field="mc_rs_osteomuscular" initialValue={data?.mcRsOsteomuscular} onSaved={onPatchLocal} label="Osteomuscular" rows={3} />
          </div>
        </div>
      </Modal>

      {/* ============ Ruffier ============ */}
      <Modal
        open={openModal === 'ruffier'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Test de Ruffier"
        title="Test de Ruffier"
        icon={<Gauge size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="flex flex-col gap-4">
          <div className="px-4 py-2.5 rounded-xl border border-[#fbbf24]/30 bg-[rgba(251,191,36,0.08)] text-[#fbbf24] text-[12px]">
            Cálculo estimado con la fórmula clásica de Ruffier — validar la fórmula y las bandas de calificación con el equipo médico antes de usarlas clínicamente.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <TextField historiaId={historiaId} field="mc_ruffier_fc1" initialValue={data?.mcRuffierFc1} onSaved={onPatchLocal} label="FC1 (reposo)" type="number" min={30} max={220} />
            <TextField historiaId={historiaId} field="mc_ruffier_fc2" initialValue={data?.mcRuffierFc2} onSaved={onPatchLocal} label="FC2 (post-esfuerzo)" type="number" min={30} max={220} />
            <TextField historiaId={historiaId} field="mc_ruffier_fc3" initialValue={data?.mcRuffierFc3} onSaved={onPatchLocal} label="FC3 (recuperación)" type="number" min={30} max={220} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <Calculated label="Resultado (índice de Ruffier)" value={ruffierResultado ?? '—'} />
            <Calculated label="Calificación" value={ruffierCalificacion ?? '—'} />
          </div>
          <CalcAutosave historiaId={historiaId} field="mc_ruffier_resultado" value={ruffierResultado} serverValue={data?.mcRuffierResultado ?? null} onPatchLocal={onPatchLocal} />
          <CalcAutosave historiaId={historiaId} field="mc_ruffier_calificacion" value={ruffierCalificacion} serverValue={data?.mcRuffierCalificacion ?? null} onPatchLocal={onPatchLocal} />
        </div>
      </Modal>

      {/* ============ Handgrip ============ */}
      <Modal
        open={openModal === 'handgrip'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Handgrip"
        title="Handgrip (dinamometría)"
        icon={<Hand size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <TextField historiaId={historiaId} field="mc_handgrip_der_1" initialValue={data?.mcHandgripDer1} onSaved={onPatchLocal} label="Mano derecha · 1er intento" type="number" min={0} max={100} />
            <TextField historiaId={historiaId} field="mc_handgrip_izq_1" initialValue={data?.mcHandgripIzq1} onSaved={onPatchLocal} label="Mano izquierda · 1er intento" type="number" min={0} max={100} />
            <TextField historiaId={historiaId} field="mc_handgrip_der_2" initialValue={data?.mcHandgripDer2} onSaved={onPatchLocal} label="Mano derecha · 2do intento" type="number" min={0} max={100} />
            <TextField historiaId={historiaId} field="mc_handgrip_izq_2" initialValue={data?.mcHandgripIzq2} onSaved={onPatchLocal} label="Mano izquierda · 2do intento" type="number" min={0} max={100} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-3 border-t border-dashed border-[#324049]">
            <Calculated label="Promedio mano derecha" value={promDer ?? '—'} />
            <Calculated label="Promedio mano izquierda" value={promIzq ?? '—'} />
            <Calculated label="Asimetría" value={asimetriaMm ?? '—'} />
            <Calculated label="% Asimetría" value={asimetriaPct ?? '—'} unit="%" />
          </div>
          <CalcAutosave historiaId={historiaId} field="mc_handgrip_promedio_der" value={promDer ?? null} serverValue={data?.mcHandgripPromedioDer ?? null} onPatchLocal={onPatchLocal} />
          <CalcAutosave historiaId={historiaId} field="mc_handgrip_promedio_izq" value={promIzq ?? null} serverValue={data?.mcHandgripPromedioIzq ?? null} onPatchLocal={onPatchLocal} />
          <CalcAutosave historiaId={historiaId} field="mc_handgrip_asimetria_mm" value={asimetriaMm} serverValue={data?.mcHandgripAsimetriaMm ?? null} onPatchLocal={onPatchLocal} />
          <CalcAutosave historiaId={historiaId} field="mc_handgrip_asimetria_pct" value={asimetriaPct} serverValue={data?.mcHandgripAsimetriaPct ?? null} onPatchLocal={onPatchLocal} />
        </div>
      </Modal>

      {/* ============ Observaciones ============ */}
      <Modal
        open={openModal === 'obs'}
        onClose={() => setOpenModal(null)}
        crumb="Examen Físico · Observaciones"
        title="Observaciones del examen"
        icon={<Activity size={18} />}
        isMaxed
        showEyePill={false}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField historiaId={historiaId} field="mc_icc" initialValue={data?.mcIcc} onSaved={onPatchLocal} label="ICC (índice cintura-cadera)" />
          <TextField historiaId={historiaId} field="mc_wells" initialValue={data?.mcWells} onSaved={onPatchLocal} label="Escala de Wells" />
          <div className="md:col-span-2">
            <TextareaField historiaId={historiaId} field="mc_examen_observaciones" initialValue={data?.mcExamenObservaciones} onSaved={onPatchLocal} label="Observaciones" rows={3} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
