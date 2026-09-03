// ============================================================================
// antropometria — el motor de cálculo de composición corporal.
//
// POR QUÉ ESTÁ EN EL BACKEND Y NO EN EL PANEL
// -------------------------------------------
// Las fórmulas de pliegues (Yuhasz, Faulkner, Durnin-Womersley) y el somatotipo
// Heath-Carter ya existían dentro de `frontend/src/components/MedicalHistoryPanel.tsx`,
// embebidas en un componente de ~2.000 líneas y sin un solo test — el frontend
// de este repo no tiene runner.
//
// Un número mal calculado acá sale impreso en una hoja con el logo de Bodytech
// y la cédula del paciente. Eso pide tests, así que el motor vive del lado que
// tiene jest y el panel consume `POST /api/acc/calcular`.
//
// ⚠️ DEUDA CONOCIDA: el panel nutricional (`MedicalHistoryPanel.tsx`) sigue con
// su propia copia de estas fórmulas. Las de acá se portaron VERBATIM de allá
// para que no diverjan, pero son dos implementaciones. Migrar el panel
// nutricional a este endpoint es trabajo pendiente y deliberado: tocarlo en la
// misma tanda que se construye ACC arriesgaba un panel que ya está en uso.
// Si cambiás una fórmula acá, cambiala allá también.
//
// UNIDADES (no negociables, todo lo demás asume esto)
//   estatura  cm        peso      kg
//   pliegues  mm        perímetros cm
//   diámetros cm        edad      años cumplidos
// ============================================================================

export type Sexo = 'masculino' | 'femenino';

/** Lo que mide el fisioterapeuta. Todo opcional: el panel calcula en vivo. */
export interface MedidasAntropometricas {
  sexo?: Sexo | string | null;
  edad?: number | null;
  estaturaCm?: number | null;
  pesoKg?: number | null;

  // Perímetros (cm)
  perimetroAbdominal?: number | null;
  perimetroCadera?: number | null;
  perimetroBrazoRelajadoDer?: number | null;
  perimetroBrazoContraidoDer?: number | null;
  perimetroBrazoRelajadoIzq?: number | null;
  perimetroBrazoContraidoIzq?: number | null;
  perimetroMusloDer?: number | null;
  perimetroMusloIzq?: number | null;
  perimetroPantorrilla?: number | null;

  // Pliegues (mm)
  pliegueTriceps?: number | null;
  pliegueSubescapular?: number | null;
  pliegueBiceps?: number | null;
  pliegueCrestaIliaca?: number | null;
  pliegueSupraespinal?: number | null;
  pliegueAbdominal?: number | null;
  pliegueMusloAnterior?: number | null;
  plieguePantorrilla?: number | null;
}

export type Evaluacion = 'bajo' | 'normal' | 'alto' | 'optimo';

export interface ValorEvaluado {
  valor: number;
  evaluacion: Evaluacion | null;
}

export interface ResultadoAntropometrico {
  imc: ValorEvaluado | null;
  porcentajeGrasa: ValorEvaluado | null;
  porcentajeMuscular: ValorEvaluado | null;
  pesoMuscularKg: number | null;
  masaGrasaKg: number | null;
  masaLibreGrasaKg: number | null;
  imm: number | null;
  tmbKcal: ValorEvaluado | null;
  icc: ValorEvaluado | null;
  ict: ValorEvaluado | null;
  perimetroAbdominal: ValorEvaluado | null;
  sumatoria6: number | null;
  sumatoria8: number | null;
  /** Qué fórmula produjo `porcentajeGrasa`. Va impresa en el informe. */
  metodoGrasa: 'yuhasz' | 'faulkner' | 'durnin-womersley' | null;
  /** Campos que no se pudieron calcular y por qué. Para la UI, no para el PDF. */
  faltantes: string[];
}

// ---------------------------------------------------------------------------
// Rangos de clasificación
//
// ⚠️ PROVISIONALES. Nikolay Correal (Bodytech) debe enviar los rangos oficiales
// del programa ACC. Hasta entonces estos salen de referencias estándar (OMS
// para IMC, ACSM/OMS para ICC e ICT, ACE para % graso) y están acá, en un solo
// objeto, para que reemplazarlos sea editar este bloque y nada más.
//
// `null` en un límite = sin límite por ese lado.
// ---------------------------------------------------------------------------

export interface Banda {
  hasta: number | null;
  evaluacion: Evaluacion;
}

