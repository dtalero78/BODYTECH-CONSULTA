import { useEffect, useState } from 'react';

/**
 * Ruta DEMO (solo dev): muestra las secciones de antropometría ISAK del panel
 * nutricional auto-rellenándose, para grabar un clip corto (≤10s) que se inserta
 * en otro video. Reutiliza la MISMA lógica de cálculo (Yuhasz/Faulkner/Durnin-
 * Womersley, somatotipo Heath-Carter y somatocarta) que MedicalHistoryPanel.tsx.
 *
 * No toca backend, Twilio ni DB — paciente de prueba fijo. Montada en App.tsx
 * bajo `import.meta.env.DEV`, por lo que nunca llega al bundle de producción.
 */

// Paciente de prueba (necesario para las fórmulas dependientes de edad/sexo).
const EDAD = 34;
const GENERO = 'femenino';

type Vals = Record<string, string>;

// Orden de diligenciamiento (lo que "escribe" el médico).
const SEQUENCE: [string, string][] = [
  ['talla', '168'],
  ['peso', '62'],
  ['pliegueTriceps', '18'],
  ['pliegueSubescapular', '15'],
  ['pliegueSupraespinal', '12'],
  ['pliegueAbdominal', '22'],
  ['pliegueBiceps', '8'],
  ['pliegueCrestaIliaca', '16'],
  ['pliegueMusloAnterior', '26'],
  ['plieguePantorrilla', '14'],
  ['perimetroBrazoContraido', '30'],
  ['perimetroPantorrillaMaxima', '35'],
  ['diametroHumero', '6.0'],
  ['diametroFemur', '9.0'],
];

const esMasc = (() => {
  const g = GENERO.toLowerCase();
  return g.includes('masculino') || g === 'm' || g === 'male' || g === 'hombre';
})();

