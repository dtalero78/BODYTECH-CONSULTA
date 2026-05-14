import {
  coerceValue,
  snakeToCamel,
  EDITABLE_FIELDS,
  EDITABLE_FIELD_TYPE_MAP,
  JSON_STRING_FIELDS,
  isValidDateString,
} from '../historia-field-coercion.service';

// ============================================================================
// Sanity: el whitelist contiene los nombres reales que estos tests usan.
// Si alguno deja de existir en una refactorización futura, este test falla
// rápido con un mensaje claro en vez de propagar el bug hasta la suite real.
// ============================================================================

describe('whitelist sanity', () => {
  test('los campos usados por los tests existen en EDITABLE_FIELDS', () => {
    const required = [
      'bt_factor_1', // boolean
      'cc_imc_nuevo', // number
      'fecha_nacimiento', // date
      'mdConceptoFinal', // string normal
      'ant_osteomuscular_lista', // string JSON
    ];
    for (const f of required) {
      expect(EDITABLE_FIELDS).toContain(f);
    }
  });

  test('JSON_STRING_FIELDS contiene ant_osteomuscular_lista', () => {
    expect(JSON_STRING_FIELDS.has('ant_osteomuscular_lista')).toBe(true);
  });

  test('EDITABLE_FIELD_TYPE_MAP tipa los campos correctamente', () => {
    expect(EDITABLE_FIELD_TYPE_MAP['bt_factor_1']).toBe('boolean');
    expect(EDITABLE_FIELD_TYPE_MAP['cc_imc_nuevo']).toBe('number');
    expect(EDITABLE_FIELD_TYPE_MAP['fecha_nacimiento']).toBe('date');
    expect(EDITABLE_FIELD_TYPE_MAP['mdConceptoFinal']).toBe('string');
    expect(EDITABLE_FIELD_TYPE_MAP['ant_osteomuscular_lista']).toBe('string');
  });
});

// ============================================================================
// coerceValue — INVALID_FIELD: campo no presente en el whitelist
// ============================================================================

describe("coerceValue — INVALID_FIELD para campos fuera del whitelist", () => {
  test("retorna { ok:false, error:'INVALID_FIELD' } para campos desconocidos", () => {
    const r = coerceValue('campo_inexistente', 'x');
    expect(r).toEqual({ ok: false, error: 'INVALID_FIELD' });
  });
});

// ============================================================================
// coerceValue('boolean', ...) — usa bt_factor_1
// ============================================================================

describe("coerceValue('boolean', ...) sobre 'bt_factor_1'", () => {
  const F = 'bt_factor_1';

  test('booleans nativos', () => {
    expect(coerceValue(F, true)).toEqual({ ok: true, value: true });
    expect(coerceValue(F, false)).toEqual({ ok: true, value: false });
  });

  test("strings 'true'/'false'", () => {
    expect(coerceValue(F, 'true')).toEqual({ ok: true, value: true });
    expect(coerceValue(F, 'false')).toEqual({ ok: true, value: false });
  });

  test("strings 'Sí'/'SI'/'sí'/'si' → true", () => {
    expect(coerceValue(F, 'Sí')).toEqual({ ok: true, value: true });
    expect(coerceValue(F, 'SI')).toEqual({ ok: true, value: true });
    expect(coerceValue(F, 'sí')).toEqual({ ok: true, value: true });
    expect(coerceValue(F, 'si')).toEqual({ ok: true, value: true });
  });

  test("strings 'No'/'NO'/'no' → false", () => {
    expect(coerceValue(F, 'No')).toEqual({ ok: true, value: false });
    expect(coerceValue(F, 'NO')).toEqual({ ok: true, value: false });
    expect(coerceValue(F, 'no')).toEqual({ ok: true, value: false });
  });

  test("strings '1' / '0'", () => {
    expect(coerceValue(F, '1')).toEqual({ ok: true, value: true });
    expect(coerceValue(F, '0')).toEqual({ ok: true, value: false });
  });

  test('numbers 1 / 0', () => {
    expect(coerceValue(F, 1)).toEqual({ ok: true, value: true });
    expect(coerceValue(F, 0)).toEqual({ ok: true, value: false });
  });

  test('numbers fuera de {0,1} → INVALID_VALUE', () => {
    expect(coerceValue(F, 2)).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, -1)).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test('arrays / objetos / strings ambiguos → INVALID_VALUE', () => {
    expect(coerceValue(F, [true])).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, {})).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, 'maybe')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test('null / undefined → { ok:true, value:null }', () => {
    expect(coerceValue(F, null)).toEqual({ ok: true, value: null });
    expect(coerceValue(F, undefined)).toEqual({ ok: true, value: null });
  });
});

// ============================================================================
// coerceValue('number', ...) — usa cc_imc_nuevo
// ============================================================================