export interface RangosConfig {
  imc: Banda[];
  grasaMasculino: Banda[];
  grasaFemenino: Banda[];
  iccMasculino: Banda[];
  iccFemenino: Banda[];
  ict: Banda[];
  perimetroAbdominalMasculino: Banda[];
  perimetroAbdominalFemenino: Banda[];
  muscularMasculino: Banda[];
  muscularFemenino: Banda[];
}

export const RANGOS_PROVISIONALES: RangosConfig = {
  // OMS
  imc: [
    { hasta: 18.5, evaluacion: 'bajo' },
    { hasta: 25, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  // ACE (American Council on Exercise), adultos
  grasaMasculino: [
    { hasta: 6, evaluacion: 'bajo' },
    { hasta: 18, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  grasaFemenino: [
    { hasta: 14, evaluacion: 'bajo' },
    { hasta: 25, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  // OMS: riesgo cardiometabólico
  iccMasculino: [
    { hasta: 0.9, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  iccFemenino: [
    { hasta: 0.85, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  // Índice cintura/talla: 0.5 es el umbral clásico ("keep your waist to less
  // than half your height"), igual para ambos sexos.
  ict: [
    { hasta: 0.4, evaluacion: 'bajo' },
    { hasta: 0.5, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  perimetroAbdominalMasculino: [
    { hasta: 94, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  perimetroAbdominalFemenino: [
    { hasta: 80, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  // Masa muscular esquelética como % del peso. Referencia orientativa.
  muscularMasculino: [
    { hasta: 33, evaluacion: 'bajo' },
    { hasta: 40, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
  muscularFemenino: [
    { hasta: 24, evaluacion: 'bajo' },
    { hasta: 31, evaluacion: 'normal' },
    { hasta: null, evaluacion: 'alto' },
  ],
};

/** Clasifica un valor contra una escalera de bandas ordenada de menor a mayor. */
export function clasificar(valor: number, bandas: Banda[]): Evaluacion | null {
  for (const b of bandas) {
    if (b.hasta === null || valor < b.hasta) return b.evaluacion;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Número finito y positivo, o null. Cualquier basura de un input entra acá. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Como `num` pero exige > 0. Para divisores (talla, peso, cadera). */
function pos(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

function redondear(n: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

/**
 * Normaliza el sexo. El dato llega de fuentes distintas ('M', 'Masculino',
 * 'male', 'hombre'), así que se acepta todo lo que aparece en la base.
 */
export function normalizarSexo(v: unknown): Sexo | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('m') && !s.startsWith('muj') && s !== 'f') return 'masculino';
  if (s === 'male' || s === 'hombre' || s === 'h') return 'masculino';
  if (s.startsWith('f') || s.startsWith('muj') || s === 'female') return 'femenino';
  return null;
}

// ---------------------------------------------------------------------------
// Fórmulas
// ---------------------------------------------------------------------------

/** IMC = peso / talla². Talla en cm. */
export function calcularImc(pesoKg: number | null, estaturaCm: number | null): number | null {
  const p = pos(pesoKg);
  const e = pos(estaturaCm);
  if (p === null || e === null) return null;
  const m = e / 100;
  return redondear(p / (m * m), 2);
}

export interface Pliegues {
  triceps: number | null;
  subescapular: number | null;
  biceps: number | null;
  crestaIliaca: number | null;
  supraespinal: number | null;
  abdominal: number | null;
  musloAnterior: number | null;
  pantorrilla: number | null;
}

/**
 * Sumatoria de 6 pliegues (protocolo Bodytech): tríceps, subescapular,
 * supraespinal, abdominal, muslo anterior y pantorrilla. Excluye bíceps y
 * cresta ilíaca. Devuelve null si falta alguno.
 */
export function sumatoria6(p: Pliegues): number | null {
  const vals = [p.triceps, p.subescapular, p.supraespinal, p.abdominal, p.musloAnterior, p.pantorrilla];
  if (vals.some((v) => v === null)) return null;
  return redondear(vals.reduce((a, b) => a! + b!, 0)!, 1);
}

/** Sumatoria de los 8 pliegues del perfil restringido ISAK. */
export function sumatoria8(p: Pliegues): number | null {
  const vals = Object.values(p);
  if (vals.some((v) => v === null)) return null;
  return redondear(vals.reduce((a, b) => a! + b!, 0)!, 1);
}

/**
 * Yuhasz — la fórmula del protocolo Bodytech. Usa la sumatoria de 6 pliegues.
 * Portada verbatim de MedicalHistoryPanel.tsx.
 */
export function grasaYuhasz(sum6: number | null, sexo: Sexo | null): number | null {
  if (sum6 === null || sexo === null) return null;
  const pct = sexo === 'masculino' ? 2.585 + sum6 * 0.1051 : 3.5803 + sum6 * 0.1548;
  return redondear(pct, 2);
}

/** Faulkner (1968): %G = (Σ4 × 0.153) + 5.783 — tríceps, subescapular, supraespinal, abdominal. */
export function grasaFaulkner(p: Pliegues): number | null {
  const { triceps, subescapular, supraespinal, abdominal } = p;
  if (triceps === null || subescapular === null || supraespinal === null || abdominal === null) return null;
  const s4 = triceps + subescapular + supraespinal + abdominal;
  return redondear(s4 * 0.153 + 5.783, 2);
}

/**
 * Durnin & Womersley (1974). Σ4 = bíceps + tríceps + subescapular + cresta
 * ilíaca; densidad corporal por regresión sobre log10(Σ4) con coeficientes por
 * edad y sexo, y luego Siri (495/DC − 450).
 */
export function grasaDurninWomersley(p: Pliegues, edad: number | null, sexo: Sexo | null): number | null {
  const { biceps, triceps, subescapular, crestaIliaca } = p;
  if (biceps === null || triceps === null || subescapular === null || crestaIliaca === null) return null;
  if (edad === null || sexo === null) return null;

  const log = Math.log10(biceps + triceps + subescapular + crestaIliaca);
  let dc: number;
  if (sexo === 'masculino') {
    if (edad < 20) dc = 1.162 - 0.063 * log;
    else if (edad < 30) dc = 1.1631 - 0.0632 * log;
    else if (edad < 40) dc = 1.1422 - 0.0544 * log;
    else if (edad < 50) dc = 1.162 - 0.07 * log;
    else dc = 1.1715 - 0.0779 * log;
  } else {
    if (edad < 20) dc = 1.1549 - 0.0678 * log;
    else if (edad < 30) dc = 1.1599 - 0.0717 * log;
    else if (edad < 40) dc = 1.1423 - 0.0632 * log;
    else if (edad < 50) dc = 1.1333 - 0.0612 * log;
    else dc = 1.1339 - 0.0645 * log;
  }
  if (dc <= 0) return null;
  return redondear(495 / dc - 450, 2);
}

/**
 * Tasa Metabólica Basal — Harris-Benedict revisada (Roza & Shizgal, 1984).
 *
 * Hombres: 88.362 + (13.397 × peso) + (4.799 × talla) − (5.677 × edad)
 * Mujeres: 447.593 + (9.247 × peso) + (3.098 × talla) − (4.330 × edad)
 *
 * Es la única de las fórmulas del informe que NO existía en el repo.
 */
export function calcularTmb(
  pesoKg: number | null,
  estaturaCm: number | null,
  edad: number | null,
  sexo: Sexo | null
): number | null {
  const p = pos(pesoKg);
  const e = pos(estaturaCm);
  const a = num(edad);
  if (p === null || e === null || a === null || sexo === null) return null;
  const kcal =
    sexo === 'masculino'
      ? 88.362 + 13.397 * p + 4.799 * e - 5.677 * a
      : 447.593 + 9.247 * p + 3.098 * e - 4.33 * a;
  return kcal > 0 ? Math.round(kcal) : null;
}

/**
 * Masa muscular esquelética — Lee et al. (2000), a partir de perímetros
 * corregidos por pliegue.
 *
 *   SM(kg) = talla_m × (0.00744·CAG² + 0.00088·CTG² + 0.00441·CCG²)
 *            + 2.4·sexo − 0.048·edad + 7.8
 *
 * donde CAG/CTG/CCG son los perímetros de brazo, muslo y pantorrilla corregidos
 * restando π × (pliegue/10). `sexo` = 1 masculino, 0 femenino. Se omite el
 * término de etnia (0 para la población de referencia).
 *
 * ⚠️ PROVISIONAL — la reunión no definió con qué fórmula se calcula el
 * "% Muscular" de la hoja ACC. Lee es la elección estándar cuando hay
 * perímetros corregidos, que es justo lo que captura el fisio. Confirmar con
 * Nikolay antes de imprimirlo como definitivo.
 */
export function calcularMasaMuscular(
  medidas: {
    estaturaCm: number | null;
    edad: number | null;
    sexo: Sexo | null;
    perimetroBrazoRelajado: number | null;
    perimetroMuslo: number | null;
    perimetroPantorrilla: number | null;
    pliegueTriceps: number | null;
    pliegueMusloAnterior: number | null;
    plieguePantorrilla: number | null;
  }
): number | null {
  const e = pos(medidas.estaturaCm);
  const edad = num(medidas.edad);
  const { sexo } = medidas;
  const brazo = pos(medidas.perimetroBrazoRelajado);
  const muslo = pos(medidas.perimetroMuslo);
  const pantorrilla = pos(medidas.perimetroPantorrilla);
  const plTriceps = num(medidas.pliegueTriceps);
  const plMuslo = num(medidas.pliegueMusloAnterior);
  const plPantorrilla = num(medidas.plieguePantorrilla);

  if (e === null || edad === null || sexo === null) return null;
  if (brazo === null || muslo === null || pantorrilla === null) return null;
  if (plTriceps === null || plMuslo === null || plPantorrilla === null) return null;

  // Perímetros corregidos: se descuenta la circunferencia del panículo adiposo.
  // El pliegue está en mm y el perímetro en cm, de ahí el /10.
  const cag = brazo - Math.PI * (plTriceps / 10);
  const ctg = muslo - Math.PI * (plMuslo / 10);
  const ccg = pantorrilla - Math.PI * (plPantorrilla / 10);
  if (cag <= 0 || ctg <= 0 || ccg <= 0) return null;

  const tallaM = e / 100;
  const sm =
    tallaM * (0.00744 * cag * cag + 0.00088 * ctg * ctg + 0.00441 * ccg * ccg) +
    2.4 * (sexo === 'masculino' ? 1 : 0) -
    0.048 * edad +
    7.8;

  return sm > 0 ? redondear(sm, 2) : null;
}

/** Índice cintura/cadera. Ambos en cm. */
export function calcularIcc(abdominal: number | null, cadera: number | null): number | null {
  const a = pos(abdominal);
  const c = pos(cadera);
  if (a === null || c === null) return null;
  return redondear(a / c, 2);
}

/** Índice cintura/talla. Ambos en cm. */
export function calcularIct(abdominal: number | null, estaturaCm: number | null): number | null {
  const a = pos(abdominal);
  const e = pos(estaturaCm);
  if (a === null || e === null) return null;
  return redondear(a / e, 2);
}

// ---------------------------------------------------------------------------
// Cálculo completo
// ---------------------------------------------------------------------------

function evaluado(valor: number | null, bandas: Banda[] | null): ValorEvaluado | null {
  if (valor === null) return null;
  return { valor, evaluacion: bandas ? clasificar(valor, bandas) : null };
}

/**
 * Corre todo el motor sobre un set de medidas. Nada tira: lo que no se puede
 * calcular vuelve como `null` y su razón se acumula en `faltantes`.
 *
 * Un campo vacío en el informe es aceptable; un número inventado no.
 */
export function calcularAntropometria(
  medidas: MedidasAntropometricas,
  rangos: RangosConfig = RANGOS_PROVISIONALES
): ResultadoAntropometrico {
  const faltantes: string[] = [];
  const sexo = normalizarSexo(medidas.sexo);
  const edad = num(medidas.edad);
  const estaturaCm = pos(medidas.estaturaCm);
  const pesoKg = pos(medidas.pesoKg);

  if (sexo === null) faltantes.push('sexo');
  if (edad === null) faltantes.push('edad');
  if (estaturaCm === null) faltantes.push('estatura');
  if (pesoKg === null) faltantes.push('peso');

  const pliegues: Pliegues = {
    triceps: num(medidas.pliegueTriceps),
    subescapular: num(medidas.pliegueSubescapular),
    biceps: num(medidas.pliegueBiceps),
    crestaIliaca: num(medidas.pliegueCrestaIliaca),
    supraespinal: num(medidas.pliegueSupraespinal),
    abdominal: num(medidas.pliegueAbdominal),
    musloAnterior: num(medidas.pliegueMusloAnterior),
    pantorrilla: num(medidas.plieguePantorrilla),
  };

  const sum6 = sumatoria6(pliegues);
  const sum8 = sumatoria8(pliegues);

  // Prioridad de fórmula de grasa: Yuhasz (protocolo Bodytech) > Faulkner >
  // Durnin-Womersley. Mismo orden que el panel nutricional.
  const yuhasz = grasaYuhasz(sum6, sexo);
  const faulkner = grasaFaulkner(pliegues);
  const dw = grasaDurninWomersley(pliegues, edad, sexo);

  let grasaPct: number | null = null;
  let metodoGrasa: ResultadoAntropometrico['metodoGrasa'] = null;
  if (yuhasz !== null) {
    grasaPct = yuhasz;
    metodoGrasa = 'yuhasz';
  } else if (faulkner !== null) {
    grasaPct = faulkner;
    metodoGrasa = 'faulkner';
  } else if (dw !== null) {
    grasaPct = dw;
    metodoGrasa = 'durnin-womersley';
  } else {
    faltantes.push('pliegues');
  }

  const masaGrasaKg =
    grasaPct !== null && pesoKg !== null ? redondear((pesoKg * grasaPct) / 100, 2) : null;
  const masaLibreGrasaKg =
    masaGrasaKg !== null && pesoKg !== null ? redondear(pesoKg - masaGrasaKg, 2) : null;

  // Brazo y muslo: se promedian los dos lados si están ambos; si hay uno solo,
  // se usa ese. La hoja ACC pide izquierdo y derecho por separado.
  const brazoRelajado = promedio(
    num(medidas.perimetroBrazoRelajadoDer),
    num(medidas.perimetroBrazoRelajadoIzq)
  );
  const muslo = promedio(num(medidas.perimetroMusloDer), num(medidas.perimetroMusloIzq));

  const pesoMuscularKg = calcularMasaMuscular({
    estaturaCm,
    edad,
    sexo,
    perimetroBrazoRelajado: brazoRelajado,
    perimetroMuslo: muslo,
    perimetroPantorrilla: num(medidas.perimetroPantorrilla),
    pliegueTriceps: pliegues.triceps,
    pliegueMusloAnterior: pliegues.musloAnterior,
    plieguePantorrilla: pliegues.pantorrilla,
  });
  if (pesoMuscularKg === null) faltantes.push('perímetros para masa muscular');

  const porcentajeMuscularVal =
    pesoMuscularKg !== null && pesoKg !== null
      ? redondear((pesoMuscularKg / pesoKg) * 100, 2)
      : null;

  const imc = calcularImc(pesoKg, estaturaCm);
  // IMM: índice de masa muscular = masa muscular / talla². Mismo espíritu que el IMC.
  const imm =
    pesoMuscularKg !== null && estaturaCm !== null
      ? redondear(pesoMuscularKg / (estaturaCm / 100) ** 2, 2)
      : null;

  const perimetroAbdominal = num(medidas.perimetroAbdominal);
  const icc = calcularIcc(perimetroAbdominal, num(medidas.perimetroCadera));
  const ict = calcularIct(perimetroAbdominal, estaturaCm);
  const tmb = calcularTmb(pesoKg, estaturaCm, edad, sexo);

  const esM = sexo === 'masculino';

  return {
    imc: evaluado(imc, rangos.imc),
    porcentajeGrasa: evaluado(grasaPct, esM ? rangos.grasaMasculino : rangos.grasaFemenino),
    porcentajeMuscular: evaluado(
      porcentajeMuscularVal,
      sexo === null ? null : esM ? rangos.muscularMasculino : rangos.muscularFemenino
    ),
    pesoMuscularKg,
    masaGrasaKg,
    masaLibreGrasaKg,
    imm,
    // La TMB no tiene "bajo/alto" clínico: se reporta como referencia.
    tmbKcal: evaluado(tmb, null),
    icc: evaluado(icc, sexo === null ? null : esM ? rangos.iccMasculino : rangos.iccFemenino),
    ict: evaluado(ict, rangos.ict),
    perimetroAbdominal: evaluado(
      perimetroAbdominal,
      sexo === null
        ? null
        : esM
          ? rangos.perimetroAbdominalMasculino
          : rangos.perimetroAbdominalFemenino
    ),
    sumatoria6: sum6,
    sumatoria8: sum8,
    metodoGrasa,
    faltantes,
  };
}

/** Promedio de los lados medidos. Null solo si no hay ninguno. */
function promedio(a: number | null, b: number | null): number | null {
  if (a !== null && b !== null) return redondear((a + b) / 2, 2);
  return a !== null ? a : b;
}
