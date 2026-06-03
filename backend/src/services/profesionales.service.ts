// ============================================================================
// profesionales.service — Gestión de médicos y coaches.
//
// Una sola tabla (`profesionales`) con campo `rol` que distingue entre los
// dos tipos. Multi-sede vía `sede_id`. Soft-delete via `activo = false`.
//
// La disponibilidad horaria vive en `profesionales_disponibilidad` y se maneja
// desde `disponibilidad.service.ts` para mantener separadas las dos áreas.
// ============================================================================

import postgresService from './postgres.service';

export type Rol = 'medico' | 'coach';

export interface ProfesionalRow {
  id: number;
  sedeId: string;
  rol: Rol;
  codigo: string;
  primerNombre: string;
  segundoNombre: string | null;
  primerApellido: string;
  segundoApellido: string | null;
  alias: string | null;
  especialidad: string | null;
  numeroLicencia: string | null;
  tipoLicencia: string | null;
  fechaVencimientoLicencia: string | null; // YYYY-MM-DD
  tiempoConsulta: number;
  firma: string | null;
  email: string | null;
  celular: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfesionalInput {
  rol: Rol;
  codigo: string;
  primerNombre: string;
  segundoNombre?: string | null;
  primerApellido: string;
  segundoApellido?: string | null;
  alias?: string | null;
  especialidad?: string | null;
  numeroLicencia?: string | null;
  tipoLicencia?: string | null;
  fechaVencimientoLicencia?: string | null;
  tiempoConsulta?: number;
  firma?: string | null;
  email?: string | null;
  celular?: string | null;
}

export interface ListFilters {
  /**
   * Slug de sede para scopear el query, o `null` para listar todas las sedes
   * (uso interno: endpoint Trepsi `/medicos` que necesita ver médicos del
   * sistema completo).
   */
  sedeId: string | null;
  /**
   * Varias sedes (override de `sedeId`): lista los profesionales de TODAS las
   * sedes indicadas (`sede_id = ANY`). Lo usa el calendario del coordinador
   * para poblar el filtro de profesional cuando se ven varias sedes agrupadas.
   */
  sedeIds?: string[];
  rol?: Rol;
  activo?: boolean;
  search?: string;
  includeFirma?: boolean;
}

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToProfesional(row: Record<string, unknown>): ProfesionalRow {
  return {
    id: Number(row.id),
    sedeId: String(row.sede_id),
    rol: String(row.rol) as Rol,
    codigo: String(row.codigo),
    primerNombre: String(row.primer_nombre),
    segundoNombre: row.segundo_nombre ? String(row.segundo_nombre) : null,
    primerApellido: String(row.primer_apellido),
    segundoApellido: row.segundo_apellido ? String(row.segundo_apellido) : null,
    alias: row.alias ? String(row.alias) : null,
    especialidad: row.especialidad ? String(row.especialidad) : null,
    numeroLicencia: row.numero_licencia ? String(row.numero_licencia) : null,
    tipoLicencia: row.tipo_licencia ? String(row.tipo_licencia) : null,
    fechaVencimientoLicencia:
      row.fecha_vencimiento_licencia instanceof Date
        ? (row.fecha_vencimiento_licencia as Date).toISOString().slice(0, 10)
        : row.fecha_vencimiento_licencia
          ? String(row.fecha_vencimiento_licencia)
          : null,
    tiempoConsulta: Number(row.tiempo_consulta),
    firma: row.firma ? String(row.firma) : null,
    email: row.email ? String(row.email) : null,
    celular: row.celular ? String(row.celular) : null,
    activo: Boolean(row.activo),
    createdAt:
      row.created_at instanceof Date
        ? (row.created_at as Date).toISOString()
        : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? (row.updated_at as Date).toISOString()
        : String(row.updated_at),
  };
}

/**
 * Columnas que se devuelven en queries de listado (sin `firma` por defecto
 * porque puede pesar MB en base64).
 */
const COLS_LIST = `
  id, sede_id, rol, codigo,
  primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
  alias, especialidad,
  numero_licencia, tipo_licencia, fecha_vencimiento_licencia,
  tiempo_consulta,
  NULL::text AS firma,
  email, celular, activo, created_at, updated_at
`;

const COLS_DETAIL = `
  id, sede_id, rol, codigo,
  primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
  alias, especialidad,
  numero_licencia, tipo_licencia, fecha_vencimiento_licencia,
  tiempo_consulta, firma,
  email, celular, activo, created_at, updated_at
`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class ProfesionalesService {
  /**
   * Lista profesionales filtrando por sede + opcionalmente rol/activo/search.
   * Por defecto NO devuelve `firma` (campo pesado).
   */
  async list(filters: ListFilters): Promise<ServiceResult<ProfesionalRow[]>> {
    const cols = filters.includeFirma ? COLS_DETAIL : COLS_LIST;
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.sedeIds && filters.sedeIds.length > 0) {
      where.push(`sede_id = ANY($${i++}::text[])`);
      params.push(filters.sedeIds);
    } else if (filters.sedeId !== null) {
      where.push(`sede_id = $${i++}`);
      params.push(filters.sedeId);
    }
    if (filters.rol) {
      where.push(`rol = $${i++}`);
      params.push(filters.rol);
    }
    if (filters.activo !== undefined) {
      where.push(`activo = $${i++}`);
      params.push(filters.activo);
    }
    if (filters.search && filters.search.trim().length > 0) {
      where.push(
        `(LOWER(primer_nombre) LIKE $${i} OR LOWER(primer_apellido) LIKE $${i} ` +
          `OR LOWER(codigo) LIKE $${i} OR LOWER(COALESCE(alias, '')) LIKE $${i})`
      );
      params.push(`%${filters.search.trim().toLowerCase()}%`);
      i++;
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT ${cols} FROM profesionales ${whereClause} ORDER BY primer_apellido, primer_nombre`;
    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' } };
    }
    return { ok: true, status: 200, data: rows.map(rowToProfesional) };
  }

  async getById(id: number, sedeId: string): Promise<ServiceResult<ProfesionalRow>> {
    const rows = await postgresService.query(
      `SELECT ${COLS_DETAIL} FROM profesionales WHERE id = $1 AND sede_id = $2`,
      [id, sedeId]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' } };
    }
    if (rows.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado.' } };
    }
    return { ok: true, status: 200, data: rowToProfesional(rows[0]) };
  }

  async getByCodigo(codigo: string, sedeId: string): Promise<ServiceResult<ProfesionalRow>> {
    const rows = await postgresService.query(
      `SELECT ${COLS_DETAIL} FROM profesionales WHERE codigo = $1 AND sede_id = $2`,
      [codigo, sedeId]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' } };
    }
    if (rows.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado.' } };
    }
    return { ok: true, status: 200, data: rowToProfesional(rows[0]) };
  }

  async create(
    input: ProfesionalInput,
    sedeId: string
  ): Promise<ServiceResult<ProfesionalRow>> {
    // Validación de unicidad del código (sede-scoped) la hace la constraint
    // de DB; aquí solo manejamos el error.
    const params: unknown[] = [
      sedeId,
      input.rol,
      input.codigo,
      input.primerNombre,
      input.segundoNombre ?? null,
      input.primerApellido,
      input.segundoApellido ?? null,
      input.alias ?? null,
      input.especialidad ?? null,
      input.numeroLicencia ?? null,
      input.tipoLicencia ?? null,
      input.fechaVencimientoLicencia ?? null,
      input.tiempoConsulta ?? 30,
      input.firma ?? null,
      input.email ?? null,
      input.celular ?? null,
    ];
    const sql = `
      INSERT INTO profesionales (
        sede_id, rol, codigo,
        primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
        alias, especialidad,
        numero_licencia, tipo_licencia, fecha_vencimiento_licencia,
        tiempo_consulta, firma, email, celular
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING ${COLS_DETAIL}
    `;
    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      // Asumimos colisión de UNIQUE — el query loguea el error específico.
      return {
        ok: false,
        status: 409,
        error: {
          code: 'DUPLICATE_CODIGO',
          message: `Ya existe un profesional con código '${input.codigo}' en esta sede.`,
        },
      };
    }
    if (rows.length === 0) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error creando profesional.' } };
    }
    return { ok: true, status: 201, data: rowToProfesional(rows[0]) };
  }

  async update(
    id: number,
    sedeId: string,
    input: Partial<ProfesionalInput>
  ): Promise<ServiceResult<ProfesionalRow>> {
    if (Object.keys(input).length === 0) {
      return {
        ok: false,
        status: 400,
        error: { code: 'EMPTY_PATCH', message: 'Debe enviar al menos un campo a actualizar.' },
      };
    }
    // Mapa de camelCase (input) → snake_case (columna).
    const mapping: Record<keyof ProfesionalInput, string> = {
      rol: 'rol',
      codigo: 'codigo',
      primerNombre: 'primer_nombre',
      segundoNombre: 'segundo_nombre',
      primerApellido: 'primer_apellido',
      segundoApellido: 'segundo_apellido',
      alias: 'alias',
      especialidad: 'especialidad',
      numeroLicencia: 'numero_licencia',
      tipoLicencia: 'tipo_licencia',
      fechaVencimientoLicencia: 'fecha_vencimiento_licencia',
      tiempoConsulta: 'tiempo_consulta',
      firma: 'firma',
      email: 'email',
      celular: 'celular',
    };
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping) as [keyof ProfesionalInput, string][]) {
      if (input[key] !== undefined) {
        sets.push(`${col} = $${i++}`);
        params.push(input[key]);
      }
    }
    params.push(id, sedeId);
    const sql = `
      UPDATE profesionales SET ${sets.join(', ')}
      WHERE id = $${i++} AND sede_id = $${i}
      RETURNING ${COLS_DETAIL}
    `;
    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'UPDATE_FAILED',
          message: 'No se pudo actualizar (posible colisión de código único).',
        },
      };
    }
    if (rows.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado.' } };
    }
    return { ok: true, status: 200, data: rowToProfesional(rows[0]) };
  }

  /**
   * Soft-delete: marca activo = false. No borra disponibilidades para preservar
   * historial.
   */
  async softDelete(id: number, sedeId: string): Promise<ServiceResult<{ id: number }>> {
    const rows = await postgresService.query(
      `UPDATE profesionales SET activo = FALSE, updated_at = NOW()
        WHERE id = $1 AND sede_id = $2
        RETURNING id`,
      [id, sedeId]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error desactivando profesional.' } };
    }
    if (rows.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado.' } };
    }
    return { ok: true, status: 200, data: { id: Number(rows[0].id) } };
  }
}

export default new ProfesionalesService();