// ------- Cálculos ISAK (idéntico a MedicalHistoryPanel.calcularISAK) -------
function calcularISAK(v: Vals) {
  const edad = EDAD;
  const pesoNum = parseFloat(v.peso);
  const tallaNum = parseFloat(v.talla);

  const triceps = parseFloat(v.pliegueTriceps);
  const subescapular = parseFloat(v.pliegueSubescapular);
  const biceps = parseFloat(v.pliegueBiceps);
  const crestaIliaca = parseFloat(v.pliegueCrestaIliaca);
  const supraespinal = parseFloat(v.pliegueSupraespinal);
  const abdominal = parseFloat(v.pliegueAbdominal);
  const musloAnterior = parseFloat(v.pliegueMusloAnterior);
  const pantorrilla = parseFloat(v.plieguePantorrilla);

  const pliegues = [triceps, subescapular, biceps, crestaIliaca, supraespinal, abdominal, musloAnterior, pantorrilla];
  const pliegues6 = [triceps, subescapular, supraespinal, abdominal, musloAnterior, pantorrilla];

  const sum6 = pliegues6.every((x) => !isNaN(x)) ? pliegues6.reduce((a, b) => a + b, 0) : NaN;
  const sum8 = pliegues.every((x) => !isNaN(x)) ? pliegues.reduce((a, b) => a + b, 0) : NaN;

  let faulkner = NaN;
  if (!isNaN(triceps) && !isNaN(subescapular) && !isNaN(supraespinal) && !isNaN(abdominal)) {
    const s4f = triceps + subescapular + supraespinal + abdominal;
    faulkner = s4f * 0.153 + 5.783;
  }

  let durninWomersley = NaN;
  if (!isNaN(biceps) && !isNaN(triceps) && !isNaN(subescapular) && !isNaN(crestaIliaca) && edad) {
    const s4dw = biceps + triceps + subescapular + crestaIliaca;
    const logSum = Math.log10(s4dw);
    let dc: number;
    if (esMasc) {
      if (edad < 20) dc = 1.162 - 0.063 * logSum;
      else if (edad < 30) dc = 1.1631 - 0.0632 * logSum;
      else if (edad < 40) dc = 1.1422 - 0.0544 * logSum;
      else if (edad < 50) dc = 1.162 - 0.07 * logSum;
      else dc = 1.1715 - 0.0779 * logSum;
    } else {
      if (edad < 20) dc = 1.1549 - 0.0678 * logSum;
      else if (edad < 30) dc = 1.1599 - 0.0717 * logSum;
      else if (edad < 40) dc = 1.1423 - 0.0632 * logSum;
      else if (edad < 50) dc = 1.1333 - 0.0612 * logSum;
      else dc = 1.1339 - 0.0645 * logSum;
    }
    durninWomersley = 495 / dc - 450;
  }

  let yuhasz = NaN;
  if (!isNaN(sum6)) {
    yuhasz = esMasc ? 2.585 + sum6 * 0.1051 : 3.5803 + sum6 * 0.1548;
  }

  const grasaPct = !isNaN(yuhasz) ? yuhasz : !isNaN(faulkner) ? faulkner : !isNaN(durninWomersley) ? durninWomersley : NaN;
  const masaGrasa = !isNaN(grasaPct) && !isNaN(pesoNum) ? (pesoNum * grasaPct) / 100 : NaN;
  const masaLibreGrasa = !isNaN(masaGrasa) && !isNaN(pesoNum) ? pesoNum - masaGrasa : NaN;

  const diametroHumero = parseFloat(v.diametroHumero);
  const diametroFemur = parseFloat(v.diametroFemur);
  const perimetroBrazoContraido = parseFloat(v.perimetroBrazoContraido);
  const perimetroPantorrillaMax = parseFloat(v.perimetroPantorrillaMaxima);

  let endomorfia = NaN;
  if (!isNaN(triceps) && !isNaN(subescapular) && !isNaN(supraespinal) && !isNaN(tallaNum) && tallaNum > 0) {
    const X = (triceps + subescapular + supraespinal) * (170.18 / tallaNum);
    endomorfia = -0.7182 + 0.1451 * X - 0.00068 * X * X + 0.0000014 * X * X * X;
  }

  let mesomorfia = NaN;
  if (
    !isNaN(diametroHumero) && !isNaN(diametroFemur) &&
    !isNaN(perimetroBrazoContraido) && !isNaN(triceps) &&
    !isNaN(perimetroPantorrillaMax) && !isNaN(pantorrilla) &&
    !isNaN(tallaNum) && tallaNum > 0
  ) {
    const PBC = perimetroBrazoContraido - triceps / 10;
    const PGC = perimetroPantorrillaMax - pantorrilla / 10;
    mesomorfia = 0.858 * diametroHumero + 0.601 * diametroFemur + 0.188 * PBC + 0.161 * PGC - tallaNum * 0.131 + 4.5;
  }

  let ectomorfia = NaN;
  if (!isNaN(pesoNum) && !isNaN(tallaNum) && pesoNum > 0 && tallaNum > 0) {
    const IP = tallaNum / Math.cbrt(pesoNum);
    if (IP >= 40.75) ectomorfia = 0.732 * IP - 28.58;
    else if (IP > 38.25) ectomorfia = 0.463 * IP - 17.63;
    else ectomorfia = 0.1;
  }

  let ejeX = NaN, ejeY = NaN;
  if (!isNaN(endomorfia) && !isNaN(ectomorfia)) ejeX = ectomorfia - endomorfia;
  if (!isNaN(endomorfia) && !isNaN(mesomorfia) && !isNaN(ectomorfia)) ejeY = 2 * mesomorfia - endomorfia - ectomorfia;

  let clasificacionSomato = '';
  if (!isNaN(endomorfia) && !isNaN(mesomorfia) && !isNaN(ectomorfia)) {
    const e = endomorfia, m = mesomorfia, ec = ectomorfia;
    const umbral = 0.5;
    if (e > m && e > ec) {
      if (Math.abs(e - m) <= umbral) clasificacionSomato = 'Endo-mesomorfo';
      else if (Math.abs(e - ec) <= umbral) clasificacionSomato = 'Endo-ectomorfo';
      else clasificacionSomato = 'Endomorfo';
    } else if (m > e && m > ec) {
      if (Math.abs(e - m) <= umbral) clasificacionSomato = 'Meso-endomorfo';
      else if (Math.abs(m - ec) <= umbral) clasificacionSomato = 'Meso-ectomorfo';
      else clasificacionSomato = 'Mesomorfo';
    } else if (ec > e && ec > m) {
      if (Math.abs(e - ec) <= umbral) clasificacionSomato = 'Ecto-endomorfo';
      else if (Math.abs(m - ec) <= umbral) clasificacionSomato = 'Ecto-mesomorfo';
      else clasificacionSomato = 'Ectomorfo';
    } else clasificacionSomato = 'Central';
  }

  const f = (x: number, d = 1) => (!isNaN(x) ? x.toFixed(d) : '');
  return {
    sum6: f(sum6), sum8: f(sum8),
    yuhasz: f(yuhasz), faulkner: f(faulkner), durninWomersley: f(durninWomersley),
    masaGrasa: f(masaGrasa), masaLibreGrasa: f(masaLibreGrasa),
    endomorfia: f(endomorfia), mesomorfia: f(mesomorfia), ectomorfia: f(ectomorfia),
    ejeX: f(ejeX, 2), ejeY: f(ejeY, 2), clasificacionSomato,
  };
}

