// ============================================================================
// Las guías del dispositivo de consulta presencial. Lo que se fija acá:
// que cada campo exista en la historia con un tipo compatible (si no, la IA
// "llenaría" un campo que updateField rechaza en silencio), qué programa le
// toca a cada médico, el paso de embarazo solo a mujeres, y que lo que devuelve
// la IA se filtre por tipo y rango antes de proponerlo.
// ============================================================================

import {
  GUIAS,
  camposDe,
  pasosPara,
  programaDe,
  promptExtraccion,
  puedeLlenar,
  validarExtraccion,
} from '../guias-dispositivo';
import { EDITABLE_FIELD_TYPE_MAP } from '../../services/historia-field-coercion.service';

describe('cada campo de las guías existe en la historia', () => {
  const compatibles: Record<string, string[]> = {
    texto: ['string'],
    opcion: ['string'],
    si_no: ['boolean'],
    // updateField convierte el número a texto si la columna es texto (actividad_frecuencia).
    numero: ['number', 'string'],
  };
  for (const programa of ['umv', 'corporativo'] as const) {
    for (const c of camposDe(programa)) {
      it(`${programa}: ${c.field} (${c.tipo})`, () => {
        const tipo = EDITABLE_FIELD_TYPE_MAP[c.field];
        expect(tipo).toBeDefined();
        expect(compatibles[c.tipo]).toContain(tipo);
      });
    }
  }

  it('ningún campo se repite dentro de una guía', () => {
    for (const programa of ['umv', 'corporativo'] as const) {
      const fields = camposDe(programa).map((c) => c.field);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it('los ids de paso son únicos y caben en la pantalla', () => {
    for (const pasos of Object.values(GUIAS)) {
      expect(new Set(pasos.map((p) => p.id)).size).toBe(pasos.length);
      for (const p of pasos) expect(p.tema.length).toBeLessThanOrEqual(24);
    }
  });
});

describe('programaDe', () => {
  it('el médico corporativo, escriba como escriba la especialidad', () => {
    expect(programaDe('Médico Corporativo')).toBe('corporativo');
    expect(programaDe('  medico corporativo ')).toBe('corporativo');
  });
  it('todo lo demás es la guía de la UMV', () => {
    expect(programaDe(null)).toBe('umv');
    expect(programaDe('Fisioterapia')).toBe('umv');
  });
});

describe('pasosPara', () => {
  const ids = (genero: string | null) => pasosPara('umv', genero).map((p) => p.id);
  it('embarazo solo a mujeres', () => {
    expect(ids('Femenino')).toContain('embarazo');
    expect(ids('F')).toContain('embarazo');
    expect(ids('Masculino')).not.toContain('embarazo');
    expect(ids(null)).not.toContain('embarazo');
  });
  it('la UMV conserva los 12 pasos de la consulta guiada', () => {
    expect(ids('Femenino')).toHaveLength(12);
  });
});

describe('promptExtraccion', () => {
  it('nombra todos los campos de la guía', () => {
    for (const programa of ['umv', 'corporativo'] as const) {
      const p = promptExtraccion(programa);
      for (const c of camposDe(programa)) expect(p).toContain(c.field);
    }
  });
});

describe('validarExtraccion', () => {
  it('se queda solo con claves de la guía y del tipo correcto', () => {
    const r = validarExtraccion('umv', {
      motivo_consulta_texto: '  Dolor de rodilla.  ',
      ant_alergicos_flag: false,
      ant_alergicos_obs: 'Niega alergias.',
      mdDx1: 'J00', // no es de la guía
      ant_patologico_flag: 'sí', // booleano como texto: no
      tas: '120',
      tad: 'ochenta', // no es número
    });
    expect(r).toEqual({
      motivo_consulta_texto: 'Dolor de rodilla.',
      ant_alergicos_flag: false,
      ant_alergicos_obs: 'Niega alergias.',
      tas: 120,
    });
  });

  it('descarta números fuera de rango y acepta coma decimal', () => {
    const r = validarExtraccion('umv', { cc_peso_nuevo: '72,5', cc_estatura_nuevo: 1.7, tas: 900 });
    expect(r).toEqual({ cc_peso_nuevo: 72.5 }); // 1.7 cm y 900 mmHg no son medidas reales
  });

  it('las opciones tienen que ser exactamente las del panel', () => {
    expect(validarExtraccion('umv', { objetivo_bodytech: 'Bajar de Peso' })).toEqual({ objetivo_bodytech: 'Bajar de Peso' });
    expect(validarExtraccion('umv', { objetivo_bodytech: 'adelgazar' })).toEqual({});
  });

  it('aplana si el modelo agrupa en secciones', () => {
    expect(validarExtraccion('corporativo', { signos: { mc_peso: 80, tas: 118 } })).toEqual({ mc_peso: 80, tas: 118 });
  });

  it('lo que no es objeto no rompe', () => {
    expect(validarExtraccion('umv', null)).toEqual({});
    expect(validarExtraccion('umv', [1, 2])).toEqual({});
    expect(validarExtraccion('umv', 'texto')).toEqual({});
  });
});

describe('puedeLlenar — lo que escribió el médico no se pisa', () => {
  it('texto y números: solo si están vacíos', () => {
    expect(puedeLlenar('texto', null, 'x')).toBe(true);
    expect(puedeLlenar('texto', '  ', 'x')).toBe(true);
    expect(puedeLlenar('texto', 'Niega alergias.', 'x')).toBe(false);
    expect(puedeLlenar('numero', null, 70)).toBe(true);
    expect(puedeLlenar('numero', 0, 70)).toBe(false);
  });

  it('Sí/No: el false de la columna nueva no es una respuesta', () => {
    // La alergia que se dijo entra aunque la columna nazca en false.
    expect(puedeLlenar('si_no', false, true)).toBe(true);
    expect(puedeLlenar('si_no', null, true)).toBe(true);
  });

  it('Sí/No: nunca se le quita un Sí al médico', () => {
    expect(puedeLlenar('si_no', true, false)).toBe(false);
    expect(puedeLlenar('si_no', 'Sí', false)).toBe(false);
    expect(puedeLlenar('si_no', true, true)).toBe(false);
  });

  it('Sí/No: un No solo se escribe si nadie respondió', () => {
    expect(puedeLlenar('si_no', null, false)).toBe(true);
    expect(puedeLlenar('si_no', false, false)).toBe(false);
  });
});
