// Los casos de este archivo NO son inventados: salieron de consultar la base de
// producción antes de escribir el helper. Si alguno deja de pasar, es que la
// regla cambió para datos que existen de verdad.

import {
  normalizarNombre,
  normalizarDocumento,
  clasificarIdentidad,
} from '../padron.helper';

describe('normalizarNombre', () => {
  it('quita tildes precompuestas y descompuestas por igual', () => {
    // El caso que rompió la primera medición: en producción hay tildes como dos
    // caracteres (letra + acento), invisibles para un reemplazo carácter a carácter.
    const precompuesta = 'Mónica';
    const descompuesta = 'Mónica';
    expect(normalizarNombre(precompuesta)).toBe('MONICA');
    expect(normalizarNombre(descompuesta)).toBe('MONICA');
    expect(normalizarNombre(precompuesta)).toBe(normalizarNombre(descompuesta));
  });

  it('colapsa espacios repetidos', () => {
    expect(normalizarNombre('Juliana Andrea   Ruiz García')).toBe('JULIANA ANDREA RUIZ GARCIA');
  });

  it('trata comas y puntos como separadores', () => {
    expect(normalizarNombre('Jennifer, Romero')).toBe(normalizarNombre('Jennifer Romero'));
  });

  it('la Ñ se compara como N: "Patiño" y "Patino" son la misma persona', () => {
    expect(normalizarNombre('Daniel Patiño')).toBe('DANIEL PATINO');
    expect(normalizarNombre('Daniel Patino')).toBe(normalizarNombre('Daniel Patiño'));
  });

  it('aguanta null y vacío', () => {
    expect(normalizarNombre(null)).toBe('');
    expect(normalizarNombre(undefined)).toBe('');
    expect(normalizarNombre('   ')).toBe('');
  });
});

describe('normalizarDocumento', () => {
  it('deja solo dígitos', () => {
    expect(normalizarDocumento('1.045.230-662')).toBe('1045230662');
  });
  it('quita ceros a la izquierda sin vaciar el número', () => {
    expect(normalizarDocumento('0001234')).toBe('1234');
    expect(normalizarDocumento('0')).toBe('0');
  });
});

describe('clasificarIdentidad', () => {
  it('una sola versión → unico', () => {
    const r = clasificarIdentidad('1014269994', ['Daniel Patiño Morales']);
    expect(r.estado).toBe('unico');
    expect(r.nombreCanonico).toBe('Daniel Patiño Morales');
  });

  it('la misma persona con más o menos partes → unificable, gana la completa', () => {
    const r = clasificarIdentidad('1013111614', ['Ana Bernal', 'Ana Maria Bernal Ruiz']);
    expect(r.estado).toBe('unificable');
    expect(r.nombreCanonico).toBe('Ana Maria Bernal Ruiz');
  });

  it('el orden en que llegan las variantes no cambia el resultado', () => {
    const a = clasificarIdentidad('1000160129', [
      'YESSICA DAYANA MARTINEZ SUAREZ',
      'YESSICA MARTINEZ',
    ]);
    const b = clasificarIdentidad('1000160129', [
      'YESSICA MARTINEZ',
      'YESSICA DAYANA MARTINEZ SUAREZ',
    ]);
    expect(a.estado).toBe('unificable');
    expect(b.estado).toBe('unificable');
    expect(a.nombreCanonico).toBe(b.nombreCanonico);
  });

  it('solo cambian las tildes → una sola versión, no un conflicto', () => {
    const r = clasificarIdentidad('1020718128', ['Mónica Alejandra Rodríguez', 'Monica Alejandra Rodriguez']);
    expect(r.estado).toBe('unico');
  });

  it('NO fusiona dos nombres que no son versiones del mismo', () => {
    // El caso real: mismo documento, mismo celular, dos personas distintas.
    // Fusionarlos le colgaría a alguien la historia clínica de otro.
    const r = clasificarIdentidad('1045230662', ['Jose López', 'yoelis del carmen solano palacio']);
    expect(r.estado).toBe('conflicto');
  });

  it('un profesional atendido como paciente SIGUE siendo una persona', () => {
    // Caso real: Mauricio Peña, nutricionista, aparece con su propia cédula.
    // Marcarlo "no persona" por eso lo dejaría fuera del padrón.
    const profesionales = new Set(['1012322469']);
    const r = clasificarIdentidad('1012322469', ['Mauricio Peña'], profesionales);
    expect(r.estado).toBe('unico');
    expect(r.esCedulaDeProfesional).toBe(true);
  });

  it('lo administrativo lo decide el nombre, no de quién es la cédula', () => {
    const profesionales = new Set(['1024537588']);
    const r = clasificarIdentidad('1024537588', ['capacitación SST', 'Lina Vera'], profesionales);
    expect(r.estado).toBe('administrativo');
    expect(r.esCedulaDeProfesional).toBe(true);
  });

  it('un nombre que describe un servicio también es administrativo', () => {
    const r = clasificarIdentidad('52793592', [
      'Evaluación Puesto Trabajo',
      'EvaluaciónEvaluacion Puesto Trabajo',
    ]);
    expect(r.estado).toBe('administrativo');
  });

  it('el apellido repetido no rompe la unificación', () => {
    const r = clasificarIdentidad('1015433055', [
      'Jhonnathan Camilo Tovar Salamanca',
      'Jhonnathan Camilo Tovar Salamanca tovar',
    ]);
    expect(r.estado).toBe('unificable');
  });

  it('descarta variantes vacías sin contarlas como versión', () => {
    const r = clasificarIdentidad('123456', ['Ana Bernal', '   ', '']);
    expect(r.estado).toBe('unico');
    expect(r.variantes).toEqual(['Ana Bernal']);
  });
});
