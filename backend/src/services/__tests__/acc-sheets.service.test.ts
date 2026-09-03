/**
 * Tests del volcado al Excel de Sol Médica.
 *
 * El orden de columnas es un CONTRATO CON EL CLIENTE: Sol Médica lee esa hoja y
 * las filas ya escritas quedan alineadas a ese orden. Insertar una columna en
 * el medio desalinea todo el histórico sin que nada falle en tiempo de
 * ejecución, así que el orden se congela acá.
 */

import { COLUMNAS_SHEET } from '../acc-sheets.service';
import type { Valoracion } from '../acc.service';
import { calcularAntropometria } from '../../helpers/antropometria';

/** Orden aprobado en la reunión de validación. NO reordenar sin acordarlo. */
const ORDEN_APROBADO = [
  'Nombre Completo',
  'Cédula / ID',
  'Edad',
  'Sexo',
  'Estatura (cm)',
  'Fecha Evaluación',
  'Peso (Kg)',
  'IMC (kg/m²)',
  'Estado IMC',
  '% Grasa',
  'Estado % Grasa',
  '% Muscular',
  'Peso Muscular',
  'IMM (kg/m²)',
  'TMB (kcal)',
  'Perímetro Abdominal',
  'Perímetro Cadera',
  'ICC',
  'ICT',
  'Bícep Der Rel/Con',
  'Bícep Izq Rel/Con',
  'Muslo Der (cm)',
  'Muslo Izq (cm)',
];

function valoracion(over: Partial<Valoracion> = {}): Valoracion {
  const medidas = {
    sexo: 'masculino',
    edad: 30,
    estaturaCm: 175,
    pesoKg: 75,
    perimetroAbdominal: 85,
    perimetroCadera: 98,
    perimetroBrazoRelajadoDer: 30,
    perimetroBrazoContraidoDer: 33,
    perimetroBrazoRelajadoIzq: 29.5,
    perimetroBrazoContraidoIzq: 32.5,
    perimetroMusloDer: 55,
    perimetroMusloIzq: 55,
    perimetroPantorrilla: 37,
    pliegueTriceps: 10,
    pliegueSubescapular: 8,
    pliegueBiceps: 4,
    pliegueCrestaIliaca: 12,
    pliegueSupraespinal: 6,
    pliegueAbdominal: 14,
    pliegueMusloAnterior: 16,
    plieguePantorrilla: 9,
  };
  return {
    id: 1,
    numeroId: '1015320491',
    nombreCompleto: 'Nikolay Correal',
    fechaEvaluacion: '2026-08-18',
    sede: 'Calle 75',
    evaluador: 'Deisy Milena Pulido',
    estado: 'cerrada',
    observaciones: null,
    cerradaAt: null,
    exportadaSheetAt: null,
    createdAt: '2026-08-18T15:00:00Z',
    pacienteId: null,
    evaluadorUsuarioId: null,
    origenDatos: 'manual',
    ...medidas,
    resultado: calcularAntropometria(medidas),
    ...over,
  } as Valoracion;
}

describe('contrato de columnas del Excel', () => {
  it('conserva el orden exacto aprobado con el cliente', () => {
    expect(COLUMNAS_SHEET.map((c) => c.header)).toEqual(ORDEN_APROBADO);
  });

  it('produce una fila con una celda por columna', () => {
    const fila = COLUMNAS_SHEET.map((c) => c.valor(valoracion()));
    expect(fila).toHaveLength(ORDEN_APROBADO.length);
  });
});

describe('formato de las celdas', () => {
  const celda = (header: string, v = valoracion()) => {
    const col = COLUMNAS_SHEET.find((c) => c.header === header)!;
    return col.valor(v);
  };

  it('escribe la fecha como DD/MM/YYYY, no ISO', () => {
    expect(celda('Fecha Evaluación')).toBe('18/08/2026');
  });

  it('escribe el sexo en el idioma de la hoja', () => {
    expect(celda('Sexo')).toBe('Masculino');
    expect(celda('Sexo', valoracion({ sexo: 'femenino' }))).toBe('Femenino');
  });

  it('traduce las evaluaciones a las etiquetas de la hoja', () => {
    expect(celda('Estado IMC')).toBe('Normal');
  });

  it('combina relajado y contraído en una sola celda, como la hoja', () => {
    expect(celda('Bícep Der Rel/Con')).toBe('30.0 / 33.0');
    expect(celda('Bícep Izq Rel/Con')).toBe('29.5 / 32.5');
  });

  it('con solo el relajado no inventa el contraído', () => {
    const v = valoracion({ perimetroBrazoContraidoDer: null });
    expect(celda('Bícep Der Rel/Con', v)).toBe('30.0');
  });

  it('deja la celda vacía en vez de escribir null o NaN', () => {
    const vacia = valoracion({
      pesoKg: null,
      perimetroCadera: null,
      perimetroBrazoRelajadoDer: null,
      resultado: calcularAntropometria({}),
    });
    for (const col of COLUMNAS_SHEET) {
      const valor = col.valor(vacia);
      expect(String(valor)).not.toContain('null');
      expect(String(valor)).not.toContain('NaN');
      expect(String(valor)).not.toContain('undefined');
    }
  });

  it('las columnas numéricas van como número, no como texto', () => {
    // Sheets ordena y grafica mal si le llegan números entrecomillados.
    for (const header of ['Edad', 'Estatura (cm)', 'Peso (Kg)', 'IMC (kg/m²)', 'ICC']) {
      const valor = celda(header);
      expect(typeof valor === 'number' || valor === '').toBe(true);
    }
  });
});
