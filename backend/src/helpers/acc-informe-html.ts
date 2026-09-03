// ============================================================================
// acc-informe-html — la "Hoja de Valoración ACC" que se entrega al paciente.
//
// Renderiza el HTML que `pdf.service.htmlToPdf()` convierte en PDF. Réplica del
// modelo aprobado en la reunión de validación (informe_valoracion_bodytech_v4):
//   Página 1 — cabecera, DIANA de evaluación corporal, tabla de composición
//   Página 2 — perímetros y pliegues medidos, observaciones, firma
//
// SIN RECURSOS EXTERNOS: todo va inline (estilos y SVG). El HTML se carga con
// `setContent` en un Chromium sin red, así que una fuente o una imagen remota
// saldría en blanco.
//
// LA DIANA
// --------
// El título del modelo es "OBJETIVO VS. REGISTRADO", así que no son anillos
// decorativos: el polígono verde es el RANGO NORMAL de cada eje y el oscuro es
// el paciente. Cada eje tiene su propia escala (un IMC de 25 y un ICC de 0.9 no
// comparten unidades), y el rango normal de varios depende del sexo — y el del
// peso, de la estatura. Por eso las escalas se construyen por paciente y no son
// una constante.
// ============================================================================

import type { Evaluacion } from './antropometria';

export interface DatosInforme {
  nombreCompleto: string;
  numeroId: string;
  edad: number | null;
  sexo: 'masculino' | 'femenino' | null;
  estaturaCm: number | null;
  pesoKg: number | null;
  fechaEvaluacion: string;
  evaluador: string | null;
  sede: string | null;

  imc: number | null;
  imcEstado: Evaluacion | null;
  pctGrasa: number | null;
  grasaEstado: Evaluacion | null;
  metodoGrasa: string | null;
  pctMuscular: number | null;
  muscularEstado: Evaluacion | null;
  pesoMuscularKg: number | null;
  masaGrasaKg: number | null;
  masaLibreGrasaKg: number | null;
  imm: number | null;
  tmbKcal: number | null;
  icc: number | null;
  iccEstado: Evaluacion | null;
  ict: number | null;
  ictEstado: Evaluacion | null;
  perimetroAbdominal: number | null;
  perimetroAbdominalEstado: Evaluacion | null;
  perimetroCadera: number | null;
  sumatoria6: number | null;
  sumatoria8: number | null;

  perimetros: Array<{ label: string; valor: number | null; unidad: string }>;
  pliegues: Array<{ label: string; valor: number | null }>;
  observaciones: string | null;
}

const AZUL = '#1B2233';
const MAGENTA = '#D6005A';
const VERDE = '#0B7355';
const TINTA = '#14192A';
const GRIS = '#6B7280';
const LINEA = '#DBDFE8';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(v: number | null, decimales = 1, sufijo = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(decimales)}${sufijo}`;
}

function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]} / ${m[2]} / ${m[1]}` : iso;
}

const ETIQUETA_EVAL: Record<Evaluacion, string> = {
  bajo: 'BAJO',
  normal: 'NORMAL',
  alto: 'ALTO',
  optimo: 'ÓPTIMO',
};

function badge(e: Evaluacion | null): string {
  if (!e) return '<span class="badge badge-na">SIN DATO</span>';
  return `<span class="badge badge-${e}">${ETIQUETA_EVAL[e]}</span>`;
}

// ---------------------------------------------------------------------------
// Diana
// ---------------------------------------------------------------------------

interface EjeDiana {
  label: string;
  valor: number | null;
  min: number;
  max: number;
  normalMin: number;
  normalMax: number;
  texto: string;
}

/**
 * Construye los seis ejes con la escala que corresponde a ESTE paciente.
 *
 * El eje de peso no tiene rango normal propio: se deriva de la estatura, que es
 * lo único que vuelve interpretable un peso suelto (el rango normal de peso es
 * el que deja el IMC entre 18.5 y 25).
 */
