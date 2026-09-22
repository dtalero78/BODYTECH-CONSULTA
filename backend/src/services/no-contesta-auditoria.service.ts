// ============================================================================
// no-contesta-auditoria.service — ¿El "No contesta" fue del paciente?
//
// "No contesta" lo marca el coach a mano, y hasta acá nada lo contrastaba con
// lo que pasó en la sala. Al cruzarlo (18-sep-2026) salió que en 47 de 235
// "No contesta" el paciente se conectó a tiempo a la videollamada y el coach
// nunca entró. Esta es la cuenta que alimenta la pantalla "Auditoría No
// contesta" del coordinador.
//
// Las tres señales, y de dónde salen:
//   · el paciente entró → `client_diag`, evento `session-info` con role
//     'patient': el navegador del paciente lo manda UNA vez al quedar dentro de
//     la sala. Existe desde el 19-ago-2026; antes no hay con qué medir.
//   · el coach entró    → `room_historia_map`: se escribe cuando el coach se
//     conecta a la consulta de esa cita.
//   · cuándo se marcó   → `audit_log`, acción 'no_contesta' (el clic).
//
// Cada "No contesta" cae en una de estas partes (pedidas por Daniel, 19-sep):
//   · Paciente nunca se conectó.
//   · Paciente se conectó tarde: más de 15 min después de la hora, y el coach
//     no entró. Ahí marcar "No contesta" es razonable.
//   · Coach no se conectó (el "caso"): el paciente se conectó A TIEMPO y el
//     coach no entró nunca.
//   · Los dos se conectaron: no se muestra como indicador.
// En "Coach no se conectó" no importa si el coach marcó antes o después de que
// el paciente llegara: al principio se separaban, y la diferencia confundía sin
// cambiar el hallazgo (Daniel, 18-sep). No mide cuánto se quedó el paciente,
// solo que llegó.
// ============================================================================

import postgresService from './postgres.service';
import { EFFECTIVE_SEDE_SQL, TIENE_FICHA_SQL, getRangeUtc, ServiceResult } from './calendario.service';

/** Hasta cuántos minutos después de la hora de la cita el paciente llegó a tiempo. */
export const MINUTOS_A_TIEMPO = 15;

/** Conectarse antes de la hora también es a tiempo. */
export function llegoATiempo(citaMs: number, entroMs: number): boolean {
  return entroMs <= citaMs + MINUTOS_A_TIEMPO * 60_000;
}

/** Un "No contesta" tal como sale de la base. */
export interface FilaNoContesta {
  historia_id: string;
  medico: string | null;
  primer_nombre: string | null;
  primer_apellido: string | null;
  cita: Date | string;
  marcado_at: Date | string | null;
  paciente_entro_at: Date | string | null;
  coach_entro: boolean;
  llamadas_antes: number | string;
  atendia_otro: boolean;
}

export interface ConteoCoach {
  medico: string | null;
  citas: number | string;
  no_contesta: number | string;
}

/** Un paciente que se conectó a tiempo y el coach nunca entró. */
export interface CasoEspera {
  historiaId: string;
  medicoCodigo: string;
  paciente: string;
  cita: string;
  pacienteEntro: string;
  marcado: string | null;
  atendiaOtro: boolean;
  llamo: boolean;
}

export interface AuditoriaCoach {
  medicoCodigo: string;
  nombre: string;
  citas: number;
  noContesta: number;
  /** "No contesta" con al menos una llamada del botón antes de marcar. */
  llamadosAntes: number;
  /** "No contesta" en los que el paciente nunca se conectó. */
  nuncaSeConecto: number;
  /** El paciente se conectó más de 15 min tarde y el coach no entró. */
  tarde: number;
  /** "Coach no se conectó": el paciente llegó a tiempo y el coach no entró. */
  casos: number;
  atendiaOtro: number;
}

export interface AuditoriaNoContesta {
  from: string;
  to: string;
  citas: number;
  noContesta: number;
  llamadosAntes: number;
  nuncaSeConecto: number;
  tarde: number;
  casos: number;
  atendiaOtro: number;
  porCoach: AuditoriaCoach[];
  casosDetalle: CasoEspera[];
}

