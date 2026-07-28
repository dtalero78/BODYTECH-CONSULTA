/**
 * Tests de la rúbrica de calidad — "Auditoría Integral de Calidad" (Bodytech).
 *
 * La nota que ve el coordinador sale de `computePuntajeTotal`, no del modelo,
 * así que la aritmética y la estructura de la rúbrica se blindan acá.
 */

import {
  RUBRICA_BODYTECH,
  RUBRICA_PSICOLOGICA,
  getRubrica,
  computePuntajeTotal,
  buildAgentDescription,
  buildGraderRubric,
  COLUMNAS_HISTORIA_AUDITORIA,
} from '../rubrica-calidad';

const COACH = 'COACH ANDREA';

/** Respuesta simulada del evaluador con el mismo puntaje en todos los ítems. */
const todos = (puntaje: number) => RUBRICA_BODYTECH.map((c) => ({ id: c.id, puntaje }));

describe('estructura de RUBRICA_BODYTECH', () => {
  it('tiene 19 ítems que suman exactamente 100 puntos', () => {
    expect(RUBRICA_BODYTECH).toHaveLength(19);
    expect(RUBRICA_BODYTECH.reduce((s, c) => s + (c.puntos ?? 0), 0)).toBe(100);
  });

  it('los pesos suman 1.0', () => {
    const suma = RUBRICA_BODYTECH.reduce((s, c) => s + c.peso, 0);
    expect(suma).toBeCloseTo(1.0, 9);
  });

  it('respeta el reparto de puntos por categoría del documento oficial', () => {
    const porCategoria = RUBRICA_BODYTECH.reduce<Record<string, number>>((acc, c) => {
      const cat = c.categoria as string;
      acc[cat] = (acc[cat] ?? 0) + (c.puntos ?? 0);
      return acc;
    }, {});
    expect(porCategoria).toEqual({
      '1. Preparación': 10,
      '2. Apertura y conexión': 20,
      '3. Descubrimiento': 20,
      '4. Calidad técnica': 20,
      '5. Gestión comercial': 20,
      '6. Cierre': 10,
    });
  });

  it('no tiene ids duplicados', () => {
    const ids = RUBRICA_BODYTECH.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getRubrica', () => {
  it('usa la Auditoría Integral (escala de puntos) por defecto', () => {
    const { tipo, escala, rubrica } = getRubrica(COACH);
    expect(tipo).toBe('bodytech');
    expect(escala).toBe('puntos');
    expect(rubrica).toBe(RUBRICA_BODYTECH);
  });

  it('conserva la rúbrica psicológica legacy para YURI', () => {
    const { tipo, escala, rubrica } = getRubrica('YURI PSICOLOGA');
    expect(tipo).toBe('psicologica');
    expect(escala).toBe('x20');
    expect(rubrica).toBe(RUBRICA_PSICOLOGICA);
  });

  it('cae al default cuando no hay médico', () => {
    expect(getRubrica(null).tipo).toBe('bodytech');
    expect(getRubrica(undefined).tipo).toBe('bodytech');
  });
});

describe('computePuntajeTotal — escala de puntos', () => {
  it('mapea 1→0 y 5→100 (un ítem incumplido vale 0, no 20%)', () => {
    expect(computePuntajeTotal(todos(1), COACH)).toBe(0);
    expect(computePuntajeTotal(todos(5), COACH)).toBe(100);
  });

  it('reparte los puntos intermedios en cuartos', () => {
    expect(computePuntajeTotal(todos(2), COACH)).toBe(25);
    expect(computePuntajeTotal(todos(3), COACH)).toBe(50);
    expect(computePuntajeTotal(todos(4), COACH)).toBe(75);
  });

  it('pondera por categoría: perder toda Gestión comercial cuesta 20 puntos', () => {
    const criterios = RUBRICA_BODYTECH.map((c) => ({
      id: c.id,
      puntaje: c.categoria === '5. Gestión comercial' ? 1 : 5,
    }));
    expect(computePuntajeTotal(criterios, COACH)).toBe(80);
  });

  it('sanea puntajes fuera de rango y strings numéricos', () => {
    const criterios = RUBRICA_BODYTECH.map((c) => ({ id: c.id, puntaje: '9' }));
    expect(computePuntajeTotal(criterios, COACH)).toBe(100);
  });

  it('devuelve null si falta un criterio (el llamador cae al total del modelo)', () => {
    expect(computePuntajeTotal(todos(5).slice(1), COACH)).toBeNull();
  });

  it('devuelve null con entradas vacías o inválidas', () => {
    expect(computePuntajeTotal([], COACH)).toBeNull();
    expect(computePuntajeTotal(null, COACH)).toBeNull();
    expect(computePuntajeTotal(undefined, COACH)).toBeNull();
  });

  it('ignora criterios extra que el modelo invente', () => {
    const criterios = [...todos(5), { id: 'inventado', puntaje: 1 }];
    expect(computePuntajeTotal(criterios, COACH)).toBe(100);
  });
});

describe('computePuntajeTotal — escala legacy x20', () => {
  it('mantiene el piso de 20 y el techo de 100 para la rúbrica psicológica', () => {
    const uno = RUBRICA_PSICOLOGICA.map((c) => ({ id: c.id, puntaje: 1 }));
    const cinco = RUBRICA_PSICOLOGICA.map((c) => ({ id: c.id, puntaje: 5 }));
    expect(computePuntajeTotal(uno, 'YURI')).toBe(20);
    expect(computePuntajeTotal(cinco, 'YURI')).toBe(100);
  });
});

describe('buildAgentDescription', () => {
  const transcript = 'Coach: Buenos días, soy Andrea, coach de Bodytech.';

  it('incluye los 19 ids y el reparto por categorías', () => {
    const prompt = buildAgentDescription(transcript, null, COACH);
    for (const c of RUBRICA_BODYTECH) expect(prompt).toContain(c.id);
    expect(prompt).toContain('6 categorías, 19 ítems, 100 puntos');
    expect(prompt).toContain(transcript);
  });

  it('inyecta la puntualidad calculada en hora de Colombia', () => {
    const prompt = buildAgentDescription(transcript, null, COACH, {
      fechaAgendada: '2026-07-24T15:00:00.000Z',
      fechaInicioReal: '2026-07-24T15:12:00.000Z',
    });
    expect(prompt).toContain('2026-07-24 10:00');
    expect(prompt).toContain('2026-07-24 10:12');
    expect(prompt).toContain('12 minuto(s) DESPUÉS');
  });

  it('marca la puntualidad como no calculable si falta un extremo', () => {
    const prompt = buildAgentDescription(transcript, null, COACH, {
      fechaAgendada: '2026-07-24T15:00:00.000Z',
      fechaInicioReal: null,
    });
    expect(prompt).toContain('no registrado');
    expect(prompt).toContain('No penalices la puntualidad');
  });

  it('mide la cobertura de la historia clínica y muestra los narrativos', () => {
    const prompt = buildAgentDescription(transcript, null, COACH, {
      historia: {
        motivo_consulta_texto: 'Bajar de peso',
        // `false` es una respuesta válida: cuenta como diligenciado.
        ant_patologico_flag: false,
        // string vacío NO cuenta.
        hallazgos_descripcion: '   ',
      },
    });
    expect(prompt).toContain(`Cobertura global: 2 de ${COLUMNAS_HISTORIA_AUDITORIA.length} campos`);
    expect(prompt).toContain('Motivo de consulta: "Bajar de peso"');
    expect(prompt).toContain('Hallazgos: (vacío)');
  });

  it('omite los bloques objetivos cuando no hay contexto', () => {
    // Los nombres aparecen citados en las descripciones de los ítems, así que
    // se afirma sobre el delimitador del bloque, no sobre el nombre suelto.
    const prompt = buildAgentDescription(transcript, null, COACH);
    expect(prompt).not.toContain('================ DATOS OBJETIVOS DE LA SESIÓN');
    expect(prompt).not.toContain('================ DILIGENCIAMIENTO DE LA HISTORIA CLÍNICA');
  });
});

describe('buildGraderRubric', () => {
  it('exige los 19 criterios y el rango [0, 100]', () => {
    const rubric = buildGraderRubric(COACH);
    expect(rubric).toContain('exactamente 19 objetos');
    expect(rubric).toContain('[0, 100]');
  });

  it('conserva el rango legacy [20, 100] para la rúbrica psicológica', () => {
    expect(buildGraderRubric('YURI')).toContain('[20, 100]');
  });
});
