/**
 * Tests del informe "Hoja de Valoración ACC".
 *
 * Lo que se blinda acá no es el diseño sino dos cosas que rompen callado:
 *  1. La diana se dibuja con coordenadas calculadas. Un `NaN` en un atributo
 *     de SVG no tira una excepción — Chromium simplemente no pinta la figura y
 *     el PDF sale con un cuadro vacío que nadie nota hasta que lo recibe el
 *     paciente.
 *  2. El HTML se interpola a mano, así que un nombre con `<` tiene que salir
 *     escapado.
 */

import { construirInformeAccHtml, type DatosInforme } from '../acc-informe-html';

const COMPLETO: DatosInforme = {
  nombreCompleto: 'Juan Camilo Olmos Correal',
  numeroId: '3820866-S',
  edad: 13,
  sexo: 'masculino',
  estaturaCm: 165,
  pesoKg: 52,
  fechaEvaluacion: '2026-08-09',
  evaluador: 'Deisy Milena Pulido',
  sede: 'Calle 75',

  imc: 19.1,
  imcEstado: 'normal',
  pctGrasa: 8.02,
  grasaEstado: 'bajo',
  metodoGrasa: 'yuhasz',
  pctMuscular: 47.48,
  muscularEstado: 'alto',
  pesoMuscularKg: 24.69,
  masaGrasaKg: 4.17,
  masaLibreGrasaKg: 47.83,
  imm: 9.07,
  tmbKcal: 1601,
  icc: 0.84,
  iccEstado: 'normal',
  ict: 0.41,
  ictEstado: 'normal',
  perimetroAbdominal: 68,
  perimetroAbdominalEstado: 'normal',
  perimetroCadera: 81,
  sumatoria6: 51.7,
  sumatoria8: 63.2,

  perimetros: [{ label: 'Abdominal', valor: 68, unidad: 'cm' }],
  pliegues: [{ label: 'Tríceps', valor: 8.4 }],
  observaciones: null,
};

/** Todo vacío: el caso de una valoración a medio llenar. */
const VACIO: DatosInforme = {
  ...COMPLETO,
  edad: null,
  sexo: null,
  estaturaCm: null,
  pesoKg: null,
  imc: null,
  imcEstado: null,
  pctGrasa: null,
  grasaEstado: null,
  metodoGrasa: null,
  pctMuscular: null,
  muscularEstado: null,
  pesoMuscularKg: null,
  masaGrasaKg: null,
  masaLibreGrasaKg: null,
  imm: null,
  tmbKcal: null,
  icc: null,
  iccEstado: null,
  ict: null,
  ictEstado: null,
  perimetroAbdominal: null,
  perimetroAbdominalEstado: null,
  perimetroCadera: null,
  sumatoria6: null,
  sumatoria8: null,
  perimetros: [{ label: 'Abdominal', valor: null, unidad: 'cm' }],
  pliegues: [{ label: 'Tríceps', valor: null }],
};

describe('estructura del informe', () => {
  const html = construirInformeAccHtml(COMPLETO);

  it('trae las dos secciones del modelo aprobado', () => {
    expect(html).toContain('DIANA DE EVALUACIÓN CORPORAL (OBJETIVO VS. REGISTRADO)');
    expect(html).toContain('RESULTADOS DE COMPOSICIÓN CORPORAL');
  });

  it('identifica al paciente con nombre y cédula', () => {
    expect(html).toContain('Juan Camilo Olmos Correal');
    expect(html).toContain('3820866-S');
  });

  it('imprime los valores registrados', () => {
    expect(html).toContain('19.10 kg/m²');
    expect(html).toContain('8.02%');
    expect(html).toContain('1.601 kcal');
    expect(html).toContain('0.84');
  });

  it('declara con qué fórmula se calculó el % graso', () => {
    expect(html).toContain('Yuhasz');
  });

  it('no arrastra recursos externos — Chromium renderiza sin red', () => {
    expect(html).not.toMatch(/<img[^>]+src=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(html).not.toMatch(/<script/i);
  });
});

describe('la diana', () => {
  it('no emite coordenadas NaN — un SVG con NaN no se dibuja y nadie se entera', () => {
    for (const datos of [COMPLETO, VACIO]) {
      const html = construirInformeAccHtml(datos);
      const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('Infinity');
      expect(svg).not.toContain('undefined');
    }
  });

  it('dibuja el polígono del paciente solo si están los seis ejes', () => {
    // Con datos completos hay dos polígonos de rango + el del paciente.
    const completo = construirInformeAccHtml(COMPLETO);
    expect((completo.match(/<polygon/g) ?? []).length).toBe(3);

    // Sin ningún valor no se dibuja un polígono degenerado en el centro.
    const vacio = construirInformeAccHtml(VACIO);
    expect((vacio.match(/<polygon/g) ?? []).length).toBe(2);
  });

  it('rotula cada eje con su valor y unidad', () => {
    const html = construirInformeAccHtml(COMPLETO);
    for (const eje of ['% Grasa', 'IMC', 'Peso total', 'Cintura / cadera', 'P. abdominal', '% Muscular']) {
      expect(html).toContain(eje);
    }
  });

  it('deriva el rango de peso de la estatura, no de una constante', () => {
    // Dos pacientes con el mismo peso pero distinta talla no pueden quedar en
    // la misma posición del eje: el rango normal de peso sale del IMC.
    const bajo = construirInformeAccHtml({ ...COMPLETO, estaturaCm: 150 });
    const alto = construirInformeAccHtml({ ...COMPLETO, estaturaCm: 190 });
    expect(bajo).not.toBe(alto);
  });
});

describe('robustez', () => {
  it('escapa el HTML de los campos de texto', () => {
    const html = construirInformeAccHtml({
      ...COMPLETO,
      nombreCompleto: '<script>alert(1)</script>',
      observaciones: 'Refiere dolor <lumbar> & rigidez',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;lumbar&gt; &amp; rigidez');
  });

  it('con todo vacío emite un documento válido en vez de tirar', () => {
    const html = construirInformeAccHtml(VACIO);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('—'); // los faltantes se marcan, no se inventan
    expect(html).not.toContain('null');
    expect(html).not.toContain('NaN');
  });

  it('no imprime un sexo inventado cuando no se registró', () => {
    const html = construirInformeAccHtml(VACIO);
    expect(html).not.toContain('Masculino');
    expect(html).not.toContain('Femenino');
  });
});
