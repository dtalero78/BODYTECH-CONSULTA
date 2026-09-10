import {
  CitaLeida,
  consolidarLecturas,
  limpiarFilas,
  normalizarHora,
  normalizarTelefono,
  urlMyBodytech,
} from '../digitalizar.helper';

describe('normalizarHora', () => {
  it.each([
    ['08:06 AM', '08:06'],
    ['8:06 a. m.', '08:06'],
    ['02:40 PM', '14:40'],
    ['12:00 PM', '12:00'],
    ['12:30 AM', '00:30'],
    ['14:40', '14:40'],
  ])('%s → %s', (raw, esperado) => {
    expect(normalizarHora(raw)).toBe(esperado);
  });

  it.each(['', 'Riesgo', '25:00', '8', null])('no inventa una hora con %p', (raw) => {
    expect(normalizarHora(raw)).toBeNull();
  });
});

describe('normalizarTelefono', () => {
  it('deja sólo los dígitos', () => {
    expect(normalizarTelefono('N. Teléfono 300 872 4932')).toBe('3008724932');
  });
  it('descarta lo que no alcanza a ser un teléfono', () => {
    expect(normalizarTelefono('12345')).toBeNull();
  });
});

describe('urlMyBodytech', () => {
  it('pone la cédula después del filter=', () => {
    expect(urlMyBodytech('79981585')).toBe(
      'https://mybodytech.co/general-list?page=1&filter=79981585',
    );
  });
});

describe('limpiarFilas', () => {
  const fila = (extra: Record<string, unknown>) => ({
    hora: '08:06 AM',
    sede: 'CENTRAL ...',
    tipo: 'Riesgo',
    nombre: '  YULY ANDREA   CASTELLANOS FLOREZ ',
    numero_id: '53.051.581',
    telefono: '3046300650',
    modalidad: 'Virtual',
    estado: '',
    ...extra,
  });

  it('normaliza cada campo', () => {
    const { filas, descartadas } = limpiarFilas({ citas: [fila({})] });
    expect(descartadas).toBe(0);
    expect(filas).toEqual([
      {
        hora: '08:06',
        sede: 'CENTRAL ...',
        tipo: 'Riesgo',
        nombre: 'YULY ANDREA CASTELLANOS FLOREZ',
        numeroId: '53051581',
        telefono: '3046300650',
        modalidad: 'virtual',
        estado: null,
      },
    ]);
  });

  it('descarta sin cédula válida o sin nombre, y lo cuenta', () => {
    const { filas, descartadas } = limpiarFilas({
      citas: [fila({ numero_id: '' }), fila({ numero_id: '123' }), fila({ nombre: ' ' })],
    });
    expect(filas).toHaveLength(0);
    expect(descartadas).toBe(3);
  });

  it('una cédula repetida (franjas solapadas) queda una sola vez', () => {
    const { filas } = limpiarFilas({
      citas: [fila({}), fila({ hora: '08:12 AM' }), fila({ numero_id: '79695661' })],
    });
    expect(filas.map((f) => f.numeroId)).toEqual(['53051581', '79695661']);
  });

  it('tolera una respuesta que no es la esperada', () => {
    expect(limpiarFilas(null)).toEqual({ filas: [], descartadas: 0 });
    expect(limpiarFilas({ citas: 'x' })).toEqual({ filas: [], descartadas: 0 });
  });
});

