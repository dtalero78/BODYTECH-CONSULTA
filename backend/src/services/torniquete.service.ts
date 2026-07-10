// ============================================================================
// torniqueteService — Control de jornada laboral (entrada/salida) de los
// profesionales (médicos/coaches) en la plataforma.
//
// Modelo: tabla `torniquete_jornadas`, una fila por sesión de jornada
// (entrada → salida). Se alimenta de tres eventos:
//
//   1) heartbeat(codigo, sede, rol) — el frontend late cada ~90s mientras el
//      profesional tiene la plataforma abierta. Extiende la jornada abierta
//      reciente o abre una nueva si el corte superó la ventana de inactividad.
//   2) logout(codigo, sede) — cierre explícito: fija salida_at + cerrada.
//   3) cerrarInactivas() — worker (cada 60s) que cierra jornadas cuyo último
//      latido superó la ventana (cierre de pestaña / suspensión del equipo).
//
// "Salida efectiva" = COALESCE(salida_at, ultimo_latido_at). "En línea ahora" =
// jornada NO cerrada cuyo último latido cae dentro de la ventana de inactividad.
//
// Todas las fechas se agrupan por el día calendario en Colombia (UTC-5) vía
// `AT TIME ZONE 'America/Bogota'`, para no depender del TZ del server (UTC en
// prod). Ver el "Timezone gotcha" de CLAUDE.md.
// ============================================================================

import postgresService from './postgres.service';

// Ventana de inactividad: sin latido por más de este tiempo, la jornada se
// considera terminada. Debe ser cómodamente mayor que el intervalo de heartbeat
// del frontend (~90s) para tolerar throttling de pestañas en segundo plano.
const VENTANA_INACTIVIDAD_MIN = 5;

export type TorniqueteRol = 'medico' | 'coach';

export interface BoardProfesional {
  codigo: string;
  nombre: string;
  rol: 'medico' | 'coach' | null;
  sedeId: string;
  enLinea: boolean;
  /** Entrada de la jornada abierta actual (solo si enLinea). ISO o null. */
  enLineaDesde: string | null;
  /** Primera entrada del día (la más antigua). ISO o null si no se conectó. */
  primeraEntrada: string | null;
  /** Última salida efectiva del día (logout o último latido). ISO o null. */
  ultimaSalida: string | null;
  /** Minutos conectados hoy (suma de todas las jornadas del día). */
  minutosConectado: number;
  /** Nº de tramos de conexión del día. */
  jornadas: number;
}

export interface BoardResult {
  fecha: string;
  sedeIds: string[];
  ahoraEnLinea: number;
  profesionales: BoardProfesional[];
}

class TorniqueteService {
  /**
   * Registra un latido de presencia. Si hay una jornada abierta y reciente para
   * (codigo, sede), extiende su último latido; si no, abre una jornada nueva.
   * Retorna true si registró, false ante error de BD.
   */
  async heartbeat(codigo: string, sedeId: string, rol?: TorniqueteRol | null): Promise<boolean> {
    // 1) Intentar extender una jornada abierta y fresca (dentro de la ventana).
    const extend = await postgresService.query(
      `UPDATE torniquete_jornadas
          SET ultimo_latido_at = NOW(), updated_at = NOW()
        WHERE codigo = $1 AND sede_id = $2 AND cerrada = FALSE
          AND ultimo_latido_at > NOW() - ($3 || ' minutes')::interval
        RETURNING id`,
      [codigo, sedeId, String(VENTANA_INACTIVIDAD_MIN)]
    );
    if (extend === null) return false;
    if (extend.length > 0) return true;

    // 2) No hay jornada fresca abierta → abrir una nueva. `fecha` = día Colombia.
    const insert = await postgresService.query(
      `INSERT INTO torniquete_jornadas (codigo, sede_id, rol, fecha, entrada_at, ultimo_latido_at)
       VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'America/Bogota')::date, NOW(), NOW())
       RETURNING id`,
      [codigo, sedeId, rol ?? null]
    );
    return insert !== null;
  }

  /**
   * Cierre explícito de jornada (logout). Fija salida_at = NOW() y cerrada en
   * todas las jornadas abiertas de (codigo, sede). Idempotente.
   */
  async logout(codigo: string, sedeId: string): Promise<boolean> {
    const res = await postgresService.query(
      `UPDATE torniquete_jornadas
          SET salida_at = NOW(), ultimo_latido_at = NOW(), cerrada = TRUE, updated_at = NOW()
        WHERE codigo = $1 AND sede_id = $2 AND cerrada = FALSE`,
      [codigo, sedeId]
    );
    return res !== null;
  }

  /**
   * Worker: cierra las jornadas cuyo último latido superó la ventana de
   * inactividad (cierre de pestaña / equipo suspendido). No fija salida_at — la
   * salida efectiva queda en `ultimo_latido_at`. Retorna cuántas cerró.
   */
  async cerrarInactivas(): Promise<number> {
    const res = await postgresService.query(
      `UPDATE torniquete_jornadas
          SET cerrada = TRUE, updated_at = NOW()
        WHERE cerrada = FALSE
          AND ultimo_latido_at < NOW() - ($1 || ' minutes')::interval
        RETURNING id`,
      [String(VENTANA_INACTIVIDAD_MIN)]
    );
    return res ? res.length : 0;
  }

