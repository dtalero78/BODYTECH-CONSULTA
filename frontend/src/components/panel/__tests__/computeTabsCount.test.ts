import { describe, test, expect } from 'vitest';
import { computeTabsCount } from '../MedicalConsultationPanel';
import type { MedicalHistoryFull } from '../types';

// Lógica pura extraída de MedicalConsultationPanel para auditar:
// - vacío: todos los tabs cuentan 0
// - completo: cada tab cuenta `total` (independiente del tab adyacente)
// - sin doble conteo entre tabs (campo de t2 no aparece en t1, etc.)

const EMPTY_TAB_IDS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'] as const;

function findTab(tabs: ReturnType<typeof computeTabsCount>, id: string) {
  const t = tabs.find((x) => x.id === id);
  if (!t) throw new Error(`tab ${id} no encontrado`);
  return t;
}

describe('computeTabsCount — casos borde', () => {
  test('null → 7 tabs con filled=0', () => {
    const tabs = computeTabsCount(null);
    expect(tabs).toHaveLength(7);
    for (const id of EMPTY_TAB_IDS) {
      expect(findTab(tabs, id).filled).toBe(0);
    }
  });

  test('objeto vacío → 7 tabs con filled=0', () => {
    const tabs = computeTabsCount({} as MedicalHistoryFull);
    expect(tabs).toHaveLength(7);
    for (const id of EMPTY_TAB_IDS) {
      expect(findTab(tabs, id).filled).toBe(0);
    }
  });

  test('strings vacíos ("") no cuentan como filled', () => {
    const data = {
      generoBiologico: '',
      municipio: '',
      eps: '',
    } as unknown as MedicalHistoryFull;
    const tabs = computeTabsCount(data);
    expect(findTab(tabs, 't1').filled).toBe(0);
  });
});

describe('computeTabsCount — totales declarados', () => {
  test('total por tab coincide con la spec', () => {
    const tabs = computeTabsCount(null);
    expect(findTab(tabs, 't1').total).toBe(13);
    expect(findTab(tabs, 't2').total).toBe(3);
    expect(findTab(tabs, 't3').total).toBe(3);
    expect(findTab(tabs, 't4').total).toBe(15);
    expect(findTab(tabs, 't5').total).toBe(4);
    expect(findTab(tabs, 't6').total).toBe(2);
    expect(findTab(tabs, 't7').total).toBe(2);
  });
});