function grasaColor(pct: string) {
  const val = parseFloat(pct);
  if (isNaN(val)) return 'text-gray-400';
  if (esMasc) {
    if (val < 6) return 'text-yellow-400';
    if (val <= 17) return 'text-green-400';
    if (val <= 25) return 'text-yellow-400';
    return 'text-red-500';
  }
  if (val < 14) return 'text-yellow-400';
  if (val <= 24) return 'text-green-400';
  if (val <= 32) return 'text-yellow-400';
  return 'text-red-500';
}

// ------- UI -------
const Field = ({ label, k, vals, active }: { label: string; k: string; vals: Vals; active: string | null }) => (
  <div>
    <label className="block text-sm text-gray-400 mb-1">{label}</label>
    <input
      type="text"
      readOnly
      value={vals[k] || ''}
      data-testid={`isak-${k}`}
      className={`w-full bg-[#1f2c34] text-white text-base px-2 py-2 rounded border transition-all duration-150 focus:outline-none ${
        active === k ? 'border-[#00a884] ring-2 ring-[#00a884]/60' : 'border-gray-600'
      }`}
      placeholder="—"
    />
  </div>
);

const Stat = ({ label, value, cls = 'text-white' }: { label: string; value: string; cls?: string }) => (
  <div className="text-center">
    <span className="block text-sm text-gray-400">{label}</span>
    <span className={`text-base font-semibold ${cls}`}>{value}</span>
  </div>
);

