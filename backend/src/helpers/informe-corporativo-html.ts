// ============================================================================
// El HTML del informe corporativo, que Puppeteer convierte en PDF.
//
// Sigue el documento que Bodytech ya le entrega a las empresas: portada, tabla
// de contenido, introducción, alcance, objetivos, metodología, resultados,
// conclusiones y recomendaciones. Se respetó ese orden a propósito — el cliente
// ya sabe leerlo, y cambiarlo obligaría a explicar un formato nuevo.
//
// El texto fijo (introducción, alcance, objetivos, metodología) es plantilla:
// cambia la empresa y el periodo. Los párrafos de análisis los redacta la
// plataforma y el informe dice que son un borrador para revisión médica.
// ============================================================================

import type { DatosInforme } from '../services/informe-corporativo.service';
import type { Redaccion } from '../services/informe-corporativo-redaccion.service';
import { torta, barras, barrasDobles, coloresDe } from './informe-corporativo-charts';

const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "abril de 2026" a partir de un rango. Si cruza meses, los nombra los dos. */
function periodoLegible(desde: string, hasta: string): string {
  const d = new Date(`${desde}T12:00:00`);
  const h = new Date(`${hasta}T12:00:00`);
  const uno = `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  const dos = `${MESES[h.getMonth()]} de ${h.getFullYear()}`;
  return uno === dos ? uno : `${uno} a ${dos}`;
}

/** Un párrafo de análisis, o el hueco marcado para que el médico lo escriba. */
function analisis(texto: string | undefined): string {
  return texto
    ? `<p class="analisis">${esc(texto)}</p>`
    : `<p class="analisis pendiente">Análisis pendiente de redacción médica.</p>`;
}

export function informeCorporativoHtml(datos: DatosInforme, r: Redaccion | null): string {
  const periodo = periodoLegible(datos.desde, datos.hasta);
  const o = datos.oportunidad;

  const pct = (n: number, total: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0');

  // Los diagnósticos se agrupan: más de siete porciones en una torta no se
  // distinguen ni con leyenda. Lo que queda afuera se suma en "Otros" y no
  // desaparece: los porcentajes tienen que seguir sumando 100.
  const dxOrdenados = [...datos.diagnosticos].sort((a, b) => b.valor - a.valor);
  const dx = dxOrdenados.slice(0, 7);
  const resto = dxOrdenados.slice(7).reduce((a, d) => a + d.valor, 0);
  if (resto > 0) dx.push({ etiqueta: `Otros (${dxOrdenados.length - 7})`, valor: resto });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Informe médico corporativo · ${esc(datos.empresa)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #23262b; font-size: 11.5pt; line-height: 1.55; margin: 0;
  }
  .franja { display: flex; height: 7px; margin-bottom: 22px; }
  .franja span { flex: 1; }
  h1 { font-size: 26pt; text-align: center; margin: 60mm 0 8mm; line-height: 1.25; }
  h2 { font-size: 15pt; color: #c05621; margin: 0 0 10px; page-break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 22px 0 8px; page-break-after: avoid; }
  p { margin: 0 0 11px; text-align: justify; }
  .portada { text-align: center; page-break-after: always; }
  .portada .pie { margin-top: 70mm; font-weight: 700; line-height: 1.7; }
  .seccion { page-break-before: always; }
  .analisis { margin-top: 6px; }
  .pendiente { color: #8b929b; font-style: italic; }
  .aviso {
    background: #fbf3e6; border-left: 3px solid #c05621; padding: 10px 14px;
    font-size: 10pt; color: #5f6670; margin: 0 0 18px; text-align: left;
  }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 6px; font-size: 10.5pt; }
  th, td { border: 1px solid #23262b; padding: 7px 9px; text-align: left; }
  th { background: #f6d5b8; font-weight: 700; }
  tfoot td { font-weight: 700; background: #fbeee1; }
  caption { caption-side: bottom; font-size: 9.5pt; font-weight: 700; padding-top: 6px; text-align: left; }
  .graf { margin: 16px 0 22px; page-break-inside: avoid; }
  .graf figcaption { font-size: 9.5pt; font-weight: 700; margin-bottom: 6px; }
  .graf svg { max-width: 100%; height: auto; }
  .graf-cuerpo { display: flex; align-items: center; gap: 18px; }
  .graf-cuerpo svg { width: 235px; flex: 0 0 auto; }
  .leyenda { font-size: 10pt; line-height: 1.9; }
  .leyenda-fila { display: flex; gap: 18px; margin-bottom: 4px; }
  .li { display: flex; align-items: center; gap: 7px; }
  .sw { width: 11px; height: 11px; border-radius: 3px; flex: 0 0 auto; }
  .graf-vacia p { color: #8b929b; font-style: italic; font-size: 10.5pt; }
  ul { margin: 0 0 12px; padding-left: 20px; }
  li { margin-bottom: 6px; }
  .dato-fuerte { font-weight: 700; }
</style></head><body>

<section class="portada">
  <h1>INFORME MÉDICO CORPORATIVO<br>${esc(datos.empresa.toUpperCase())} · BODYTECH</h1>
  <div class="pie">
    BODYTECH — INVERSIONES EN RECREACIÓN Y DEPORTE<br>
    NIT: 830033206-3<br>
    Medicina del Deporte<br>
    Bogotá, ${periodo}
  </div>
</section>

<div class="franja"><span style="background:#cbb994"></span><span style="background:#a8e5dc"></span><span style="background:#f4703a"></span><span style="background:#5f5a4e"></span></div>

<section>
  <h2>1. Introducción</h2>
  <p>INVERSIONES EN RECREACIÓN, DEPORTE Y SALUD S.A. — BODYTECH es una Institución
  Prestadora de Salud (IPS) de primer nivel que opera como cadena premium en la oferta de
  servicios médico-deportivos, con el objetivo de promover y mejorar la calidad de vida de las
  personas a través de la prescripción profesional del ejercicio y la promoción de estilos de
  vida saludables para prevenir enfermedades cardiovasculares y osteomusculares.</p>
  <p>Trabajando en conjunto con el área de bienestar de <b>${esc(datos.empresa)}</b>, se ha
  propendido por la identificación temprana de condiciones prevenibles o intervenibles que
  permitan impactar en la salud de los colaboradores de la compañía. A continuación se presenta
  el informe de diagnóstico de la población atendida en consulta por el médico del deporte
  durante ${periodo}.</p>

  <h2>2. Alcance</h2>
  <p>El servicio de consulta con evaluación clínica por parte de medicina del deporte se prestó a
  los colaboradores de ${esc(datos.empresa)} de forma seleccionada. La población asistente fue
  categorizada según su nivel de riesgo en las categorías bajo, medio y alto, según la presencia
  y evolución de los factores de riesgo cardiovascular o por la presencia de alguna patología
  osteomuscular o procedimiento quirúrgico que requiera seguimiento específico.</p>

  <h2>3. Objetivo general</h2>
  <p>Identificar en la población evaluada de ${esc(datos.empresa)} a aquellos colaboradores con
  factores de riesgo cardiovascular según sus antecedentes y hallazgos clínicos en la valoración,
  así como su distribución por edad, para definir aptitud en la realización de actividad física y
  mitigar estos indicadores de riesgo.</p>

  <h2>4. Metodología</h2>
  <p>Para la identificación del riesgo se realizó una valoración por el servicio de medicina del
  deporte, enfocada en signos y síntomas sugestivos de riesgo durante la actividad —dolor
  torácico, disnea, síncope, palpitaciones, edema de miembros inferiores o claudicación
  intermitente—. Se abordaron antecedentes personales y familiares, y se realizó examen físico
  con énfasis en el sistema cardiovascular y osteomuscular, con análisis de composición corporal
  como complemento. Toda la información queda consignada en la historia clínica de cada
  colaborador, de donde se consolidan las cifras de este informe.</p>
</section>

<section class="seccion">
  <h2>5. Resultados</h2>
  ${r ? '<p class="aviso">Los análisis de este informe son un borrador redactado por la plataforma a partir de las cifras consolidadas. Deben ser revisados y avalados por el médico del deporte antes de su entrega.</p>' : ''}

  <h3>5.1. Oportunidad de atención</h3>
  <table>
    <caption>Tabla 1. Ocupación de la agenda del área médica</caption>
    <thead><tr><th>Servicio</th><th>Citas agendadas</th><th>Citas efectivas</th><th>Cumplimiento</th></tr></thead>
    <tbody><tr><td>Medicina del deporte</td><td>${o.agendadas}</td><td>${o.efectivas}</td><td>${o.cumplimiento.toFixed(2)}%</td></tr></tbody>
    <tfoot><tr><td>Total</td><td>${o.agendadas}</td><td>${o.efectivas}</td><td>${o.cumplimiento.toFixed(2)}%</td></tr></tfoot>
  </table>
  <table>
    <caption>Tabla 2. Inasistencias del área médica</caption>
    <thead><tr><th>Servicio</th><th>Citas agendadas</th><th>Inasistencias</th><th>Porcentaje</th></tr></thead>
    <tbody><tr><td>Medicina del deporte</td><td>${o.agendadas}</td><td>${o.inasistencias}</td><td>${pct(o.inasistencias, o.agendadas)}%</td></tr></tbody>
  </table>
  ${analisis(r?.oportunidad)}

  <h3>5.2. Pacientes valorados por medicina del deporte</h3>
  <p>El total de la población evaluada fue de <span class="dato-fuerte">${datos.total}</span>
  ${datos.total === 1 ? 'persona' : 'personas'}.</p>
  ${torta(datos.genero, coloresDe('categorico', datos.genero.map((g) => g.etiqueta)), 'Gráfica 1. Distribución poblacional por sexo')}
  <table>
    <caption>Tabla 3. Edad de la población evaluada</caption>
    <thead><tr><th>Edad mínima</th><th>Edad máxima</th><th>Promedio</th></tr></thead>
    <tbody><tr><td>${datos.edad.minima ?? '—'}</td><td>${datos.edad.maxima ?? '—'}</td><td>${datos.edad.promedio ?? '—'}</td></tr></tbody>
  </table>
  ${barrasDobles(datos.edadPorGenero.map((e) => ({ etiqueta: e.rango, femenino: e.femenino, masculino: e.masculino })), 'Gráfica 2. Distribución por rango de edad y sexo')}
  ${analisis(r?.demografia)}
</section>

<section class="seccion">
  <h3>5.3. Clasificación por índice de masa corporal (IMC)</h3>
  <p>El índice de masa corporal relaciona el peso en kilogramos dividido por el cuadrado de la
  estatura en metros, y clasifica el estado de peso en bajo peso, normopeso, sobrepeso y obesidad.</p>
  ${torta(datos.imc, coloresDe('imc', datos.imc.map((d) => d.etiqueta)), 'Gráfica 3. Clasificación según IMC')}
  ${barrasDobles(datos.imcPorGenero.map((e) => ({ etiqueta: e.clase, femenino: e.femenino, masculino: e.masculino })), 'Gráfica 4. Relación entre IMC y sexo')}
  ${analisis(r?.imc)}
</section>

<section class="seccion">
  <h3>5.4. Actividad física y salud</h3>
  <p>La Organización Mundial de la Salud recomienda entre 150 y 300 minutos semanales de
  actividad física aeróbica de intensidad moderada, o 75 minutos semanales de actividad
  vigorosa, para todos los adultos.</p>
  ${torta(datos.actividad, coloresDe('actividad', datos.actividad.map((d) => d.etiqueta)), 'Gráfica 5. Cumplimiento de las recomendaciones de actividad física de la OMS')}
  ${barrasDobles(datos.horasEjercicioPorGenero.map((e) => ({ etiqueta: e.horas, femenino: e.femenino, masculino: e.masculino })), 'Gráfica 6. Horas de ejercicio a la semana, por sexo')}
  ${analisis(r?.actividad)}

  <h3>5.4.1. Comportamiento sedentario</h3>
  <p>El comportamiento sedentario se define como aquellas actividades que representan un bajo
  gasto energético, menor a 1,5 MET, como permanecer sentado o acostado. Es un factor de riesgo
  autónomo, incluso en personas que cumplen los mínimos de actividad física.</p>
  ${barras(datos.sedentario.map((s) => ({ etiqueta: `${s.etiqueta} h`, valor: s.valor })), datos.sedentario.map(() => '#4a3aa7'), 'Gráfica 7. Horas de comportamiento sedentario al día', 'Cantidad de personas')}
  ${analisis(r?.sedentarismo)}
</section>

<section class="seccion">
  <h3>5.4.2. Aptitud para el entrenamiento</h3>
  <p>Los colaboradores evaluados se clasifican según su condición médica, nivel de
  acondicionamiento y antecedentes clínicos en: apto, apto con recomendaciones, apto con
  restricciones, pendiente de aptitud y no apto.</p>
  ${torta(datos.aptitud, coloresDe('aptitud', datos.aptitud.map((d) => d.etiqueta)), 'Gráfica 8. Aptitud para el entrenamiento')}
  ${analisis(r?.aptitud)}

  <h3>5.4.3. Nivel de entrenamiento</h3>
  <p>Clasificación realizada en consulta médica según el cumplimiento de las recomendaciones de
  actividad física, el tiempo que lleva realizándola y el tipo de ejercicio que practica.</p>
  ${torta(datos.nivel, coloresDe('nivel', datos.nivel.map((d) => d.etiqueta)), 'Gráfica 9. Nivel de entrenamiento')}
  ${analisis(r?.nivel)}
</section>

<section class="seccion">
  <h3>5.4.4. Clasificación de riesgo</h3>
  <p>Bodytech estratifica el riesgo clínico de cada colaborador de cara a la realización de
  ejercicio de manera segura, según los hallazgos de la consulta, los antecedentes y el examen
  físico.</p>
  ${torta(datos.riesgo, coloresDe('riesgo', datos.riesgo.map((d) => d.etiqueta)), 'Gráfica 10. Clasificación de riesgo cardiovascular y osteomuscular')}
  ${analisis(r?.riesgo)}

  <h3>5.4.5. Diagnósticos principales</h3>
  ${torta(dx, coloresDe('categorico', dx.map((d) => d.etiqueta)), 'Gráfica 11. Diagnósticos osteomusculares')}
  ${analisis(r?.diagnosticos)}
</section>

<section class="seccion">
  <h2>6. Conclusiones</h2>
  ${r?.conclusiones?.length
    ? `<ul>${r.conclusiones.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '<p class="analisis pendiente">Conclusiones pendientes de redacción médica.</p>'}

  <h2>7. Recomendaciones</h2>
  ${r?.recomendaciones?.length
    ? `<ul>${r.recomendaciones.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '<p class="analisis pendiente">Recomendaciones pendientes de redacción médica.</p>'}
</section>

</body></html>`;
}
