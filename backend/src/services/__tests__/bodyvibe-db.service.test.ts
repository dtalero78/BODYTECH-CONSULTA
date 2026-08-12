// ============================================================================
// Validación de forma del SQL que ejecutan los apps de BodyVibeTech.
//
// Esta es la capa que produce el mensaje de error entendible; las que de
// verdad cierran la puerta son la transacción de solo lectura y los GRANT del
// rol `bodyvibe_ro` (ver bodyvibe-db.service). Aun así se prueba, porque es la
// única de las cuatro que se puede equivocar en silencio: un falso "ok" acá no
// abre un hueco, pero un falso rechazo rompe apps legítimos y se diagnostica
// mal.
// ============================================================================

import { validarFormaSQL } from '../bodyvibe-db.service';

describe('validarFormaSQL', () => {
  describe('acepta lecturas legítimas', () => {
    const validas: [string, string][] = [
      ['SELECT simple', 'SELECT * FROM bv_citas'],
      ['con minúsculas', 'select sede, count(*) from bv_citas group by sede'],
      ['con CTE', 'WITH x AS (SELECT 1 AS n) SELECT n FROM x'],
      ['con salto de línea inicial', '\n  SELECT 1'],
      ['con punto y coma final', 'SELECT * FROM bv_citas;'],
      ['con punto y coma final y espacios', 'SELECT * FROM bv_citas ;  \n'],
      ['con punto y coma dentro de un literal', "SELECT * FROM bv_citas WHERE nota = 'a;b'"],
      ['con comilla escapada dentro del literal', "SELECT 'O''Brien; y algo' AS quien"],
      ['con parámetros', 'SELECT * FROM bv_citas WHERE sede = $1 AND fecha >= $2'],
    ];

    it.each(validas)('%s', (_nombre, sql) => {
      expect(validarFormaSQL(sql)).toEqual({ ok: true });
    });
  });

  describe('rechaza lo que no es una lectura', () => {
    const escrituras = [
      'INSERT INTO bv_citas VALUES (1)',
      'UPDATE "HistoriaClinica" SET tas = 120',
      'DELETE FROM citas',
      'DROP TABLE bv_citas',
      'TRUNCATE citas',
      'ALTER TABLE citas ADD COLUMN x INT',
      'GRANT SELECT ON citas TO bodyvibe_ro',
      'CREATE TABLE fuga AS SELECT * FROM "HistoriaClinica"',
      'COPY citas TO STDOUT',
      'SET default_transaction_read_only = off',
      'DO $$ BEGIN END $$',
    ];

    it.each(escrituras)('%s', (sql) => {
      const r = validarFormaSQL(sql);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('not_select');
    });
  });

  describe('rechaza más de una sentencia', () => {
    const encadenadas = [
      'SELECT 1; DROP TABLE citas',
      'SELECT 1;DELETE FROM citas',
      "SELECT 'x'; UPDATE citas SET estado = 'atendida'",
      'WITH x AS (SELECT 1) SELECT * FROM x; SELECT 2',
    ];

    it.each(encadenadas)('%s', (sql) => {
      const r = validarFormaSQL(sql);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('multiple_statements');
    });

    it('no se deja engañar por un punto y coma escondido en un literal', () => {
      // El `;` real viene DESPUÉS de cerrar la cadena: hay que rechazarlo
      // aunque el literal anterior también contenga uno.
      const r = validarFormaSQL("SELECT 'a;b' AS t; DROP TABLE citas");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('multiple_statements');
    });
  });

  it('rechaza texto vacío', () => {
    expect(validarFormaSQL('   ').ok).toBe(false);
  });
});
