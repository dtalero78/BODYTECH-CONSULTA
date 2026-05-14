import { describe, test, expect } from 'vitest';
import { valuesEquivalent } from '../useAutoSave';

// Estos tests cubren la lógica pura extraída de useAutoSave. La función se
// usa para suprimir PATCHes redundantes cuando un campo calculado coincide
// con el valor del servidor (con tolerancia float de 0.01).

describe('valuesEquivalent', () => {
  test('number ↔ string del mismo valor numérico → true', () => {
    expect(valuesEquivalent(23.4, '23.4')).toBe(true);
    expect(valuesEquivalent('23.4', 23.4)).toBe(true);
  });

  test('diferencia < 0.01 (tolerancia float IMC) → true', () => {
    expect(valuesEquivalent(23.4, 23.401)).toBe(true);
    expect(valuesEquivalent(23.401, 23.4)).toBe(true);
  });

  test('diferencia ≥ 0.01 → false', () => {
    expect(valuesEquivalent(23.4, 23.42)).toBe(false);
  });

  test('null y undefined son equivalentes', () => {
    expect(valuesEquivalent(null, undefined)).toBe(true);
    expect(valuesEquivalent(undefined, null)).toBe(true);
    expect(valuesEquivalent(null, null)).toBe(true);
    expect(valuesEquivalent(undefined, undefined)).toBe(true);
  });

  test('null vs 0 → false (no se colapsan a "vacío")', () => {
    expect(valuesEquivalent(null, 0)).toBe(false);
    expect(valuesEquivalent(0, null)).toBe(false);
  });

  test('strings iguales (early ===) → true', () => {
    expect(valuesEquivalent('hola', 'hola')).toBe(true);
  });

  test('booleans iguales (early ===) → true', () => {
    expect(valuesEquivalent(true, true)).toBe(true);
    expect(valuesEquivalent(false, false)).toBe(true);
  });

  test('NaN vs NaN → false (rama explícita en el guard)', () => {
    expect(valuesEquivalent(NaN, NaN)).toBe(false);
  });

  test('number vs string no numérico → false', () => {
    expect(valuesEquivalent(23.4, 'abc')).toBe(false);
  });

  test('strings distintos → false (no hay coerción)', () => {
    expect(valuesEquivalent('hola', 'mundo')).toBe(false);
  });

  test('boolean vs string/number → false', () => {
    expect(valuesEquivalent(true, 1)).toBe(false);
    expect(valuesEquivalent(true, 'true')).toBe(false);
  });
});