describe('computeTabsCount — caso completo (cada tab llega a total)', () => {
  // Construyo el MedicalHistoryFull con TODOS los campos relevantes a los
  // contadores actuales. Si la spec cambia y agregan/quitan campos, este
  // test debe actualizarse junto con la lógica.
  const fullData: MedicalHistoryFull = {
    // t1: 13 campos
    generoBiologico: 'Masculino',
    identidadGenero: 'Hombre',
    grupoSanguineo: 'O+',
    fechaNacimiento: '1990-01-01',
    estadoCivil: 'Soltero',
    paisResidencia: 'Colombia',
    municipio: 'Bogotá',
    zonaTerritorial: 'Urbana',
    telefonoResidencia: '6011234567',
    contactoEmergenciaNombre: 'María',
    ocupacion: 'Ingeniero',
    eps: 'Sura',
    tipoVinculacion: 'Cotizante',

    // t2 Sección 1: ≥1 de motivoConsulta/objetivo/...
    motivoConsultaTexto: 'Dolor lumbar',
    // t2 Sección 2: al menos un flag verdadero (string 'Sí' o boolean true)
    antPatologicoFlag: true,
    // t2 Sección 3: isFilled(actividadFrecuencia) || actividadDuracionMin != null
    actividadFrecuencia: '3',
    actividadDuracionMin: 30,

    // t3: 3 secciones
    downtonRiesgo: 'BAJO',
    acsmRiesgo: 'BAJO',
    riesgoFinal: 'BAJO',

    // t4: 15 keys
    ccPesoNuevo: 70,
    ccEstaturaNuevo: 170,
    ccImcNuevo: 24.2,
    ccGrasaNuevo: 18,
    ccPerimetroAbdominalNuevo: 85,
    posturaEspalda: 'Normal',
    hallazgosDescripcion: 'Ninguno relevante',
    hallazgosDolor: 'No',
    fuerzaInferior: 5,
    fcm: 180,
    tas: 120,
    tad: 80,
    equilibrioUnipodal: 'Normal',
    riesgoMarcha: 'BAJO',
    riesgoOm: 'BAJO',

    // t5: 4 campos
    intervencionAnalisis: 'Análisis OK',
    intervencionTipoTecnologia: 'Consulta médica',
    intervencionTipoMeta: 'Mantenimiento',
    dxTecnologiaSalud: 'Z00.0',

    // t6: 2 campos
    aptitud: 'APTO',
    controlFecha: '2025-12-01',

    // t7: 2 campos
    mdConceptoFinal: 'Sin novedades',
    mdRecomendacionesMedicasAdicionales: 'Continuar plan',
  } as unknown as MedicalHistoryFull;

  test('cada tab fijo (t1, t3, t4, t5, t6, t7) llega a filled === total', () => {
    const tabs = computeTabsCount(fullData);
    expect(findTab(tabs, 't1').filled).toBe(13);
    expect(findTab(tabs, 't3').filled).toBe(3);
    expect(findTab(tabs, 't4').filled).toBe(15);
    expect(findTab(tabs, 't5').filled).toBe(4);
    expect(findTab(tabs, 't6').filled).toBe(2);
    expect(findTab(tabs, 't7').filled).toBe(2);
  });

  test('t2 (3 secciones) cuenta cada sección como 1, no por campo', () => {
    const tabs = computeTabsCount(fullData);
    expect(findTab(tabs, 't2').filled).toBe(3);
  });

  test("t3 warn=true cuando riesgoFinal === 'ALTO'", () => {
    const alto = { ...fullData, riesgoFinal: 'ALTO' } as MedicalHistoryFull;
    const tabs = computeTabsCount(alto);
    expect(findTab(tabs, 't3').warn).toBe(true);
  });
});

describe('computeTabsCount — sin doble conteo entre tabs', () => {
  test('motivoConsultaTexto es de t2, no aparece en t1', () => {
    const data = { motivoConsultaTexto: 'Dolor lumbar' } as MedicalHistoryFull;
    const tabs = computeTabsCount(data);
    expect(findTab(tabs, 't1').filled).toBe(0);
    // Sección 1 del t2 se "llena" con cualquier campo de la lista (motivoConsultaTexto incluido)
    expect(findTab(tabs, 't2').filled).toBe(1);
  });

  test('mdConceptoFinal es de t7, no aparece en otros tabs', () => {
    const data = { mdConceptoFinal: 'Sin novedades' } as MedicalHistoryFull;
    const tabs = computeTabsCount(data);
    expect(findTab(tabs, 't1').filled).toBe(0);
    expect(findTab(tabs, 't2').filled).toBe(0);
    expect(findTab(tabs, 't3').filled).toBe(0);
    expect(findTab(tabs, 't4').filled).toBe(0);
    expect(findTab(tabs, 't5').filled).toBe(0);
    expect(findTab(tabs, 't6').filled).toBe(0);
    expect(findTab(tabs, 't7').filled).toBe(1);
  });

  test('aptitud es exclusivo de t6', () => {
    const data = { aptitud: 'APTO' } as MedicalHistoryFull;
    const tabs = computeTabsCount(data);
    expect(findTab(tabs, 't6').filled).toBe(1);
    expect(findTab(tabs, 't1').filled).toBe(0);
    expect(findTab(tabs, 't5').filled).toBe(0);
    expect(findTab(tabs, 't7').filled).toBe(0);
  });

  test('campos de t1 no migran a t2/t3', () => {
    const data = {
      generoBiologico: 'Masculino',
      municipio: 'Bogotá',
    } as MedicalHistoryFull;
    const tabs = computeTabsCount(data);
    expect(findTab(tabs, 't1').filled).toBe(2);
    expect(findTab(tabs, 't2').filled).toBe(0);
    expect(findTab(tabs, 't3').filled).toBe(0);
  });
});