  /**
   * Tablero del día: por cada profesional activo de la(s) sede(s), su estado de
   * jornada de HOY (Colombia). Lista TODOS los profesionales activos (aunque no
   * se hayan conectado) para que el coordinador vea ausencias.
   */
  async getBoard(sedeIds: string[], fechaParam?: string | null): Promise<BoardResult | null> {
    // `fechaParam` (YYYY-MM-DD) permite consultar un día pasado; null → hoy
    // (Colombia). Para días pasados `en_linea` cae naturalmente a false (los
    // latidos son viejos), así que la misma query sirve para hoy y para historial.
    const fecha = fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : null;
    if (!sedeIds || sedeIds.length === 0) {
      return { fecha: fecha ?? '', sedeIds: [], ahoraEnLinea: 0, profesionales: [] };
    }

    const rows = await postgresService.query(
      `SELECT
          p.codigo,
          p.sede_id,
          p.rol,
          p.alias,
          p.primer_nombre,
          p.primer_apellido,
          j.primera_entrada,
          j.ultima_salida,
          j.en_linea,
          j.en_linea_desde,
          j.total_seg,
          j.jornadas,
          COALESCE($3::date, (NOW() AT TIME ZONE 'America/Bogota')::date) AS fecha_ref
        FROM profesionales p
        LEFT JOIN LATERAL (
          SELECT
            MIN(t.entrada_at) AS primera_entrada,
            MAX(COALESCE(t.salida_at, t.ultimo_latido_at)) AS ultima_salida,
            BOOL_OR(t.cerrada = FALSE AND t.ultimo_latido_at > NOW() - ($2 || ' minutes')::interval) AS en_linea,
            MAX(t.entrada_at) FILTER (
              WHERE t.cerrada = FALSE AND t.ultimo_latido_at > NOW() - ($2 || ' minutes')::interval
            ) AS en_linea_desde,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(t.salida_at, t.ultimo_latido_at) - t.entrada_at))), 0)::bigint AS total_seg,
            COUNT(*)::int AS jornadas
          FROM torniquete_jornadas t
          WHERE t.codigo = p.codigo
            AND t.sede_id = p.sede_id
            AND t.fecha = COALESCE($3::date, (NOW() AT TIME ZONE 'America/Bogota')::date)
        ) j ON TRUE
        WHERE p.sede_id = ANY($1::text[]) AND p.activo = TRUE`,
      [sedeIds, String(VENTANA_INACTIVIDAD_MIN), fecha]
    );
    if (rows === null) return null;

    const fechaRef = rows.length > 0 ? this.dateToIso(rows[0].fecha_ref) : (fecha ?? '');

    const profesionales: BoardProfesional[] = rows.map((r: Record<string, unknown>) => {
      const nombre =
        (r.alias ? String(r.alias) : '') ||
        [r.primer_nombre, r.primer_apellido].filter(Boolean).join(' ') ||
        String(r.codigo);
      const jornadas = Number(r.jornadas) || 0;
      const totalSeg = Number(r.total_seg) || 0;
      return {
        codigo: String(r.codigo),
        nombre,
        rol: r.rol === 'coach' ? 'coach' : r.rol === 'medico' ? 'medico' : null,
        sedeId: String(r.sede_id),
        enLinea: r.en_linea === true,
        enLineaDesde: r.en_linea_desde ? this.tsToIso(r.en_linea_desde) : null,
        primeraEntrada: r.primera_entrada ? this.tsToIso(r.primera_entrada) : null,
        ultimaSalida: r.ultima_salida ? this.tsToIso(r.ultima_salida) : null,
        minutosConectado: Math.round(totalSeg / 60),
        jornadas,
      };
    });

    // Orden: en línea primero; luego quien se conectó (por entrada más
    // temprana); los que no se conectaron al final; empate → alfabético.
    profesionales.sort((a, b) => {
      if (a.enLinea !== b.enLinea) return a.enLinea ? -1 : 1;
      const aConn = a.jornadas > 0;
      const bConn = b.jornadas > 0;
      if (aConn !== bConn) return aConn ? -1 : 1;
      if (a.primeraEntrada && b.primeraEntrada && a.primeraEntrada !== b.primeraEntrada) {
        return a.primeraEntrada < b.primeraEntrada ? -1 : 1;
      }
      return a.nombre.localeCompare(b.nombre);
    });

    const ahoraEnLinea = profesionales.filter((p) => p.enLinea).length;
    return { fecha: fechaRef, sedeIds, ahoraEnLinea, profesionales };
  }

  /** Normaliza un timestamp de pg (Date o string) a ISO. */
  private tsToIso(v: unknown): string {
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }

  /** Normaliza un DATE de pg (Date o 'YYYY-MM-DD') a 'YYYY-MM-DD'. */
  private dateToIso(v: unknown): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }
}

export default new TorniqueteService();