function construirEjes(d: DatosInforme): EjeDiana[] {
  const esM = d.sexo === 'masculino';
  const tallaM = d.estaturaCm ? d.estaturaCm / 100 : null;

  const pesoNormalMin = tallaM ? 18.5 * tallaM * tallaM : 50;
  const pesoNormalMax = tallaM ? 25 * tallaM * tallaM : 80;

  return [
    {
      label: '% Grasa',
      valor: d.pctGrasa,
      min: esM ? 2 : 8,
      max: esM ? 40 : 50,
      normalMin: esM ? 6 : 14,
      normalMax: esM ? 18 : 25,
      texto: fmt(d.pctGrasa, 2, '%'),
    },
    {
      label: 'IMC',
      valor: d.imc,
      min: 15,
      max: 40,
      normalMin: 18.5,
      normalMax: 25,
      texto: fmt(d.imc, 2, ' kg/m²'),
    },
    {
      label: 'Peso total',
      valor: d.pesoKg,
      min: Math.max(pesoNormalMin - 25, 0),
      max: pesoNormalMax + 45,
      normalMin: pesoNormalMin,
      normalMax: pesoNormalMax,
      texto: fmt(d.pesoKg, 1, ' kg'),
    },
    {
      label: 'Cintura / cadera',
      valor: d.icc,
      min: 0.6,
      max: 1.2,
      normalMin: 0.7,
      normalMax: esM ? 0.9 : 0.85,
      texto: fmt(d.icc, 2),
    },
    {
      label: 'P. abdominal',
      valor: d.perimetroAbdominal,
      min: 55,
      max: 130,
      normalMin: 60,
      normalMax: esM ? 94 : 80,
      texto: fmt(d.perimetroAbdominal, 1, ' cm'),
    },
    {
      label: '% Muscular',
      valor: d.pctMuscular,
      min: esM ? 20 : 15,
      max: esM ? 55 : 45,
      normalMin: esM ? 33 : 24,
      normalMax: esM ? 40 : 31,
      texto: fmt(d.pctMuscular, 2, '%'),
    },
  ];
}

