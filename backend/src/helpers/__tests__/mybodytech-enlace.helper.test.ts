// ============================================================================
// Reglas del enlace orden MyBodytech ↔ cita de Trepsi, fijadas.
// ============================================================================

import {
  diasVentanaEnlace,
  documentoEnlazable,
  documentoSql,
  normalizarDocumento,
} from '../mybodytech-enlace.helper';

describe('normalizarDocumento', () => {
  it('la misma cédula escrita distinto en Trepsi y en MyBodytech da lo mismo', () => {
    expect(normalizarDocumento('1.020.304.050')).toBe('1020304050');
    expect(normalizarDocumento(' 1020304050 ')).toBe('1020304050');
    expect(normalizarDocumento('1020-304-050')).toBe('1020304050');
  });

  it('conserva las letras de un pasaporte, en mayúscula', () => {
    expect(normalizarDocumento('pa-12345')).toBe('PA12345');
  });

  it('vacío o nulo no rompe', () => {
    expect(normalizarDocumento(null)).toBe('');
    expect(normalizarDocumento(undefined)).toBe('');
  });
});

describe('documentoEnlazable', () => {
  it('un documento muy corto no se enlaza: emparejaría a cualquiera', () => {
    expect(documentoEnlazable('')).toBe(false);
    expect(documentoEnlazable('123')).toBe(false);
    expect(documentoEnlazable('1020304')).toBe(true);
  });
});

describe('documentoSql', () => {
  it('aplica en SQL la misma normalización que en el código', () => {
    expect(documentoSql('m.numero_id')).toBe(
      "regexp_replace(upper(COALESCE(m.numero_id, '')), '[^0-9A-Z]', '', 'g')"
    );
  });
});

describe('diasVentanaEnlace', () => {
  it('60 días por defecto; la variable lo cambia', () => {
    expect(diasVentanaEnlace({} as any)).toBe(60);
    expect(diasVentanaEnlace({ MYBODYTECH_ENLACE_DIAS: '30' } as any)).toBe(30);
  });

  it('un valor inválido cae al default en vez de abrir o cerrar la ventana', () => {
    expect(diasVentanaEnlace({ MYBODYTECH_ENLACE_DIAS: '0' } as any)).toBe(60);
    expect(diasVentanaEnlace({ MYBODYTECH_ENLACE_DIAS: 'abc' } as any)).toBe(60);
  });
});
