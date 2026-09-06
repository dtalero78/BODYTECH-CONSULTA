// ============================================================================
// empresasService — Catálogo de empresas cliente.
//
// Vive en `bodytech_profesionales`, la base compartida del cluster: la empresa
// que contrata exámenes ocupacionales es la misma que contrata análisis de
// composición corporal en ACC, y tenerla dos veces es cómo llegamos a que
// consulta creyera que había 5 sedes y ACC 6 cuando en realidad son 94.
//
// ── Por qué no usa `directorio.service` ─────────────────────────────────────
// Ese archivo es de SOLO LECTURA a propósito y no tiene un solo INSERT: el
// directorio de sedes y planta lo escribe únicamente el importador de RRHH.
// Esa regla sigue intacta. Este servicio escribe —por el pool compartido de
// `shared-db`— pero exclusivamente en `empresas`, una tabla que nadie importa
// de un Excel porque una empresa cliente aparece cuando el médico llega a ella.
//
// ── Por qué se crea el catálogo AHORA ───────────────────────────────────────
// La columna `mc_empresa` se desplegó con cero filas. Es la única ventana para
// poner un catálogo sin migrar nada: en cuanto empiece a recibir texto libre
// van a convivir "Bancolombia", "BANCOLOMBIA S.A." y "bancolombia sa", y
// juntarlos después es trabajo manual y con errores. A ACC ya se le pasó esa
// ventana.
// ============================================================================

import { getSharedPool } from './shared-db';
import { normalizarNombre } from '../helpers/padron.helper';

export interface Empresa {
  id: number;
  nombre: string;
  nit: string | null;
  activa: boolean;
  creadaEn: string;
  creadaPor: string | null;
}

/** Las dos que existen de verdad hoy. El resto se dan de alta desde el panel. */
const SEMILLA: ReadonlyArray<string> = ['Bancolombia', 'Ecopetrol'];

class EmpresasService {
  private getPool = getSharedPool;

  /**
   * Crea la tabla y siembra las empresas reales. Idempotente; se llama al
   * arrancar, igual que las migraciones de la base propia.
   *
   * `nombre_key` es el nombre normalizado con UNIQUE: es lo que impide que la
   * misma empresa entre dos veces por diferencias de mayúsculas o tildes. Se
   * reutiliza `normalizarNombre` del padrón, que ya está probado contra los
   * casos raros de la base (tildes descompuestas incluidas).
   */
  async asegurarEsquema(): Promise<void> {
    const pool = this.getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS empresas (
        id          SERIAL PRIMARY KEY,
        nombre      VARCHAR(200) NOT NULL,
        nombre_key  VARCHAR(200) NOT NULL UNIQUE,
        nit         VARCHAR(30),
        activa      BOOLEAN NOT NULL DEFAULT TRUE,
        creada_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        creada_por  VARCHAR(120)
      )
    `);
    for (const nombre of SEMILLA) {
      await pool.query(
        `INSERT INTO empresas (nombre, nombre_key, creada_por)
         VALUES ($1, $2, 'semilla')
         ON CONFLICT (nombre_key) DO NOTHING`,
        [nombre, normalizarNombre(nombre)],
      );
    }
  }

  async listar(incluirInactivas = false): Promise<Empresa[]> {
    const { rows } = await this.getPool().query(
      `SELECT id, nombre, nit, activa, creada_en, creada_por
         FROM empresas
        ${incluirInactivas ? '' : 'WHERE activa'}
        ORDER BY nombre`,
    );
    return rows.map(mapear);
  }

  /**
   * Alta de una empresa. Devuelve la existente si ya está — dos coordinadores
   * dando de alta "Bancolombia" el mismo día no deben crear dos filas ni ver un
   * error: el resultado que esperan (que la empresa exista) ya se cumplió.
   */
  async crear(input: { nombre: string; nit?: string | null; creadaPor?: string }): Promise<Empresa> {
    const nombre = input.nombre.trim();
    const key = normalizarNombre(nombre);
    if (!key) throw new Error('El nombre de la empresa no puede estar vacío.');

    const pool = this.getPool();
    const { rows } = await pool.query(
      `INSERT INTO empresas (nombre, nombre_key, nit, creada_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (nombre_key) DO UPDATE
         SET nit = COALESCE(EXCLUDED.nit, empresas.nit)
       RETURNING id, nombre, nit, activa, creada_en, creada_por`,
      [nombre, key, input.nit?.trim() || null, input.creadaPor ?? null],
    );
    return mapear(rows[0]);
  }

  /** Baja lógica: una empresa con exámenes hechos no se borra, se desactiva. */
  async desactivar(id: number): Promise<boolean> {
    const { rowCount } = await this.getPool().query(
      'UPDATE empresas SET activa = FALSE WHERE id = $1',
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}

function mapear(row: Record<string, unknown>): Empresa {
  return {
    id: Number(row.id),
    nombre: String(row.nombre),
    nit: row.nit ? String(row.nit) : null,
    activa: Boolean(row.activa),
    creadaEn:
      row.creada_en instanceof Date ? (row.creada_en as Date).toISOString() : String(row.creada_en),
    creadaPor: row.creada_por ? String(row.creada_por) : null,
  };
}

export default new EmpresasService();
