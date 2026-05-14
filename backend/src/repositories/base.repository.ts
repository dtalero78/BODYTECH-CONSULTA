// ============================================================================
// BaseRepository — fundamento del patrón repositorio multi-tenant.
//
// Encapsula el acceso a `postgresService.query()` con dos métodos `protected`
// para que los repos hijos no toquen `postgresService` directamente.
//
// IMPORTANTE: `postgresService.query()` devuelve `any[] | null` (filas planas),
// NO `QueryResult` de `pg`. Por eso `queryRaw` deriva `rowCount` de `rows.length`
// y trata `null` como error de DB devolviendo `{ rows: [], rowCount: 0 }`.
// ============================================================================

import postgresService from '../services/postgres.service';

export abstract class BaseRepository {
  /**
   * Ejecuta una query y devuelve las filas casteadas a `T`.
   * Si `postgresService.query()` devuelve `null` (error de DB), devuelve `[]`.
   */
  protected async query<T = unknown>(sql: string, params: unknown[]): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await postgresService.query(sql, params as any[]);
    if (rows === null) {
      return [];
    }
    return rows as T[];
  }

  /**
   * Ejecuta una query y devuelve `{ rows, rowCount }`. Para callers que
   * necesitan saber si la query afectó filas (UPDATE/INSERT/DELETE) sin
   * inspeccionar el contenido.
   *
   * Si `postgresService.query()` devuelve `null`, devuelve `{ rows: [],
   * rowCount: 0 }` — replicando el patrón `if (rows === null) return DB_ERROR`
   * que ya existe en los services.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async queryRaw(sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await postgresService.query(sql, params as any[]);
    if (rows === null) {
      return { rows: [], rowCount: 0 };
    }
    return { rows, rowCount: rows.length };
  }
}