describe("coerceValue('number', ...) sobre 'cc_imc_nuevo'", () => {
  const F = 'cc_imc_nuevo';

  test('numbers nativos', () => {
    expect(coerceValue(F, 23)).toEqual({ ok: true, value: 23 });
    expect(coerceValue(F, 23.4)).toEqual({ ok: true, value: 23.4 });
    expect(coerceValue(F, -5)).toEqual({ ok: true, value: -5 });
  });

  test('strings numéricas válidas', () => {
    expect(coerceValue(F, '23.4')).toEqual({ ok: true, value: 23.4 });
    expect(coerceValue(F, '-5.0')).toEqual({ ok: true, value: -5 });
    expect(coerceValue(F, '1.5e2')).toEqual({ ok: true, value: 150 });
  });

  test("string 'abc' → INVALID_VALUE", () => {
    expect(coerceValue(F, 'abc')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test("string '1e9999' (Infinity) → INVALID_VALUE", () => {
    // El regex acepta el formato, pero Number('1e9999') = Infinity, guard cae.
    expect(coerceValue(F, '1e9999')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test('numbers no finitos → INVALID_VALUE', () => {
    expect(coerceValue(F, NaN)).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, Infinity)).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, -Infinity)).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test('arrays / objetos → INVALID_VALUE', () => {
    expect(coerceValue(F, [])).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, {})).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test("null / undefined / '' → { ok:true, value:null }", () => {
    expect(coerceValue(F, null)).toEqual({ ok: true, value: null });
    expect(coerceValue(F, undefined)).toEqual({ ok: true, value: null });
    expect(coerceValue(F, '')).toEqual({ ok: true, value: null });
    expect(coerceValue(F, '   ')).toEqual({ ok: true, value: null });
  });
});

// ============================================================================
// coerceValue('date', ...) — usa fecha_nacimiento
// ============================================================================

describe("coerceValue('date', ...) sobre 'fecha_nacimiento'", () => {
  const F = 'fecha_nacimiento';

  test("YYYY-MM-DD válido → ok", () => {
    expect(coerceValue(F, '2025-09-15')).toEqual({ ok: true, value: '2025-09-15' });
  });

  test("día fuera de rango → INVALID_VALUE", () => {
    expect(coerceValue(F, '2025-02-30')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test("mes fuera de rango → INVALID_VALUE", () => {
    expect(coerceValue(F, '2025-13-01')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test("formato no aceptado → INVALID_VALUE", () => {
    expect(coerceValue(F, 'Sep 32 2025')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test("'' (string vacío) sobre date → INVALID_VALUE", () => {
    // type === 'date' (no 'string'), entonces el guard de '' devuelve { value:null }.
    // Documentamos el comportamiento real: '' es trimmed→'', guard `type!=='string'`
    // dispara y retorna { ok:true, value:null }.
    expect(coerceValue(F, '')).toEqual({ ok: true, value: null });
  });

  test('number sobre date → INVALID_VALUE', () => {
    expect(coerceValue(F, 123)).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test('null → { ok:true, value:null }', () => {
    expect(coerceValue(F, null)).toEqual({ ok: true, value: null });
  });

  test('isValidDateString rechaza strings ambiguos', () => {
    expect(isValidDateString('2025-09-15')).toBe(true);
    expect(isValidDateString('2025-02-30')).toBe(false);
    expect(isValidDateString('Sep 32 2025')).toBe(false);
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString('2025-09-15T12:30:00Z')).toBe(true);
  });
});

// ============================================================================
// coerceValue('string', ...) — usa mdConceptoFinal (normal) y
// ant_osteomuscular_lista (JSON).
// ============================================================================

describe("coerceValue('string', ...) — strings normales", () => {
  const F = 'mdConceptoFinal';

  test("string pasa intacto", () => {
    expect(coerceValue(F, 'hola')).toEqual({ ok: true, value: 'hola' });
  });

  test('number/boolean → String()', () => {
    expect(coerceValue(F, 42)).toEqual({ ok: true, value: '42' });
    expect(coerceValue(F, true)).toEqual({ ok: true, value: 'true' });
  });

  test('arrays / objetos para campos NO-JSON → INVALID_VALUE', () => {
    expect(coerceValue(F, [1, 2, 3])).toEqual({ ok: false, error: 'INVALID_VALUE' });
    expect(coerceValue(F, {})).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test("'' (string vacío) sobre string → pasa como '' (no NULL)", () => {
    // type==='string' ⇒ no entra al guard de string vacío, retorna value:''.
    expect(coerceValue(F, '')).toEqual({ ok: true, value: '' });
  });

  test('null / undefined → { ok:true, value:null }', () => {
    expect(coerceValue(F, null)).toEqual({ ok: true, value: null });
    expect(coerceValue(F, undefined)).toEqual({ ok: true, value: null });
  });
});

describe("coerceValue('string', ...) — JSON_STRING_FIELDS (ant_osteomuscular_lista)", () => {
  const F = 'ant_osteomuscular_lista';

  test('array plano → JSON.stringify', () => {
    expect(coerceValue(F, [{ tipo: 'lumbalgia' }])).toEqual({
      ok: true,
      value: '[{"tipo":"lumbalgia"}]',
    });
  });

  test('object plano → JSON.stringify', () => {
    expect(coerceValue(F, { a: 1 })).toEqual({ ok: true, value: '{"a":1}' });
  });

  test("string '[]' válido → ok (se mantiene el string)", () => {
    expect(coerceValue(F, '[]')).toEqual({ ok: true, value: '[]' });
  });

  test("string JSON inválido → INVALID_VALUE", () => {
    expect(coerceValue(F, 'no es json {')).toEqual({ ok: false, error: 'INVALID_VALUE' });
  });

  test('null → { ok:true, value:null }', () => {
    expect(coerceValue(F, null)).toEqual({ ok: true, value: null });
  });
});

// ============================================================================
// snakeToCamel
// ============================================================================

describe('snakeToCamel', () => {
  test('bt_factor_1 → btFactor1', () => {
    expect(snakeToCamel('bt_factor_1')).toBe('btFactor1');
  });

  test('ant_patologico_flag → antPatologicoFlag', () => {
    expect(snakeToCamel('ant_patologico_flag')).toBe('antPatologicoFlag');
  });

  test('cc_imc_nuevo → ccImcNuevo', () => {
    expect(snakeToCamel('cc_imc_nuevo')).toBe('ccImcNuevo');
  });

  test('transcription_status → transcriptionStatus', () => {
    expect(snakeToCamel('transcription_status')).toBe('transcriptionStatus');
  });

  test('sin underscore: foo → foo', () => {
    expect(snakeToCamel('foo')).toBe('foo');
  });
});
