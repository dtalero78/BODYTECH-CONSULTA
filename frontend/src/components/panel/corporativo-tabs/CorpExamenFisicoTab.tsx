import { useState } from 'react';
import { Activity, Scale, HeartPulse, Gauge, Hand } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { Calculated } from '../Calculated';
import { TextField, TextareaField, SelectField } from '../fields';
import { CalcAutosave } from './CalcAutosave';
import { ComparacionAnterior } from './ComparacionAnterior';
import { edadEfectiva } from '../edad';
import type { FormulaDef } from '../FormulaHint';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';

// Escala de estabilidad unipodal que usa el equipo médico. El texto de cada
// opción ya trae el rango en segundos, así que el campo numérico aparte sobra.
// Los valores caben en el VARCHAR(30) de `mc_propiocepcion` (el más largo son
// 26 caracteres); si se agrega uno más largo hay que ampliar la columna.
const ESTABILIDAD_UNIPODAL_OPTS: ReadonlyArray<DropdownOption> = [
  'Bajo: Mayor a 30 seg',
  'Medio: 11 a 29 seg',
  'Riesgo Alto: menor a 5 seg',
].map((v) => ({ value: v, label: v }));

const FORMULAS_SIGNOS: ReadonlyArray<FormulaDef> = [
  {
    campo: 'IMC',
    formula: 'Peso (kg) ÷ Talla (m)²',
  },
  {
    campo: 'Comparación · Δ',
    formula: 'Valor actual − valor de la visita anterior',
    nota: 'Verde = cambio favorable. En peso e IMC el delta es informativo (sin color), porque si es favorable depende del objetivo del afiliado.',
  },
  {
    campo: 'ICC (cintura-cadera)',
    formula: 'Perímetro abdominal ÷ Perímetro cadera',
  },
  {
    campo: 'ICT (cintura-talla)',
    formula: 'Perímetro abdominal (cm) ÷ Talla (cm)',
  },
  {
    campo: 'TMB (Kcal)',
    formula: 'Entrada manual',
    nota: 'La plantilla no trae fórmula para este campo.',
  },
];

const FORMULAS_FC: ReadonlyArray<FormulaDef> = [
  {
    campo: 'FC predicha (Tanaka)',
    formula: '208 − (0.7 × Edad)',
  },
  {
    campo: '% FC pico predicha',
    formula: 'FC predicha (Tanaka) × 0.90 / 0.80 / 0.75 / 0.70 / 0.60',
  },
  {
    campo: 'FC de reserva',
    formula: 'FC pico (prueba de esfuerzo) − FC en reposo',
    nota: 'Requiere la FC pico de la prueba de esfuerzo y la frecuencia cardiaca de "Signos y composición corporal".',
  },
  {
    campo: '% FCR (Karvonen)',
    formula: '(FC de reserva × %) + FC en reposo',
  },
];

const FORMULAS_RUFFIER: ReadonlyArray<FormulaDef> = [
  {
    campo: 'FC1 (reposo)',
    formula: '= Frecuencia cardiaca de "Signos y composición corporal"',
    nota: 'No se digita: se toma del signo vital ya registrado.',
  },
  {
    campo: 'Resultado (índice de Ruffier)',
    formula: '(FC1 + FC2 + FC3 − 200) ÷ 10',
  },
  {
    campo: 'Calificación',
    formula: '≤ 0 Excelente · ≤ 5 Bueno · ≤ 10 Medio · ≤ 15 Insuficiente · > 15 Malo',
    nota: 'Bandas clínicas estándar. La plantilla de Excel tiene aquí una fórmula inválida que devolvía siempre "Medio".',
  },
];

const FORMULAS_HANDGRIP: ReadonlyArray<FormulaDef> = [
  {
    campo: 'Promedio por mano',
    formula: '(1er intento + 2do intento) ÷ 2',
  },
  {
    campo: 'Asimetría',
    formula: 'Promedio derecha − Promedio izquierda',
    nota: 'Conserva el signo: un valor negativo indica que domina la mano izquierda.',
  },
  {
    campo: '% Asimetría',
    formula: '100 − ((Promedio izquierda × 100) ÷ Promedio derecha)',
    nota: 'Si el promedio derecho es 0 se muestra "—" (la división no está definida).',
  },
];