/** SVG de la diana. El viewBox deja aire para las etiquetas exteriores. */
function dianaSvg(ejes: EjeDiana[]): string {
  const CX = 300;
  const CY = 255;
  const R = 150;
  const R_MIN = 26; // el centro nunca se colapsa a un punto

  const n = ejes.length;
  // −90° para que el primer eje quede arriba.
  const ang = (i: number) => (i * 2 * Math.PI) / n - Math.PI / 2;

  const radio = (e: EjeDiana, v: number) => {
    const t = (v - e.min) / (e.max - e.min);
    const clamped = Math.max(0, Math.min(1, t));
    return R_MIN + clamped * (R - R_MIN);
  };

  const punto = (i: number, r: number) => {
    const a = ang(i);
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
  };

  const poligono = (radios: number[]) =>
    radios
      .map((r, i) => {
        const [x, y] = punto(i, r);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const anilloNormal = `
    <polygon points="${poligono(ejes.map((e) => radio(e, e.normalMax)))}"
             fill="${VERDE}" fill-opacity="0.13" stroke="${VERDE}"
             stroke-width="1.5" stroke-dasharray="4 3" />
    <polygon points="${poligono(ejes.map((e) => radio(e, e.normalMin)))}"
             fill="#FFFFFF" stroke="${VERDE}" stroke-width="1"
             stroke-dasharray="3 3" stroke-opacity="0.6" />`;

  const conValor = ejes.every((e) => e.valor !== null);
  const poligonoPaciente = conValor
    ? `<polygon points="${poligono(ejes.map((e) => radio(e, e.valor as number)))}"
                fill="${AZUL}" fill-opacity="0.18" stroke="${AZUL}" stroke-width="2.2"
                stroke-linejoin="round" />`
    : '';

  const radiosYEtiquetas = ejes
    .map((e, i) => {
      const [xe, ye] = punto(i, R);
      const [xl, yl] = punto(i, R + 34);
      const a = ang(i);
      // La etiqueta se ancla según de qué lado del círculo caiga, para que
      // nunca se monte sobre el dibujo.
      const cos = Math.cos(a);
      const anchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end';
      const dy = Math.sin(a) > 0.7 ? 10 : Math.sin(a) < -0.7 ? -4 : 0;

      const dot =
        e.valor !== null
          ? (() => {
              const [px, py] = punto(i, radio(e, e.valor as number));
              return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.6" fill="${MAGENTA}" />`;
            })()
          : '';

      return `
        <line x1="${CX}" y1="${CY}" x2="${xe.toFixed(1)}" y2="${ye.toFixed(1)}"
              stroke="${LINEA}" stroke-width="1" />
        ${dot}
        <text x="${xl.toFixed(1)}" y="${(yl + dy).toFixed(1)}" text-anchor="${anchor}"
              font-size="10.5" font-weight="600" fill="${TINTA}">${esc(e.label)}</text>
        <text x="${xl.toFixed(1)}" y="${(yl + dy + 12).toFixed(1)}" text-anchor="${anchor}"
              font-size="9.5" fill="${GRIS}">${esc(e.texto)}</text>`;
    })
    .join('');

  return `
  <svg viewBox="0 0 600 470" width="100%" role="img"
       aria-label="Diana de evaluación antropométrica">
    <text x="${CX}" y="26" text-anchor="middle" font-size="10"
          letter-spacing="1.2" font-weight="600" fill="${GRIS}">
      DIANA DE EVALUACIÓN ANTROPOMÉTRICA
    </text>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="#FFFFFF" stroke="${LINEA}" stroke-width="1" />
    ${anilloNormal}
    ${radiosYEtiquetas}
    ${poligonoPaciente}

    <g transform="translate(${CX - 118}, 438)">
      <rect x="0" y="-8" width="13" height="10" fill="${VERDE}" fill-opacity="0.13"
            stroke="${VERDE}" stroke-width="1.2" stroke-dasharray="3 2" />
      <text x="19" y="1" font-size="9.5" fill="${GRIS}">Rango objetivo</text>
      <rect x="118" y="-8" width="13" height="10" fill="${AZUL}" fill-opacity="0.18"
            stroke="${AZUL}" stroke-width="1.5" />
      <text x="137" y="1" font-size="9.5" fill="${GRIS}">Registrado</text>
    </g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

interface FilaResultado {
  variable: string;
  dato: string;
  definicion: string;
  evaluacion: Evaluacion | null;
}

function filasComposicion(d: DatosInforme): FilaResultado[] {
  return [
    {
      variable: 'Peso (kg)',
      dato: fmt(d.pesoKg, 2, ' kg'),
      definicion: 'Permite conocer la modificación del peso en cada control y con las diferentes intervenciones.',
      evaluacion: null,
    },
    {
      variable: 'Índice de Masa Corporal (IMC)',
      dato: fmt(d.imc, 2, ' kg/m²'),
      definicion: 'Peso / (talla × talla); relación del peso para la talla (bajo peso, normal, sobrepeso, obesidad).',
      evaluacion: d.imcEstado,
    },
    {
      variable: 'Porcentaje graso (% PGC)',
      dato: fmt(d.pctGrasa, 2, '%'),
      definicion: `% del peso total que equivale a masa grasa (${fmt(d.masaGrasaKg, 2, ' kg')}).`,
      evaluacion: d.grasaEstado,
    },
    {
      variable: 'Porcentaje muscular (% PME)',
      dato: fmt(d.pctMuscular, 2, '%'),
      definicion: '% del peso total que equivale a masa muscular esquelética.',
      evaluacion: d.muscularEstado,
    },
    {
      variable: 'Peso muscular (kg)',
      dato: fmt(d.pesoMuscularKg, 2, ' kg'),
      definicion: '% muscular × peso total (masa muscular esquelética total).',
      evaluacion: null,
    },
    {
      variable: 'Índice de Masa Muscular (IMM)',
      dato: fmt(d.imm, 2, ' kg/m²'),
      definicion: 'Peso muscular / (talla × talla); relación de la masa muscular para la talla.',
      evaluacion: null,
    },
    {
      variable: 'Tasa Metabólica Basal (TMB)',
      dato: d.tmbKcal !== null ? `${d.tmbKcal.toLocaleString('es-CO')} kcal` : '—',
      definicion: 'Establecida por la fórmula de Harris-Benedict (gasto energético en reposo).',
      evaluacion: null,
    },
    {
      variable: 'Perímetro abdominal',
      dato: fmt(d.perimetroAbdominal, 1, ' cm'),
      definicion: 'Indicador de grasa visceral y riesgo cardiometabólico.',
      evaluacion: d.perimetroAbdominalEstado,
    },
    {
      variable: 'Índice cintura / cadera (ICC)',
      dato: fmt(d.icc, 2),
      definicion: `Perímetro abdominal / perímetro de cadera (${fmt(d.perimetroCadera, 1, ' cm')}).`,
      evaluacion: d.iccEstado,
    },
    {
      variable: 'Índice cintura / talla (ICT)',
      dato: fmt(d.ict, 2),
      definicion: 'Perímetro abdominal / estatura. El umbral de referencia es 0.50.',
      evaluacion: d.ictEstado,
    },
  ];
}

const METODO_GRASA: Record<string, string> = {
  yuhasz: 'Yuhasz (sumatoria de 6 pliegues)',
  faulkner: 'Faulkner (sumatoria de 4 pliegues)',
  'durnin-womersley': 'Durnin & Womersley (densidad corporal)',
};

export function construirInformeAccHtml(d: DatosInforme): string {
  const ejes = construirEjes(d);
  const sexoTexto = d.sexo === 'masculino' ? 'Masculino' : d.sexo === 'femenino' ? 'Femenino' : '—';

  const filas = filasComposicion(d)
    .map(
      (f) => `
      <tr>
        <td class="var">${esc(f.variable)}</td>
        <td class="dato">${esc(f.dato)}</td>
        <td class="def">${esc(f.definicion)}</td>
        <td class="eval">${badge(f.evaluacion)}</td>
      </tr>`
    )
    .join('');

  const perimetros = d.perimetros
    .map(
      (p) => `
      <tr><td>${esc(p.label)}</td><td class="n">${fmt(p.valor, 1, ` ${p.unidad}`)}</td></tr>`
    )
    .join('');

  const pliegues = d.pliegues
    .map((p) => `<tr><td>${esc(p.label)}</td><td class="n">${fmt(p.valor, 1, ' mm')}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Hoja de Valoración ACC — ${esc(d.nombreCompleto)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5px;
    line-height: 1.5;
    color: ${TINTA};
    background: #FFFFFF;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 16mm 14mm; }
  .page + .page { page-break-before: always; }

  .cabecera {
    background: ${AZUL};
    color: #FFFFFF;
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid ${MAGENTA};
  }
  .marca { font-size: 21px; font-weight: 700; letter-spacing: 0.02em; }
  .marca small {
    display: block;
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: ${MAGENTA};
    margin-top: 3px;
  }
  .titulo { text-align: right; font-size: 14px; font-weight: 600; }
  .titulo small {
    display: block;
    font-size: 8.5px;
    font-weight: 400;
    color: #B9C0CE;
    margin-top: 4px;
  }

  .identificacion {
    display: flex;
    gap: 18px;
    border: 1px solid ${LINEA};
    border-top: none;
    padding: 12px 20px;
    margin-bottom: 20px;
  }
  .campo { flex: 1; }
  .campo .k {
    font-size: 7.5px;
    letter-spacing: 0.1em;
    color: ${GRIS};
    font-weight: 600;
    margin-bottom: 2px;
  }
  .campo .v { font-size: 11px; font-weight: 600; }

  h2 {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin: 0 0 10px;
    padding-left: 8px;
    border-left: 3px solid ${MAGENTA};
  }

  .caja { border: 1px solid ${LINEA}; padding: 8px 10px 4px; margin-bottom: 20px; }

  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    font-size: 7.5px;
    letter-spacing: 0.09em;
    color: ${GRIS};
    font-weight: 700;
    padding: 7px 8px;
    border-bottom: 1px solid ${LINEA};
    background: #F5F6F9;
  }
  td { padding: 7px 8px; border-bottom: 1px solid #EEF0F4; vertical-align: top; }
  td.var { font-weight: 600; width: 27%; }
  td.dato { font-weight: 700; width: 15%; white-space: nowrap; }
  td.def { color: ${GRIS}; font-size: 9px; }
  td.eval { width: 15%; text-align: right; white-space: nowrap; }
  td.n { text-align: right; font-weight: 600; white-space: nowrap; }

  .badge {
    display: inline-block;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 3px 7px;
    border-radius: 9px;
  }
  .badge-normal { background: #E0F2EB; color: ${VERDE}; }
  .badge-optimo { background: #E0F2EB; color: ${VERDE}; }
  .badge-bajo   { background: #FBEEDC; color: #96550A; }
  .badge-alto   { background: #FCE4E8; color: #A3123F; }
  .badge-na     { background: #F0F1F4; color: ${GRIS}; }

  .dos-columnas { display: flex; gap: 18px; }
  .dos-columnas > div { flex: 1; }

  .nota {
    font-size: 8.5px;
    color: ${GRIS};
    border-top: 1px solid ${LINEA};
    padding-top: 8px;
    margin-top: 14px;
  }
  .firma {
    margin-top: 42px;
    display: flex;
    gap: 40px;
  }
  .firma > div { flex: 1; border-top: 1px solid ${TINTA}; padding-top: 5px; font-size: 8.5px; color: ${GRIS}; }
  .obs {
    border: 1px solid ${LINEA};
    min-height: 58px;
    padding: 9px 11px;
    font-size: 9.5px;
    white-space: pre-wrap;
  }
</style>
</head>
<body>

<div class="page">
  <div class="cabecera">
    <div class="marca">BODYTECH<small>ANÁLISIS DE COMPOSICIÓN CORPORAL</small></div>
    <div class="titulo">HOJA DE VALORACIÓN ACC<small>Fecha: ${esc(fechaLarga(d.fechaEvaluacion))}</small></div>
  </div>

  <div class="identificacion">
    <div class="campo"><div class="k">NOMBRE COMPLETO</div><div class="v">${esc(d.nombreCompleto)}</div></div>
    <div class="campo"><div class="k">CÉDULA / ID</div><div class="v">${esc(d.numeroId)}</div></div>
    <div class="campo"><div class="k">EDAD / SEXO</div><div class="v">${d.edad ?? '—'} años · ${esc(sexoTexto)}</div></div>
    <div class="campo"><div class="k">ESTATURA</div><div class="v">${fmt(d.estaturaCm, 0, ' cm')}</div></div>
    <div class="campo"><div class="k">EVALUADOR / SEDE</div><div class="v">${esc(d.evaluador || '—')}${d.sede ? ` · ${esc(d.sede)}` : ''}</div></div>
  </div>

  <h2>1. DIANA DE EVALUACIÓN CORPORAL (OBJETIVO VS. REGISTRADO)</h2>
  <div class="caja">${dianaSvg(ejes)}</div>

  <h2>2. RESULTADOS DE COMPOSICIÓN CORPORAL</h2>
  <table>
    <thead>
      <tr>
        <th>Variable / métrica</th>
        <th>Dato registrado</th>
        <th>Descripción / definición del parámetro</th>
        <th style="text-align:right">Evaluación</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
</div>

<div class="page">
  <h2>3. MEDIDAS REGISTRADAS</h2>
  <div class="dos-columnas">
    <div>
      <table>
        <thead><tr><th>Perímetro</th><th style="text-align:right">Medida</th></tr></thead>
        <tbody>${perimetros}</tbody>
      </table>
    </div>
    <div>
      <table>
        <thead><tr><th>Pliegue cutáneo</th><th style="text-align:right">Medida</th></tr></thead>
        <tbody>
          ${pliegues}
          <tr><td><strong>Sumatoria 6 pliegues</strong></td><td class="n">${fmt(d.sumatoria6, 1, ' mm')}</td></tr>
          <tr><td><strong>Sumatoria 8 pliegues</strong></td><td class="n">${fmt(d.sumatoria8, 1, ' mm')}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div style="margin-top:22px">
    <h2>4. OBSERVACIONES</h2>
    <div class="obs">${esc(d.observaciones || '')}</div>
  </div>

  <div class="nota">
    El porcentaje graso se calculó con ${esc(
      d.metodoGrasa ? METODO_GRASA[d.metodoGrasa] || d.metodoGrasa : 'los pliegues registrados'
    )}.
    La masa muscular esquelética se estimó por perímetros corregidos (Lee et al., 2000) y la tasa
    metabólica basal por Harris-Benedict revisada.
    Masa grasa ${fmt(d.masaGrasaKg, 2, ' kg')} · masa libre de grasa ${fmt(d.masaLibreGrasaKg, 2, ' kg')}.
    <br><br>
    Este informe describe la composición corporal registrada en la fecha indicada y no constituye
    un diagnóstico médico.
  </div>

  <div class="firma">
    <div>Evaluador — ${esc(d.evaluador || '')}</div>
    <div>Firma del paciente</div>
  </div>
</div>

</body>
</html>`;
}

export default construirInformeAccHtml;