export const IsakDemo = () => {
  const [vals, setVals] = useState<Vals>({});
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    // Sin guard de useRef: bajo StrictMode (dev) React monta→desmonta→remonta;
    // el cleanup cancela el primer loop y el remonte arranca uno nuevo desde cero.
    let cancelled = false;
    setVals({});
    setActive(null);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await sleep(650);
      for (const [key, val] of SEQUENCE) {
        if (cancelled) return;
        setActive(key);
        await sleep(110);
        for (let i = 1; i <= val.length; i++) {
          if (cancelled) return;
          setVals((prev) => ({ ...prev, [key]: val.slice(0, i) }));
          await sleep(55);
        }
        await sleep(190);
      }
      if (cancelled) return;
      setActive(null);
    })();
    return () => { cancelled = true; };
  }, []);

  const isak = calcularISAK(vals);

  // IMC
  const tallaN = parseFloat(vals.talla), pesoN = parseFloat(vals.peso);
  const imc = !isNaN(tallaN) && !isNaN(pesoN) && tallaN > 0 ? (pesoN / ((tallaN / 100) ** 2)).toFixed(1) : '';
  const imcCls = imc && parseFloat(imc) >= 25 ? 'text-red-500' : imc ? 'text-green-400' : 'text-gray-400';

  // Somatocarta
  const svgW = 400, svgH = 320, xMin = -10, xMax = 10, yMin = -10, yMax = 18;
  const toX = (vx: number) => ((vx - xMin) / (xMax - xMin)) * svgW;
  const toY = (vy: number) => svgH - ((vy - yMin) / (yMax - yMin)) * svgH;
  const endoPt = { x: toX(-8), y: toY(-8) }, mesoPt = { x: toX(0), y: toY(16) }, ectoPt = { x: toX(8), y: toY(-8) };
  const hasPoint = isak.ejeX && isak.ejeY;
  const px = hasPoint ? toX(parseFloat(isak.ejeX)) : 0;
  const py = hasPoint ? toY(parseFloat(isak.ejeY)) : 0;

  return (
    <div className="min-h-screen bg-[#0b141a] text-white font-figtree p-8" data-testid="isak-panel">
      <div className="max-w-[1500px] mx-auto">
        {/* Encabezado */}
        <div className="flex items-center justify-between mb-5 border-b border-gray-700 pb-3">
          <h2 className="text-xl font-bold text-[#00a884]">Antropometría ISAK</h2>
          <div className="text-sm text-gray-400">
            Paciente demo · <span className="text-white">34 años</span> · <span className="text-white">Femenino</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_580px] gap-6">
          {/* IZQUIERDA — ingreso de medidas */}
          <div className="space-y-4">
            <div className="bg-[#2a3942] rounded-lg p-3">
              <h3 className="text-base font-semibold mb-2 text-[#00a884]">Medidas Físicas</h3>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Talla (cm)" k="talla" vals={vals} active={active} />
                <Field label="Peso (kg)" k="peso" vals={vals} active={active} />
                <div>
                  <label className="block text-sm text-gray-400 mb-1">IMC</label>
                  <input readOnly value={imc} placeholder="Auto"
                    className={`w-full bg-[#2a3942] ${imcCls} text-base px-2 py-2 rounded border border-gray-600 font-semibold`} />
                </div>
              </div>
            </div>

            <div className="bg-[#2a3942] rounded-lg p-3">
              <h3 className="text-base font-semibold mb-2 text-[#00a884]">Pliegues Cutaneos - ISAK</h3>
              <div className="grid grid-cols-4 gap-2">
                <Field label="Triceps (mm)" k="pliegueTriceps" vals={vals} active={active} />
                <Field label="Subescapular" k="pliegueSubescapular" vals={vals} active={active} />
                <Field label="Supraespinal" k="pliegueSupraespinal" vals={vals} active={active} />
                <Field label="Abdominal" k="pliegueAbdominal" vals={vals} active={active} />
                <Field label="Biceps" k="pliegueBiceps" vals={vals} active={active} />
                <Field label="Cresta Iliaca" k="pliegueCrestaIliaca" vals={vals} active={active} />
                <Field label="Muslo Anterior" k="pliegueMusloAnterior" vals={vals} active={active} />
                <Field label="Pantorrilla" k="plieguePantorrilla" vals={vals} active={active} />
              </div>
            </div>

            <div className="bg-[#2a3942] rounded-lg p-3">
              <h3 className="text-base font-semibold mb-2 text-[#00a884]">Perímetros y Diámetros</h3>
              <p className="text-sm text-gray-400 mb-1 font-semibold">Perímetros (cm)</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <Field label="Brazo Contraído" k="perimetroBrazoContraido" vals={vals} active={active} />
                <Field label="Pantorrilla Máx." k="perimetroPantorrillaMaxima" vals={vals} active={active} />
              </div>
              <p className="text-sm text-gray-400 mb-1 font-semibold">Diámetros óseos (cm)</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Húmero (biepicondíleo)" k="diametroHumero" vals={vals} active={active} />
                <Field label="Fémur (biepicondíleo)" k="diametroFemur" vals={vals} active={active} />
              </div>
            </div>
          </div>

          {/* DERECHA — resultados en vivo */}
          <div className="space-y-3">
            {(isak.sum6 || isak.sum8 || isak.yuhasz || isak.faulkner) && (
              <div className="bg-[#1a2530] rounded p-3 border border-gray-700">
                <p className="text-sm text-gray-400 mb-2 font-semibold">Resultados ISAK</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {isak.sum6 && <Stat label="Suma 6 pliegues" value={`${isak.sum6} mm`} />}
                  {isak.sum8 && <Stat label="Suma 8 pliegues" value={`${isak.sum8} mm`} />}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {isak.yuhasz && <Stat label="% Grasa (Yuhasz)" value={`${isak.yuhasz}%`} cls={grasaColor(isak.yuhasz)} />}
                  {isak.faulkner && <Stat label="% Grasa (Faulkner)" value={`${isak.faulkner}%`} cls={grasaColor(isak.faulkner)} />}
                  {isak.durninWomersley && <Stat label="% Grasa (D-W)" value={`${isak.durninWomersley}%`} cls={grasaColor(isak.durninWomersley)} />}
                </div>
                {(isak.masaGrasa || isak.masaLibreGrasa) && (
                  <div className="grid grid-cols-2 gap-2">
                    {isak.masaGrasa && <Stat label="Masa Grasa" value={`${isak.masaGrasa} kg`} />}
                    {isak.masaLibreGrasa && <Stat label="Masa Libre de Grasa" value={`${isak.masaLibreGrasa} kg`} />}
                  </div>
                )}
              </div>
            )}

            {(isak.endomorfia || isak.mesomorfia || isak.ectomorfia) && (
              <div className="bg-[#1a2530] rounded p-3 border border-gray-700">
                <p className="text-sm text-gray-400 mb-2 font-semibold">Somatotipo (Heath-Carter)</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="text-center bg-[#2a3942] rounded p-1">
                    <span className="block text-sm text-gray-400">Endomorfia</span>
                    <span className="text-base text-amber-400 font-semibold">{isak.endomorfia || '—'}</span>
                  </div>
                  <div className="text-center bg-[#2a3942] rounded p-1">
                    <span className="block text-sm text-gray-400">Mesomorfia</span>
                    <span className="text-base text-green-400 font-semibold">{isak.mesomorfia || '—'}</span>
                  </div>
                  <div className="text-center bg-[#2a3942] rounded p-1">
                    <span className="block text-sm text-gray-400">Ectomorfia</span>
                    <span className="text-base text-blue-400 font-semibold">{isak.ectomorfia || '—'}</span>
                  </div>
                </div>

                {hasPoint && (
                  <div className="bg-[#0b141a] rounded p-2 border border-gray-700">
                    <p className="text-sm text-gray-400 mb-1 font-semibold text-center">Somatocarta</p>
                    <div className="flex justify-center">
                      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-md" style={{ background: '#0b141a' }}>
                        <defs>
                          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#2a3942" strokeWidth="0.5" />
                          </pattern>
                        </defs>
                        <rect width={svgW} height={svgH} fill="url(#grid)" />
                        <line x1={toX(xMin)} y1={toY(0)} x2={toX(xMax)} y2={toY(0)} stroke="#cbd5e1" strokeWidth="2" />
                        <line x1={toX(0)} y1={toY(yMin)} x2={toX(0)} y2={toY(yMax)} stroke="#cbd5e1" strokeWidth="2" />
                        {[-8, -4, 4, 8].map((val) => (
                          <g key={`xt${val}`}>
                            <line x1={toX(val)} y1={toY(0) - 4} x2={toX(val)} y2={toY(0) + 4} stroke="#cbd5e1" strokeWidth="1.5" />
                            <text x={toX(val)} y={toY(0) + 15} fontSize="10" fill="#cbd5e1" textAnchor="middle">{val}</text>
                          </g>
                        ))}
                        {[-8, -4, 4, 8, 12, 16].map((val) => (
                          <g key={`yt${val}`}>
                            <line x1={toX(0) - 4} y1={toY(val)} x2={toX(0) + 4} y2={toY(val)} stroke="#cbd5e1" strokeWidth="1.5" />
                            <text x={toX(0) - 7} y={toY(val) + 3} fontSize="10" fill="#cbd5e1" textAnchor="end">{val}</text>
                          </g>
                        ))}
                        <polygon points={`${endoPt.x},${endoPt.y} ${mesoPt.x},${mesoPt.y} ${ectoPt.x},${ectoPt.y}`}
                          fill="rgba(0, 168, 132, 0.08)" stroke="#00a884" strokeWidth="1.5" />
                        <line x1={endoPt.x} y1={endoPt.y} x2={toX(0)} y2={toY(0)} stroke="#00a884" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                        <line x1={mesoPt.x} y1={mesoPt.y} x2={toX(0)} y2={toY(0)} stroke="#00a884" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                        <line x1={ectoPt.x} y1={ectoPt.y} x2={toX(0)} y2={toY(0)} stroke="#00a884" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                        <text x={endoPt.x} y={endoPt.y + 16} fontSize="11" fill="#fbbf24" textAnchor="middle" fontWeight="bold">ENDOMORFIA</text>
                        <text x={mesoPt.x} y={mesoPt.y - 10} fontSize="11" fill="#34d399" textAnchor="middle" fontWeight="bold">MESOMORFIA</text>
                        <text x={ectoPt.x} y={ectoPt.y + 16} fontSize="11" fill="#60a5fa" textAnchor="middle" fontWeight="bold">ECTOMORFIA</text>
                        <circle cx={px} cy={py} r="8" fill="rgba(239, 68, 68, 0.3)" stroke="#ef4444" strokeWidth="2" />
                        <circle cx={px} cy={py} r="3" fill="#ef4444" />
                        <text x={px + 10} y={py - 6} fontSize="10" fill="#fca5a5" fontWeight="bold">({isak.ejeX}, {isak.ejeY})</text>
                      </svg>
                    </div>
                    <p className="text-sm text-gray-500 text-center mt-1">
                      Clasificación: <span className="text-[#00a884] font-semibold">{isak.clasificacionSomato}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IsakDemo;