interface CorpExamenFisicoTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'signos' | 'fc'  | 'ruffier' | 'handgrip' | 'obs' | null;

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

/** ICC e ICT se leen contra umbrales de riesgo con dos decimales (p. ej. 0.90 en
 *  hombres, 0.85 en mujeres), así que redondear a uno cruzaría el corte. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

  // ---- Índices de composición corporal ----
  // ICC = perímetro abdominal / perímetro cadera (el equipo notó que faltaba la
  // cadera para poder calcularlo). ICT = perímetro abdominal / talla.
  const perimAbd = toNum(data?.mcPerimetroAbdominal);
  const perimCadera = toNum(data?.mcPerimetroCadera);
  const iccCalc =
    perimAbd !== null && perimCadera !== null && perimCadera > 0
      ? round2(perimAbd / perimCadera)
      : null;
  const ictCalc =
    perimAbd !== null && talla !== null && talla > 0
      ? round2(perimAbd / (talla * 100))
      : null;

  // ---- Parámetros de FC ----
  const frecCard = toNum(data?.mcFrecCard); // FC en reposo
  const fcPico = toNum(data?.mcFcPicoPruebaEsfuerzo);
  let fcReservaCalc: number | null = null;
  if (frecCard !== null && fcPico !== null) {
    fcReservaCalc = fcPico - frecCard;
  }
  const fcReservaPct = (pct: number): number | null =>
    frecCard !== null && fcReservaCalc !== null ? Math.round(frecCard + pct * fcReservaCalc) : null;

  // Se deriva de la fecha de nacimiento si la ficha no trae la edad.
  const edad = edadEfectiva(data);
  const tanakaCalc = edad !== null ? Math.round(208 - edad * 0.7) : null;
  const tanakaPct = (pct: number): number | null =>
    tanakaCalc !== null ? round1(tanakaCalc * pct) : null;

  // ---- Ruffier ----
  // Plantilla: L40 (FC1) = F32, o sea la FC en reposo → no se digita, se deriva.
  const fc1 = toNum(data?.mcFrecCard);
  const fc2 = toNum(data?.mcRuffierFc2);
  const fc3 = toNum(data?.mcRuffierFc3);
  let ruffierResultado: number | null = null;
  let ruffierCalificacion: string | null = null;
  if (fc1 !== null && fc2 !== null && fc3 !== null) {
    // N41 = ((FC1+FC2+FC3)-200)/10
    ruffierResultado = round1((fc1 + fc2 + fc3 - 200) / 10);
    // Bandas clínicas estándar. La plantilla trae `=IF(N41>0.1<5,"Bueno","Medio")`,
    // sintaxis inválida que devuelve siempre "Medio"; se usan las 5 bandas reales.
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
  // L45 = AVERAGE(L43:L44) → promedio de los 2 intentos
  const promDer = der1 !== null && der2 !== null ? round1((der1 + der2) / 2) : der1 ?? der2;
  const promIzq = izq1 !== null && izq2 !== null ? round1((izq1 + izq2) / 2) : izq1 ?? izq2;
  let asimetriaMm: number | null = null;
  let asimetriaPct: number | null = null;
  if (promDer !== null && promDer !== undefined && promIzq !== null && promIzq !== undefined) {
    // N43 = L43-M43 → derecha − izquierda, CON signo (negativo = domina izquierda)
    asimetriaMm = round1(promDer - promIzq);
    // O43 = 100-((M43*100)/L43). Si la derecha es 0 la plantilla da #DIV/0!; aquí
    // se deja en null (se muestra "—") en vez de propagar un error.
    asimetriaPct = promDer !== 0 ? round1(100 - (promIzq * 100) / promDer) : null;
  }

  // ---- Card states ----
  const signosVals = [data?.mcFrecCard, data?.mcFrecResp, data?.mcSato2, data?.tas, data?.tad, data?.mcPerimetroAbdominal, data?.mcTalla, data?.mcPeso, data?.mcPctGrasa, data?.mcPctMusculo, data?.mcGrasaVisceral, data?.mcTmb];
  const signosFilled = signosVals.filter(isFilled).length;

  const fcVals = [data?.mcFcPicoPruebaEsfuerzo];
  const fcFilled = fcVals.filter(isFilled).length;

  // FC1 se deriva de la FC en reposo, así que cuenta como diligenciada si esta existe.
  const ruffierVals = [data?.mcFrecCard, data?.mcRuffierFc2, data?.mcRuffierFc3];
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
        size="wide"
        formulas={FORMULAS_SIGNOS}
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">Signos vitales</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
              <TextField historiaId={historiaId} field="tas" initialValue={data?.tas} onSaved={onPatchLocal} label="TAS (mmHg)" type="number" min={60} max={250} />
              <TextField historiaId={historiaId} field="tad" initialValue={data?.tad} onSaved={onPatchLocal} label="TAD (mmHg)" type="number" min={40} max={180} />
              <TextField historiaId={historiaId} field="mc_frec_card" initialValue={data?.mcFrecCard} onSaved={onPatchLocal} label="Frecuencia cardiaca (lpm)" type="number" min={30} max={220} />
              <TextField historiaId={historiaId} field="mc_frec_resp" initialValue={data?.mcFrecResp} onSaved={onPatchLocal} label="Frecuencia respiratoria (rpm)" type="number" min={5} max={60} />
              <TextField historiaId={historiaId} field="mc_sato2" initialValue={data?.mcSato2} onSaved={onPatchLocal} label="SatO2 (%)" type="number" min={50} max={100} />
              <TextField historiaId={historiaId} field="mc_perimetro_abdominal" initialValue={data?.mcPerimetroAbdominal} onSaved={onPatchLocal} label="Perímetro abdominal (cm)" type="number" min={40} max={200} />
              <TextField historiaId={historiaId} field="mc_talla" initialValue={data?.mcTalla} onSaved={onPatchLocal} label="Talla (m)" type="number" min={1} max={2.5} placeholder="Ej. 1.65" error={talla !== null && (talla < 1 || talla > 2.5) ? "En metros (ej. 1.65 o 1,65)" : undefined} />
            </div>
          </div>
          <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">Composición corporal</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
              <TextField historiaId={historiaId} field="mc_peso" initialValue={data?.mcPeso} onSaved={onPatchLocal} label="Peso (kg)" type="number" min={20} max={300} />
              <TextField historiaId={historiaId} field="mc_pct_grasa" initialValue={data?.mcPctGrasa} onSaved={onPatchLocal} label="% Grasa" type="number" min={0} max={80} />
              <TextField historiaId={historiaId} field="mc_pct_musculo" initialValue={data?.mcPctMusculo} onSaved={onPatchLocal} label="% Músculo" type="number" min={0} max={100} />
              <TextField historiaId={historiaId} field="mc_grasa_visceral" initialValue={data?.mcGrasaVisceral} onSaved={onPatchLocal} label="Grasa visceral" type="number" min={0} max={60} />
              <Calculated label="IMC" value={imcCalc ?? '—'} />
              <TextField historiaId={historiaId} field="mc_tmb" initialValue={data?.mcTmb} onSaved={onPatchLocal} label="TMB (Kcal)" type="number" placeholder="Entrada manual" min={0} />
              {/* El ICC vive aquí (y no en Observaciones) porque es una medida de
                  composición corporal; necesitaba el perímetro de cadera, que faltaba. */}
              <TextField historiaId={historiaId} field="mc_perimetro_cadera" initialValue={data?.mcPerimetroCadera} onSaved={onPatchLocal} label="Perímetro cadera (cm)" type="number" min={40} max={200} />
              <Calculated label="ICC (cintura-cadera)" value={iccCalc ?? '—'} />
              <Calculated label="ICT (cintura-talla)" value={ictCalc ?? '—'} />
            </div>
            <CalcAutosave historiaId={historiaId} field="mc_imc" value={imcCalc} serverValue={data?.mcImc ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_icc" value={iccCalc} serverValue={data?.mcIcc ?? null} onPatchLocal={onPatchLocal} />
            <CalcAutosave historiaId={historiaId} field="mc_indice_cintura_talla" value={ictCalc} serverValue={data?.mcIndiceCinturaTalla ?? null} onPatchLocal={onPatchLocal} />
          </div>

          {/* Fila "Comparación" de la plantilla: delta vs. la visita anterior */}
          <ComparacionAnterior historiaId={historiaId} data={data} imcActual={imcCalc} />
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
        size="wide"
        formulas={FORMULAS_FC}
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">
              FC predicha (Tanaka) — se calcula siempre
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

          <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">
              FC de reserva (Karvonen) — solo si se hizo ergometría
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <TextField
                historiaId={historiaId}
                field="mc_fc_pico_prueba_esfuerzo"
                initialValue={data?.mcFcPicoPruebaEsfuerzo}
                onSaved={onPatchLocal}
                label="FC máxima teórica o pico en prueba"
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
        size="wide"
        formulas={FORMULAS_RUFFIER}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* FC1 = FC en reposo (fórmula de la plantilla: L40 = F32) */}
            <Calculated label="FC1 (reposo)" value={fc1 ?? '—'} unit="lpm" />
            <TextField historiaId={historiaId} field="mc_ruffier_fc2" initialValue={data?.mcRuffierFc2} onSaved={onPatchLocal} label="FC2 (post-esfuerzo)" type="number" min={30} max={220} />
            <TextField historiaId={historiaId} field="mc_ruffier_fc3" initialValue={data?.mcRuffierFc3} onSaved={onPatchLocal} label="FC3 (recuperación)" type="number" min={30} max={220} />
          </div>
          {fc1 === null && (
            <div className="px-4 py-2.5 rounded-xl border border-[rgba(var(--p-warn-rgb),0.30)] bg-[rgba(var(--p-warn-rgb),0.08)] text-[var(--p-warn)] text-[12px]">
              FC1 se toma de la frecuencia cardiaca en reposo — diligénciala en "Signos y composición corporal" para calcular el índice.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <Calculated label="Resultado (índice de Ruffier)" value={ruffierResultado ?? '—'} />
            <Calculated label="Calificación" value={ruffierCalificacion ?? '—'} />
          </div>
          {/* FC1 se persiste también en su columna para dejar el dato congelado en la historia */}
          <CalcAutosave historiaId={historiaId} field="mc_ruffier_fc1" value={fc1} serverValue={data?.mcRuffierFc1 ?? null} onPatchLocal={onPatchLocal} />
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
        size="wide"
        formulas={FORMULAS_HANDGRIP}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <TextField historiaId={historiaId} field="mc_handgrip_der_1" initialValue={data?.mcHandgripDer1} onSaved={onPatchLocal} label="Mano derecha · 1er intento" type="number" min={0} max={100} />
            <TextField historiaId={historiaId} field="mc_handgrip_izq_1" initialValue={data?.mcHandgripIzq1} onSaved={onPatchLocal} label="Mano izquierda · 1er intento" type="number" min={0} max={100} />
            <TextField historiaId={historiaId} field="mc_handgrip_der_2" initialValue={data?.mcHandgripDer2} onSaved={onPatchLocal} label="Mano derecha · 2do intento" type="number" min={0} max={100} />
            <TextField historiaId={historiaId} field="mc_handgrip_izq_2" initialValue={data?.mcHandgripIzq2} onSaved={onPatchLocal} label="Mano izquierda · 2do intento" type="number" min={0} max={100} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-3 border-t border-dashed border-[var(--p-line)]">
            <Calculated label="Promedio mano derecha" value={promDer ?? '—'} />
            <Calculated label="Promedio mano izquierda" value={promIzq ?? '—'} />
            <Calculated
              label="Asimetría (der − izq)"
              value={asimetriaMm ?? '—'}
              unit={asimetriaMm !== null && asimetriaMm < 0 ? 'domina izquierda' : undefined}
            />
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
        size="wide"
      >
        {/* El ICC se movió a Composición corporal (es una medida de composición y
            necesita el perímetro de cadera). Aquí quedó la estabilidad unipodal. */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="mc_propiocepcion"
            initialValue={data?.mcPropiocepcion}
            onSaved={onPatchLocal}
            label="Estabilidad unipodal"
            options={ESTABILIDAD_UNIPODAL_OPTS}
            placeholder="Seleccionar..."
          />
          <TextField
            historiaId={historiaId}
            field="mc_wells"
            initialValue={data?.mcWells}
            onSaved={onPatchLocal}
            label="Wells (cm dedos–piso)"
            placeholder="Prueba modificada"
          />
          <div className="md:col-span-2 xl:col-span-3">
            <TextareaField historiaId={historiaId} field="mc_examen_observaciones" initialValue={data?.mcExamenObservaciones} onSaved={onPatchLocal} label="Observaciones" rows={3} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
