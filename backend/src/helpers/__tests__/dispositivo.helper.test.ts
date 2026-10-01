import {
  LARGO_CODIGO,
  PREFIJO_TOKEN,
  edadDesde,
  formatearCodigo,
  generarCodigo,
  generarToken,
  hashSecreto,
  hoyColombia,
  normalizarCedula,
  normalizarCodigo,
  tieneValor,
  transcripcionPorPasos,
} from '../dispositivo.helper';

describe('código de emparejamiento', () => {
  it('8 caracteres sin los que se confunden en pantalla (0, O, 1, I, L, U)', () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigo();
      expect(c).toHaveLength(LARGO_CODIGO);
      expect(c).not.toMatch(/[01OILU]/);
    }
  });

  it('se muestra con guion y se acepta como lo escriba el médico', () => {
    expect(formatearCodigo('K7P4QM2X')).toBe('K7P4-QM2X');
    expect(normalizarCodigo('k7p4-qm2x')).toBe('K7P4QM2X');
    expect(normalizarCodigo(' K7P4 QM2X ')).toBe('K7P4QM2X');
  });

  it('rechaza lo que no puede ser un código', () => {
    expect(normalizarCodigo('K7P4QM2')).toBeNull(); // corto
    expect(normalizarCodigo('K7P4QM2O')).toBeNull(); // la O no existe
    expect(normalizarCodigo(12345678)).toBeNull();
  });
});

describe('tokens', () => {
  it('llevan prefijo y no se repiten', () => {
    const a = generarToken(), b = generarToken();
    expect(a.startsWith(PREFIJO_TOKEN)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('el hash es estable (es lo único que se guarda)', () => {
    expect(hashSecreto('x')).toBe(hashSecreto('x'));
    expect(hashSecreto('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('normalizarCedula', () => {
  it('deja solo dígitos y letras', () => {
    expect(normalizarCedula('1.023.456.789')).toBe('1023456789');
    expect(normalizarCedula(79123456)).toBe('79123456');
    expect(normalizarCedula('ab123456')).toBe('AB123456');
  });
  it('rechaza lo muy corto o muy largo', () => {
    expect(normalizarCedula('1234')).toBeNull();
    expect(normalizarCedula('1234567890123456')).toBeNull();
    expect(normalizarCedula(undefined)).toBeNull();
  });
});

describe('transcripcionPorPasos', () => {
  it('pone un encabezado cada vez que cambia el paso', () => {
    const t = transcripcionPorPasos(
      [
        { paso: 'motivo', texto: 'Vengo por la rodilla.' },
        { paso: 'motivo', texto: 'Hace dos semanas.' },
        { paso: 'ant_alergicos', texto: 'Soy alérgica a la penicilina.' },
        { paso: 'ant_alergicos', texto: '  ' },
      ],
      { motivo: 'Motivo', ant_alergicos: 'Alergias' }
    );
    expect(t).toBe('## Motivo\nVengo por la rodilla.\nHace dos semanas.\n\n## Alergias\nSoy alérgica a la penicilina.');
  });
});

describe('tieneValor', () => {
  it('false y 0 son valores; vacío y null no', () => {
    expect(tieneValor(false)).toBe(true);
    expect(tieneValor(0)).toBe(true);
    expect(tieneValor('  ')).toBe(false);
    expect(tieneValor(null)).toBe(false);
  });
});

describe('edadDesde', () => {
  const hoy = new Date('2026-10-01T12:00:00Z');
  it('cuenta el cumpleaños', () => {
    expect(edadDesde('1990-10-01', hoy)).toBe(36);
    expect(edadDesde('1990-10-02', hoy)).toBe(35);
  });
  it('null si no es fecha', () => {
    expect(edadDesde('no', hoy)).toBeNull();
    expect(edadDesde(null, hoy)).toBeNull();
  });
});

describe('hoyColombia', () => {
  it('a las 11 p. m. de Colombia sigue siendo el mismo día', () => {
    const { inicio, fin } = hoyColombia(new Date('2026-10-02T04:00:00Z')); // 23:00 del 1-oct en Bogotá
    expect(inicio.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-10-02T04:59:59.999Z');
  });
});
