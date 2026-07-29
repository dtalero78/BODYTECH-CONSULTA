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

  /**
   * Indicadores POR EVENTO (No Contesta + Reprogramaciones) derivados del
   * audit_log — la fuente correcta para métricas históricas, porque el estado
   * de la cita (`atendido`) es un snapshot que se sobreescribe al reagendar/
   * atender. Se cuenta por FECHA DEL EVENTO (created_at) en el rango [from,to].
   *
   * - No Contesta: eventos `no_contesta`, atribuidos al coach de la historia.
   * - Reprogramaciones: eventos del link de WhatsApp del paciente
   *   (`/api/video/reprogramar/:id`), por coach y el top de pacientes que más
   *   reprograman (serial-reprogramadores). Los eventos viejos son `post_video`
   *   con el id en la ruta; los nuevos ya vienen como accion='reprogramar'.
   *
   * `sedes` acota por la sede del profesional (aislamiento multi-sede).
   */
  async indicadoresEventos(
    from: string,
    to: string,
    sedes: string[]
  ): Promise<{
    desde: string;
    hasta: string;
    noContesta: Array<{ codigo: string; nombre: string; total: number }>;
    reprogramaciones: {
      porCoach: Array<{ codigo: string; nombre: string; total: number }>;
      topPacientes: Array<{ numeroId: string; nombre: string; coach: string; total: number }>;
      total: number;
    };
  }> {
    // Rango por fecha del evento, en zona Colombia (to inclusive → < to+1).
    const rangoSql = `a.created_at >= ($1::date)::timestamp AT TIME ZONE 'America/Bogota'
                      AND a.created_at < (($2::date) + 1)::timestamp AT TIME ZONE 'America/Bogota'`;
    // Historia asociada al evento: no_contesta trae entidad_id; reprogramar viejo
    // (post_video) lleva el id en la ruta → COALESCE cubre ambos.
    const joinHist = `JOIN "HistoriaClinica" h
        ON h."_id" = COALESCE(a.entidad_id, substring(a.ruta from '/reprogramar/([^/?]+)'))
      JOIN profesionales p ON p.codigo = h."medico" AND p.sede_id = ANY($3::text[])`;
    const params = [from, to, sedes];

    const [ncRows, reproCoach, reproTop] = await Promise.all([
      postgresService.query(
        `SELECT h."medico" AS codigo, COALESCE(p.alias, h."medico") AS nombre, COUNT(*)::int AS total
           FROM audit_log a ${joinHist}
          WHERE a.accion = 'no_contesta' AND ${rangoSql}
          GROUP BY h."medico", COALESCE(p.alias, h."medico")
          ORDER BY total DESC`,
        params
      ),
      postgresService.query(
        `SELECT h."medico" AS codigo, COALESCE(p.alias, h."medico") AS nombre, COUNT(*)::int AS total
           FROM audit_log a ${joinHist}
          WHERE (a.accion = 'reprogramar' OR a.ruta LIKE '%/api/video/reprogramar/%') AND ${rangoSql}
          GROUP BY h."medico", COALESCE(p.alias, h."medico")
          ORDER BY total DESC`,
        params
      ),
      postgresService.query(
        `SELECT h."numeroId" AS numero, trim(h."primerNombre"||' '||h."primerApellido") AS nombre,
                COALESCE(p.alias, h."medico") AS coach, COUNT(*)::int AS total
           FROM audit_log a ${joinHist}
          WHERE (a.accion = 'reprogramar' OR a.ruta LIKE '%/api/video/reprogramar/%') AND ${rangoSql}
          GROUP BY h."numeroId", trim(h."primerNombre"||' '||h."primerApellido"), COALESCE(p.alias, h."medico")
         HAVING COUNT(*) >= 2
          ORDER BY total DESC
          LIMIT 25`,
        params
      ),
    ]);

    const porCoach = (reproCoach ?? []).map((r) => ({
      codigo: String(r.codigo),
      nombre: String(r.nombre),
      total: Number(r.total),
    }));
    return {
      desde: from,
      hasta: to,
      noContesta: (ncRows ?? []).map((r) => ({
        codigo: String(r.codigo),
        nombre: String(r.nombre),
        total: Number(r.total),
      })),
      reprogramaciones: {
        porCoach,
        topPacientes: (reproTop ?? []).map((r) => ({
          numeroId: String(r.numero),
          nombre: String(r.nombre),
          coach: String(r.coach),
          total: Number(r.total),
        })),
        total: porCoach.reduce((a, c) => a + c.total, 0),
      },
    };
  }
}

export default new AuditService();