// Casos sacados de la prueba real del 10-sep-2026 (fotograma de la reunión con
// Karen Ariza): gpt-4.1 leyó 79020520 donde decía 79920520, y gpt-4o metió la
// fila de Henry cortada por el borde de la franja, con la cédula incompleta.
describe('consolidarLecturas', () => {
  const c = (extra: Partial<CitaLeida>): CitaLeida => ({
    hora: '08:42',
    sede: 'CENTRAL ...',
    tipo: 'Riesgo',
    nombre: 'Elkin Castro Muñoz',
    numeroId: '79920520',
    telefono: '3508381776',
    modalidad: 'virtual',
    estado: null,
    ...extra,
  });

  it('dos modelos que coinciden: una fila, sin dudas', () => {
    const r = consolidarLecturas([
      { prioridad: 0, filas: [c({})] },
      { prioridad: 1, filas: [c({})] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].dudas).toEqual([]);
    expect(r[0].alternativas).toEqual({});
  });

  it('si no coinciden en la cédula gana el modelo preferido y queda en duda', () => {
    const r = consolidarLecturas([
      { prioridad: 0, filas: [c({})] },
      { prioridad: 1, filas: [c({ numeroId: '79020520' })] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].numeroId).toBe('79920520');
    expect(r[0].dudas).toEqual(['numeroId']);
    expect(r[0].alternativas).toEqual({ numeroId: ['79020520'] });
  });

  it('la mayoría gana aunque la lea el modelo de menor prioridad', () => {
    const r = consolidarLecturas([
      { prioridad: 0, filas: [c({ numeroId: '79020520' })] },
      { prioridad: 1, filas: [c({})] },
      { prioridad: 1, filas: [c({})] }, // la misma fila en la franja siguiente
    ]);
    expect(r[0].numeroId).toBe('79920520');
    expect(r[0].dudas).toEqual(['numeroId']);
  });

  it('una sola lectura no alcanza: queda en duda aunque nadie la contradiga', () => {
    const r = consolidarLecturas([{ prioridad: 0, filas: [c({})] }, { prioridad: 1, filas: [] }]);
    expect(r[0].dudas).toEqual(['numeroId', 'telefono']);
  });

  it('una fila cortada se junta con la completa y no vota', () => {
    const henry = c({ hora: '08:12', nombre: 'HENRY EVERARDO RODRIGUEZ HERNANDEZ', numeroId: '79695661' });
    const r = consolidarLecturas([
      { prioridad: 0, filas: [henry] },
      { prioridad: 1, filas: [henry, c({ hora: '08:12', nombre: 'RODRIGUEZ HERNANDEZ', numeroId: '7695661' })] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe('HENRY EVERARDO RODRIGUEZ HERNANDEZ');
    expect(r[0].numeroId).toBe('79695661');
    expect(r[0].dudas).toEqual([]);
  });

  it('una fila cortada sin hora se pega al único grupo que contiene su nombre', () => {
    const henry = c({ hora: '08:12', nombre: 'HENRY EVERARDO RODRIGUEZ HERNANDEZ', numeroId: '79695661' });
    const r = consolidarLecturas([
      { prioridad: 0, filas: [henry, c({})] },
      { prioridad: 1, filas: [henry, c({}), c({ hora: null, nombre: 'RODRIGUEZ HERNANDEZ', numeroId: '76965661' })] },
    ]);
    expect(r.map((x) => x.numeroId)).toEqual(['79695661', '79920520']);
  });

  it('el mismo nombre mal escrito a la misma hora es la misma persona', () => {
    const r = consolidarLecturas([
      { prioridad: 0, filas: [c({ nombre: 'claudia yasmin valdivieso aguillon', numeroId: '37896340' })] },
      { prioridad: 1, filas: [c({ nombre: 'claudia yosmin valdivieso aguillon', numeroId: '37896340' })] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe('claudia yasmin valdivieso aguillon');
  });

  it('dos personas distintas a la misma hora no se juntan', () => {
    const r = consolidarLecturas([
      { prioridad: 0, filas: [c({}), c({ nombre: 'Rocio del Pilar Parra Galvis', numeroId: '60383455' })] },
    ]);
    expect(r).toHaveLength(2);
  });

  it('marca el teléfono cuando las lecturas no coinciden', () => {
    const r = consolidarLecturas([
      { prioridad: 0, filas: [c({})] },
      { prioridad: 1, filas: [c({ telefono: '3506381776' })] },
    ]);
    expect(r[0].dudas).toEqual(['telefono']);
    expect(r[0].alternativas).toEqual({ telefono: ['3506381776'] });
  });
});
