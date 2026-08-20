// ============================================================================
// La normalización de nombres se prueba, no se promete.
//
// mybodytech manda el nombre del profesional en texto libre y con formato
// inconsistente ("Alejandra Perez" vs "PAULA ANDREA MORA PINZON"). Si algún día
// esa comparación se usa para RESOLVER el profesional (Fase 2), un falso
// positivo pegaría la cita al coach equivocado. Estos casos fijan la frontera.
// ============================================================================

import { normalizarNombreProfesional } from '../mybodytech.service';

describe('normalizarNombreProfesional', () => {
  it('sube a mayúsculas y colapsa espacios', () => {
    expect(normalizarNombreProfesional('  Alejandra   Perez ')).toBe('ALEJANDRA PEREZ');
  });

  it('quita tildes, para que "Méndez" y "Mendez" comparen igual', () => {
    expect(normalizarNombreProfesional('Emilse Méndez')).toBe(
      normalizarNombreProfesional('Emilse Mendez')
    );
  });

  it('quita títulos, que mybodytech a veces antepone', () => {
    expect(normalizarNombreProfesional('Dr. Juan Mendez')).toBe('JUAN MENDEZ');
    expect(normalizarNombreProfesional('Dra Lina Guevara')).toBe('LINA GUEVARA');
  });

  it('quita puntuación sin pegar las palabras', () => {
    expect(normalizarNombreProfesional('Juan-Sebastián Rojas.')).toBe('JUAN SEBASTIAN ROJAS');
  });

  it('los dos formatos reales de mybodytech normalizan estables', () => {
    expect(normalizarNombreProfesional('Alejandra Perez')).toBe('ALEJANDRA PEREZ');
    expect(normalizarNombreProfesional('PAULA ANDREA MORA PINZON')).toBe(
      'PAULA ANDREA MORA PINZON'
    );
  });

  it('un nombre vacío o solo puntuación da cadena vacía (no matchea nada)', () => {
    expect(normalizarNombreProfesional('')).toBe('');
    expect(normalizarNombreProfesional('  ...  ')).toBe('');
  });

  it('NO considera iguales a dos personas distintas con apellido compartido', () => {
    expect(normalizarNombreProfesional('Juan Mendez')).not.toBe(
      normalizarNombreProfesional('Emilse Mendez')
    );
  });
});
