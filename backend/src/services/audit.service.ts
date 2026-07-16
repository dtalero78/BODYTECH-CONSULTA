// ============================================================================
// audit.service — Bitácora transversal de acciones (quién + qué + cuándo).
//
// `record()` inserta una entrada y es BEST-EFFORT: nunca lanza ni bloquea, para
// que la auditoría jamás rompa un request (igual filosofía que el torniquete y
// el session-tracker). La alimenta `auditMiddleware`; también puede llamarse
// explícitamente desde un controller cuando se quiere `detalle` semántico
// (p. ej. before/after de una reprogramación).
//
// `query()` la lee con filtros para el endpoint admin (/api/admin/audit).
// ============================================================================

import postgresService from './postgres.service';

export interface AuditEntry {
  actorUserId?: number | null;
  actorEmail?: string | null;
  actorNombre?: string | null;
  actorCodigo?: string | null;
  actorRol?: string | null;
  actorSede?: string | null;
  metodo: string;
  ruta: string;
  accion?: string | null;
  entidad?: string | null;
  entidadId?: string | null;
  statusCode?: number | null;
  ip?: string | null;
  detalle?: Record<string, unknown> | null;
}

export interface AuditQueryFilters {
  actorCodigo?: string;
  accion?: string;
  entidad?: string;
  entidadId?: string;
  from?: string; // ISO 8601
  to?: string;
  limit?: number;
  offset?: number;
}

class AuditService {
  /** Inserta una entrada de auditoría. Best-effort: nunca lanza. */
  async record(e: AuditEntry): Promise<void> {
    try {
      await postgresService.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_email, actor_nombre, actor_codigo, actor_rol,
            actor_sede, metodo, ruta, accion, entidad, entidad_id, status_code, ip, detalle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
        [
          e.actorUserId ?? null,
          e.actorEmail ?? null,
          e.actorNombre ?? null,
          e.actorCodigo ?? null,
          e.actorRol ?? null,
          e.actorSede ?? null,
          e.metodo,
          e.ruta.slice(0, 2000),
          e.accion ?? null,
          e.entidad ?? null,
          e.entidadId ?? null,
          e.statusCode ?? null,
          e.ip ?? null,
          e.detalle ? JSON.stringify(e.detalle) : null,
        ]
      );
    } catch (err) {
      // La auditoría nunca debe romper el flujo principal.
      console.error('❌ [audit] no se pudo registrar:', (err as Error)?.message ?? err);
    }
  }

  /** Lee la bitácora con filtros opcionales. Devuelve filas + total. */
  async query(f: AuditQueryFilters): Promise<{ rows: unknown[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (f.actorCodigo) {
      where.push(`actor_codigo = $${i++}`);
      params.push(f.actorCodigo);
    }
    if (f.accion) {
      where.push(`accion = $${i++}`);
      params.push(f.accion);
    }
    if (f.entidad) {
      where.push(`entidad = $${i++}`);
      params.push(f.entidad);
    }
    if (f.entidadId) {
      where.push(`entidad_id = $${i++}`);
      params.push(f.entidadId);
    }
    if (f.from) {
      where.push(`created_at >= $${i++}`);
      params.push(f.from);
    }
    if (f.to) {
      where.push(`created_at <= $${i++}`);
      params.push(f.to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
    const offset = Math.max(f.offset ?? 0, 0);

    const rows = await postgresService.query(
      `SELECT id, created_at, actor_user_id, actor_email, actor_nombre, actor_codigo,
              actor_rol, actor_sede, metodo, ruta, accion, entidad, entidad_id,
              status_code, ip, detalle
         FROM audit_log
         ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );
    const countRes = await postgresService.query(
      `SELECT COUNT(*)::int AS total FROM audit_log ${whereSql}`,
      params
    );
    const total = (countRes?.[0] as { total: number } | undefined)?.total ?? 0;
    return { rows: rows ?? [], total };
  }
}

export default new AuditService();