const SIN_ASIGNAR = '__SIN_ASIGNAR__';

function ms(v: Date | string): number {
  return new Date(v).getTime();
}

function iso(v: Date | string): string {
  return new Date(v).toISOString();
}

/**
 * Arma el resumen a partir de las filas. Pura: toda la decisión de qué es un
 * caso vive acá y no en el SQL, para poder probarla sin base.
 */
export function resumirAuditoria(
  from: string,
  to: string,
  conteos: ConteoCoach[],
  filas: FilaNoContesta[],
  nombres: Map<string, string>
): AuditoriaNoContesta {
  const coaches = new Map<string, AuditoriaCoach>();
  const coachDe = (codigo: string): AuditoriaCoach => {
    let c = coaches.get(codigo);
    if (!c) {
      c = {
        medicoCodigo: codigo,
        nombre: codigo === SIN_ASIGNAR ? 'Sin asignar' : nombres.get(codigo) || codigo,
        citas: 0,
        noContesta: 0,
        llamadosAntes: 0,
        nuncaSeConecto: 0,
        tarde: 0,
        casos: 0,
        atendiaOtro: 0,
      };
      coaches.set(codigo, c);
    }
    return c;
  };

  for (const k of conteos) {
    const c = coachDe(k.medico || SIN_ASIGNAR);
    c.citas += Number(k.citas) || 0;
    c.noContesta += Number(k.no_contesta) || 0;
  }

  const casosDetalle: CasoEspera[] = [];
  let llamadosAntes = 0;
  for (const f of filas) {
    const codigo = f.medico || SIN_ASIGNAR;
    const c = coachDe(codigo);
    const llamo = Number(f.llamadas_antes) > 0;
    if (llamo) {
      c.llamadosAntes += 1;
      llamadosAntes += 1;
    }
    if (!f.paciente_entro_at) {
      c.nuncaSeConecto += 1;
      continue;
    }
    // Si el coach entró, se vieron (o pudieron verse): eso ya no es un
    // paciente esperando, llegue a la hora que llegue.
    if (f.coach_entro) continue;
    if (!llegoATiempo(ms(f.cita), ms(f.paciente_entro_at))) {
      c.tarde += 1;
      continue;
    }

    c.casos += 1;
    if (f.atendia_otro) c.atendiaOtro += 1;
    casosDetalle.push({
      historiaId: f.historia_id,
      medicoCodigo: codigo,
      paciente: [f.primer_nombre, f.primer_apellido].filter(Boolean).join(' ').trim(),
      cita: iso(f.cita),
      pacienteEntro: iso(f.paciente_entro_at),
      marcado: f.marcado_at ? iso(f.marcado_at) : null,
      atendiaOtro: !!f.atendia_otro,
      llamo,
    });
  }

  casosDetalle.sort((a, b) => a.cita.localeCompare(b.cita));
  const todos = Array.from(coaches.values());
  // Los totales cuentan a todos; la tabla solo a quien tiene algo que mostrar.
  const porCoach = todos
    .filter((c) => c.noContesta > 0 || c.casos > 0)
    // Primero quien más pacientes dejó esperando; empate → más "No contesta".
    .sort((a, b) => b.casos - a.casos || b.noContesta - a.noContesta || a.nombre.localeCompare(b.nombre));

  return {
    from,
    to,
    citas: todos.reduce((acc, c) => acc + c.citas, 0),
    noContesta: todos.reduce((acc, c) => acc + c.noContesta, 0),
    nuncaSeConecto: todos.reduce((acc, c) => acc + c.nuncaSeConecto, 0),
    tarde: todos.reduce((acc, c) => acc + c.tarde, 0),
    llamadosAntes,
    casos: casosDetalle.length,
    atendiaOtro: casosDetalle.filter((c) => c.atendiaOtro).length,
    porCoach,
    casosDetalle,
  };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// Las mismas citas que cuenta el resto del panel, con dos exclusiones:
//  · Médico Corporativo: el examen es presencial, su "No asistió" nunca pasa
//    por una sala de video. Mismo criterio que `corporativo-sheet.esCorporativa`
//    y el worker del link: manda el `origen`; si viene vacío, la especialidad.
//  · Citas Trepsi canceladas: `trepsi.service.cancel()` no toca HistoriaClinica.
//  · Citas a nombre de alguien sin ficha de profesional (el nombre escrito a
//    mano de MyBodytech): no son gestión de ningún coach. Misma regla que los
//    indicadores, `TIENE_FICHA_SQL`.
// Solo citas cuya hora ya pasó: una cita de más tarde hoy todavía no puede ser
// "No contesta", y contarla bajaría el porcentaje.
const CITAS_WHERE = `
      (${EFFECTIVE_SEDE_SQL}) = ANY($1::text[])
  AND "HistoriaClinica"."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  AND "HistoriaClinica"."fechaAtencion"::timestamptz >= $2::timestamptz
  AND "HistoriaClinica"."fechaAtencion"::timestamptz < LEAST($3::timestamptz, NOW())
  AND NOT (
        LOWER(COALESCE("HistoriaClinica"."origen", '')) = 'corporativo'
        OR (COALESCE("HistoriaClinica"."origen", '') = '' AND EXISTS (
              SELECT 1 FROM profesionales pc
               WHERE pc.codigo = "HistoriaClinica"."medico"
                 AND TRANSLATE(LOWER(COALESCE(pc.especialidad, '')), 'áéíóúü', 'aeiouu')
                     = 'medico corporativo'))
      )
  AND NOT EXISTS (SELECT 1 FROM trepsi_appointments t
                   WHERE t.historia_id = "HistoriaClinica"."_id" AND t.estado = 'cancelled')
  AND ${TIENE_FICHA_SQL}`;

function medicoFilter(params: unknown[], medico?: string): string {
  if (!medico) return '';
  params.push(medico);
  return `AND "HistoriaClinica"."medico" = $${params.length}`;
}

class NoContestaAuditoriaService {
  async getAuditoria(
    from: string,
    to: string,
    sedeIds: string[],
    medico?: string
  ): Promise<ServiceResult<AuditoriaNoContesta>> {
    let range;
    try {
      range = getRangeUtc(from, to);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }
    if (range.startUtc >= range.endUtc) {
      return {
        ok: false,
        status: 400,
        error: { code: 'INVALID_RANGE', message: 'El rango de fechas es inválido (from > to).' },
      };
    }

    const pConteo: unknown[] = [sedeIds, range.startUtc, range.endUtc];
    const conteoSql = `
      SELECT "medico" AS medico,
             COUNT(*)::int AS citas,
             COUNT(*) FILTER (WHERE UPPER(COALESCE("atendido", '')) = 'NO CONTESTA')::int AS no_contesta
        FROM "HistoriaClinica"
       WHERE ${CITAS_WHERE}
         ${medicoFilter(pConteo, medico)}
       GROUP BY "medico"`;

    // Las salas de una cita son tres fuentes porque el link sale por tres
    // caminos: el worker automático (link_auto_envio), el botón "Contactar"
    // (video_room_name) y la sala que abrió el coach (room_historia_map).
    // `client_diag` no tiene índice por sala: se acota primero por fecha (sí lo
    // tiene) y recién ahí se cruza. Los CTE van MATERIALIZED a propósito: `nc`
    // sale con una estimación de 1 fila, y sin la barrera el planificador
    // repetía el cruce de salas × entradas una vez por cita (12 s para dos
    // semanas; así, menos de 1 s).
    const pFilas: unknown[] = [sedeIds, range.startUtc, range.endUtc];
    const filasSql = `
      WITH nc AS (
        SELECT "_id" AS historia_id, "medico" AS medico,
               "primerNombre" AS primer_nombre, "primerApellido" AS primer_apellido,
               "fechaAtencion"::timestamptz AS cita, "video_room_name" AS video_room
          FROM "HistoriaClinica"
         WHERE ${CITAS_WHERE}
           AND UPPER(COALESCE("atendido", '')) = 'NO CONTESTA'
           ${medicoFilter(pFilas, medico)}
      ),
      marca AS MATERIALIZED (
        SELECT a.entidad_id AS historia_id, MAX(a.created_at) AS marcado_at
          FROM audit_log a
         WHERE a.entidad = 'historia' AND a.accion = 'no_contesta' AND a.status_code = 200
           AND a.entidad_id IN (SELECT historia_id FROM nc)
         GROUP BY a.entidad_id
      ),
      salas AS MATERIALIZED (
        SELECT e.historia_id, e.room_name FROM link_auto_envio e
         WHERE e.room_name IS NOT NULL AND e.historia_id IN (SELECT historia_id FROM nc)
        UNION
        SELECT historia_id, video_room FROM nc WHERE video_room IS NOT NULL
        UNION
        SELECT r.historia_id, r.room_name FROM room_historia_map r
         WHERE r.historia_id IN (SELECT historia_id FROM nc)
      ),
      entradas AS MATERIALIZED (
        SELECT d.room_name, d.created_at FROM client_diag d
         WHERE d.role = 'patient' AND d.evento = 'session-info'
           AND d.created_at >= $2::timestamptz - INTERVAL '2 hours'
           AND d.created_at <  $3::timestamptz + INTERVAL '6 hours'
      ),
      entro AS MATERIALIZED (
        SELECT s.historia_id, MIN(en.created_at) AS paciente_entro_at
          FROM salas s
          JOIN nc ON nc.historia_id = s.historia_id
          JOIN entradas en ON en.room_name = s.room_name
         WHERE en.created_at BETWEEN nc.cita - INTERVAL '2 hours' AND nc.cita + INTERVAL '6 hours'
         GROUP BY s.historia_id
      ),
      consultas_coach AS MATERIALIZED (
        SELECT h2."medico" AS medico, r.historia_id, r.created_at
          FROM room_historia_map r
          JOIN "HistoriaClinica" h2 ON h2."_id" = r.historia_id
         WHERE r.created_at >= $2::timestamptz - INTERVAL '30 minutes'
      )
      SELECT nc.historia_id, nc.medico, nc.primer_nombre, nc.primer_apellido, nc.cita,
             m.marcado_at, en.paciente_entro_at,
             EXISTS (SELECT 1 FROM room_historia_map r WHERE r.historia_id = nc.historia_id) AS coach_entro,
             (SELECT COUNT(*) FROM llamadas_voz l
               WHERE l.historia_id = nc.historia_id
                 AND (m.marcado_at IS NULL OR l.iniciada_at < m.marcado_at))::int AS llamadas_antes,
             EXISTS (SELECT 1 FROM consultas_coach cc
                      WHERE cc.medico = nc.medico AND cc.historia_id <> nc.historia_id
                        AND cc.created_at BETWEEN nc.cita - INTERVAL '25 minutes'
                                              AND COALESCE(m.marcado_at, nc.cita + INTERVAL '15 minutes')
                    ) AS atendia_otro
        FROM nc
        LEFT JOIN marca m ON m.historia_id = nc.historia_id
        LEFT JOIN entro en ON en.historia_id = nc.historia_id`;

    const [conteos, filas] = await Promise.all([
      postgresService.query(conteoSql, pConteo),
      postgresService.query(filasSql, pFilas),
    ]);
    if (conteos === null || filas === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error consultando la auditoría de No contesta.' },
      };
    }

    const codigos = Array.from(
      new Set((conteos as ConteoCoach[]).map((c) => c.medico).filter((c): c is string => !!c))
    );
    const nombres = new Map<string, string>();
    if (codigos.length > 0) {
      const prof = await postgresService.query(
        `SELECT DISTINCT ON (codigo) codigo, alias, primer_nombre, primer_apellido
           FROM profesionales
          WHERE codigo = ANY($1::text[])
          ORDER BY codigo, activo DESC`,
        [codigos]
      );
      for (const p of prof ?? []) {
        const nombre =
          (p.alias ? String(p.alias) : '') ||
          [p.primer_nombre, p.primer_apellido].filter(Boolean).join(' ');
        if (nombre) nombres.set(String(p.codigo), nombre);
      }
    }

    return {
      ok: true,
      status: 200,
      data: resumirAuditoria(from, to, conteos as ConteoCoach[], filas as FilaNoContesta[], nombres),
    };
  }
}

export default new NoContestaAuditoriaService();
