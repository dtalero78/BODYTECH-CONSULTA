import { describe, test, expect } from 'vitest';
import { clasificarActividad } from '../AnamnesisTab';

// Lógica pura extraída de AnamnesisTab. Clasifica el nivel de actividad
// física a partir de (días/semana, minutos/sesión):
//   minSemana < 150   → 'Irregularmente activo'
//   150 ≤ minSemana < 300 → 'Activo'
//   minSemana ≥ 300   → 'Muy activo'
// Cualquier input null/undefined/NaN/Infinity/≤0 → null (sin clasificar).

describe('clasificarActividad', () => {
  test('ambos null → null', () => {
    expect(clasificarActividad(null, null)).toBeNull();
  });

  test('un argumento undefined → null', () => {
    expect(clasificarActividad(undefined, 30)).toBeNull();
    expect(clasificarActividad(3, undefined)).toBeNull();
  });

  test('días <= 0 → null (no clasificar como sedentario por defecto)', () => {
    expect(clasificarActividad(0, 60)).toBeNull();
    expect(clasificarActividad(-1, 60)).toBeNull();
  });

  test('minutos <= 0 → null', () => {
    expect(clasificarActividad(3, 0)).toBeNull();
    expect(clasificarActividad(3, -5)).toBeNull();
  });

  test("(3, 30) = 90 min/semana → 'Irregularmente activo'", () => {
    expect(clasificarActividad(3, 30)).toBe('Irregularmente activo');
  });

  test("(5, 30) = 150 min/semana → 'Activo' (no <150)", () => {
    expect(clasificarActividad(5, 30)).toBe('Activo');
  });

  test("(7, 60) = 420 min/semana → 'Muy activo'", () => {
    expect(clasificarActividad(7, 60)).toBe('Muy activo');
  });

  test('NaN o Infinity → null', () => {
    expect(clasificarActividad(NaN, 30)).toBeNull();
    expect(clasificarActividad(3, Infinity)).toBeNull();
    expect(clasificarActividad(Infinity, 30)).toBeNull();
    expect(clasificarActividad(3, NaN)).toBeNull();
  });

  test("límite inferior: <150 cae en 'Irregularmente activo'", () => {
    expect(clasificarActividad(3, 49)).toBe('Irregularmente activo'); // 147
  });

  test("límite superior: <300 cae en 'Activo', ≥300 en 'Muy activo'", () => {
    expect(clasificarActividad(5, 59)).toBe('Activo'); // 295
    expect(clasificarActividad(5, 60)).toBe('Muy activo'); // 300
  });
});
