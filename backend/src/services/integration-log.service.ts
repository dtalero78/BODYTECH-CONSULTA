// ============================================================================
// integration-log.service — Persistencia de eventos para el monitor de la
// integración Trepsi.
//
// Recibe eventos `inbound` (Trepsi → Bodytech, vía middleware) y `outbound`
// (Bodytech → Trepsi, llamados desde trepsi-webhook.service).
// ============================================================================

import postgresService from './postgres.service';

export type Direccion = 'inbound' | 'outbound';

export interface LogInput {
  direccion: Direccion;
  tipo: string; // Ej: 'listMedicos', 'createAppointment', 'webhook.consultationResults'
  metodo?: string | null;
  path?: string | null;
  citaId?: string | null;
  statusCode?: number | null;
  ok: boolean;
  latencyMs?: number | null;
  requestBody?: unknown;
  responseBody?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LogRow {
  id: number;
  direccion: Direccion;
  tipo: string;
  metodo: string | null;
  path: string | null;
  cita_id: string | null;
  status_code: number | null;
  ok: boolean;
  latency_ms: number | null;
  request_body: unknown;
  response_body: unknown;
  error_code: string | null;
  error_message: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

// Tamaño máximo (en chars de JSON serializado) de los bodies que persistimos
// para no inflar la DB. Truncamos al guardar.
const MAX_BODY_CHARS = 8000;

function truncate(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_BODY_CHARS) {
      return { _truncated: true, _originalLength: json.length, preview: json.slice(0, MAX_BODY_CHARS) };
    }
    return value;
  } catch {
    return { _error: 'no_serializable' };
  }
}

class IntegrationLogService {
  /**
   * Inserta un evento. Best-effort: si la DB falla, loguea por consola y
   * devuelve null (no rompe el flujo principal).
   */
  async log(input: LogInput): Promise<number | null> {
    try {
      const reqBody = truncate(input.requestBody);
      const resBody = truncate(input.responseBody);
      const rows = await postgresService.query(
        `INSERT INTO trepsi_integration_log (
           direccion, tipo, metodo, path, cita_id, status_code, ok,
           latency_ms, request_body, response_body, error_code, error_message,
           ip, user_agent
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          input.direccion,
          input.tipo.slice(0, 80),
          input.metodo?.slice(0, 10) ?? null,
          input.path?.slice(0, 300) ?? null,
          input.citaId ?? null,
          input.statusCode ?? null,
          input.ok,
          input.latencyMs ?? null,
          reqBody !== null ? JSON.stringify(reqBody) : null,
          resBody !== null ? JSON.stringify(resBody) : null,
          input.errorCode?.slice(0, 80) ?? null,
          input.errorMessage?.slice(0, 2000) ?? null,
          input.ip?.slice(0, 45) ?? null,
          input.userAgent?.slice(0, 500) ?? null,
        ]
      );
      return rows && rows.length > 0 ? Number(rows[0].id) : null;
    } catch (err) {
      console.error('[integration-log] insert fallo:', err);
      return null;
    }
  }

  /**
   * Lista eventos con id > `sinceId`. Si `sinceId` es null, devuelve los
   * últimos `limit` (ordenados ascendente para que el frontend los pinte
   * en orden cronológico natural).
   *
   * Cursor por id en vez de created_at porque Postgres almacena
   * timestamptz con precisión de microsegundos pero JS solo serializa
   * con milisegundos (toISOString) → si se usara `created_at > $since`,
   * el mismo evento volvería a aparecer indefinidamente.
   */
  async listSince(sinceId: number | null, limit = 200): Promise<LogRow[]> {
    let rows;
    if (sinceId !== null && sinceId >= 0) {
      rows = await postgresService.query(
        `SELECT * FROM trepsi_integration_log
           WHERE id > $1
           ORDER BY id ASC
           LIMIT $2`,
        [sinceId, limit]
      );
    } else {
      rows = await postgresService.query(
        `SELECT * FROM trepsi_integration_log
           ORDER BY id DESC
           LIMIT $1`,
        [limit]
      );
      if (rows) rows.reverse();
    }
    return (rows ?? []) as LogRow[];
  }
}

export default new IntegrationLogService();
