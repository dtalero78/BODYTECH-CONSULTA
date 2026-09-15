import { describe, expect, it } from 'vitest';
import { camposPorSeccion, type CorpTabId } from '../camposCorporativo';
import { resumirCompletitud } from '../completitud';
import type { MedicalHistoryFull } from '../../types';

/** Una historia con TODO diligenciado, salvo lo que se indique. */
function historia(valores: Record<string, unknown> = {}): MedicalHistoryFull {
  return new Proxy(
    {},
    { get: (_t, k) => (typeof k === 'string' && k in valores ? valores[k] : 'x') }
  ) as unknown as MedicalHistoryFull;
}

const faltantes = (d: MedicalHistoryFull | null, tab: CorpTabId): string[] =>
  resumirCompletitud(camposPorSeccion(d)[tab]).faltantes;

describe('lo que exige la historia del Médico Corporativo', () => {
  it('un examen físico sin tests no reclama nada', () => {
    // Reporte del 15-sep-2026: al finalizar le seguía diciendo que faltaban
    // campos, y eran los tests que no hizo.
    const sinTests = historia({
      mcRuffierFc2: null,
      mcRuffierFc3: null,
      mcHandgripDer1: null,
      mcHandgripIzq1: null,
      mcHandgripDer2: null,
      mcHandgripIzq2: null,
      mcRsPushUps: null,
      mcRsAbdominales: null,
      mcPropiocepcion: null,
      mcWells: null,
    });
    expect(faltantes(sinTests, 'c5')).toEqual([]);
  });

  it('cada campo dice en qué ventana se llena', () => {
    // Sin destino, el "Ir →" vuelve a dejar al médico en la pestaña, buscando.
    for (const campos of Object.values(camposPorSeccion(historia()))) {
      for (const c of campos) expect(c.destino, c.label).toBeTruthy();
    }
  });

  it('un grupo de Sí/Niega a medias sale en lo que falta, con cuántos quedan', () => {
    const d = historia({ mcSintDisnea: null, mcSintSincope: undefined });
    expect(faltantes(d, 'c2')).toEqual(['Síntomas en ejercicio (2 sin responder)']);
  });

  it('antes bastaba con UN antecedente respondido; ahora tienen que estar todos', () => {
    const d = historia({ mcFamDiabetes: null });
    expect(faltantes(d, 'c3')).toContain('Antecedentes familiares (1 sin responder)');
  });

  it('"Niega" (false) es una respuesta, no un campo vacío', () => {
    const d = historia({ mcFamCardiaca: false, mcPerAlcohol: false, mcSintSincope: false });
    expect(faltantes(d, 'c2')).toEqual([]);
    expect(faltantes(d, 'c3')).toEqual([]);
  });

  it('sin historia cargada se reclama lo obligatorio, sin romperse', () => {
    expect(faltantes(null, 'c5')).toEqual(['Peso', 'Talla', 'TAS', 'TAD', 'Frecuencia cardiaca', 'Revisión por sistemas']);
  });
});
