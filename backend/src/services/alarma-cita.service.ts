// ============================================================================
// alarma-cita.service — "llegó la hora de la cita y el coach no está".
//
// El registro de jornada (torniquete) ya sabía CUÁNDO estuvo conectado cada
// profesional y el tablero pintaba en rojo la cita que cayó en un hueco. Pero
// ese rojo solo existe para quien abre el tablero: cuando alguien lo miraba, la
// cita ya se había perdido. Esto cierra el lazo — la misma señal, pero saliendo
// a buscar a un humano mientras todavía se puede rescatar la consulta.
//
// Regla de disparo (a propósito conservadora, son mensajes a un grupo real):
//   · la cita ya pasó hace más de ALARMA_CITA_GRACIA_MIN (default 3) y menos
//     de ALARMA_CITA_MAX_MIN (default 45) — lo viejo no se alarma, que si no un
//     servidor caído toda la mañana vacía la agenda entera sobre el grupo;
//   · nadie la atendió ni la marcó (ni ATENDIDO ni NO CONTESTA);
//   · el profesional NO tuvo NI UN latido entre la hora de la cita y ahora. Un
//     solo latido en esa ventana cancela la alarma: el objetivo es la ausencia,
//     no el bache de red de 30 segundos;
//   · el `medico` es un profesional activo del padrón. Las citas cuyo `medico`
//     guarda un nombre escrito a mano (MyBodytech) NUNCA van a tener latidos y
//     alarmarían todos los días sin que haya nada que corregir.
//
// Idempotencia: una alarma por cita y por día, con claim atómico en
// `alarma_cita_envio` (mismo patrón que link_auto_envio). La bitácora sirve
// además para responder "¿esto ya se avisó?".
//
// Un mensaje por pasada, no uno por cita: el barrido corre cada minuto y si
// medio equipo no se conectó, el grupo recibe UN aviso con la lista, no doce.
//
// Apagado por defecto: sin ALARMA_CITA_ENABLED, sin WHAPI_TOKEN o sin
// ALARMA_CITA_GRUPO no se manda nada.
// ============================================================================

import postgresService from './postgres.service';
import whapiService from './whapi.service';
import { nowColombia } from '../helpers/colombia-time.helper';

/** Tantas citas sin coach en una sola pasada no es operación: es un dato roto. */
const TOPE_CORDURA = 40;
/** Cuántas citas se detallan en el mensaje antes de resumir el resto. */
const MAX_DETALLE = 8;

export interface CitaSinCoach {
  historiaId: string;
  medico: string;
  medicoNombre: string;
  sedeId: string | null;
  horaCita: string;
  paciente: string;
  celular: string | null;
}

export interface ResumenAlarma {
  fecha: string;
  dryRun: boolean;
  candidatas: number;
  alarmadas: number;
  yaReclamadas: number;
  enviado: boolean;
  mensaje?: string;
  error?: string;
  abortado?: string;
  items: CitaSinCoach[];
}

interface Config {
  enabled: boolean;
  grupo: string;
  graciaMin: number;
  maxMin: number;
  maxPorCorrida: number;
  sedes: string[];
}

function leerConfig(): Config {
  const bool = (v?: string) => v === '1' || v === 'true';
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    enabled: bool(process.env.ALARMA_CITA_ENABLED),
    grupo: (process.env.ALARMA_CITA_GRUPO || '').trim(),
    graciaMin: num(process.env.ALARMA_CITA_GRACIA_MIN, 3),
    maxMin: num(process.env.ALARMA_CITA_MAX_MIN, 45),
    maxPorCorrida: num(process.env.ALARMA_CITA_MAX_POR_CORRIDA, 30),
    sedes: (process.env.ALARMA_CITA_SEDES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * El texto que ve el grupo. Función pura: es la parte que se lee en voz alta en
 * una reunión, así que se prueba sola y no depende de la base ni de la red.
 */
export function construirMensaje(items: CitaSinCoach[], panelUrl?: string): string {
  if (items.length === 0) return '';
  const titulo =
    items.length === 1
      ? '🔴 Cita sin profesional conectado'
      : `🔴 ${items.length} citas sin profesional conectado`;

  const detalle = items.slice(0, MAX_DETALLE).map((c) => {
    const sede = c.sedeId ? ` · ${c.sedeId}` : '';
    const paciente = c.paciente || 'Afiliado sin nombre';
    return `• ${c.horaCita}${sede} — ${c.medicoNombre} no está conectado.\n   Afiliado: ${paciente}`;
  });

  const resto =
    items.length > MAX_DETALLE ? [`• …y ${items.length - MAX_DETALLE} citas más.`] : [];

  const cierre = panelUrl ? [`\nTablero: ${panelUrl}`] : [];

  return [titulo, '', ...detalle, ...resto, ...cierre].join('\n').trim();
}

class AlarmaCitaService {
  /** Una pasada no se pisa con la siguiente (setInterval no espera al callback). */
  private corriendo = false;

  /** Lo llama el worker de index.ts, cada minuto. */
  async maybeDispatch(): Promise<void> {
    const cfg = leerConfig();
    if (!cfg.enabled || !cfg.grupo || !whapiService.configurado) return;
    if (this.corriendo) return;

    this.corriendo = true;
    try {
      const r = await this.dispatch(nowColombia().fecha, {});
      if (r.alarmadas > 0 || r.error || r.abortado) {
        console.log(
          `🔴 [Alarma-Cita] ${r.fecha}: ${r.alarmadas} alarmadas de ${r.candidatas} candidatas` +
            `${r.error ? ' · ERROR ' + r.error : ''}${r.abortado ? ' · ABORTADO ' + r.abortado : ''}`
        );
      }
    } finally {
      this.corriendo = false;
    }
  }

  /**
   * Una pasada. `dryRun` recorre EXACTAMENTE el mismo camino de decisión —la
   * misma query, el mismo mensaje— pero no reclama ni envía: es la forma de ver
   * qué habría salido al grupo sin escribirle a nadie.
   */
  async dispatch(
    fecha: string,
    opts: { dryRun?: boolean; limit?: number }
  ): Promise<ResumenAlarma> {
    const cfg = leerConfig();
    const dryRun = opts.dryRun === true;
    const resumen: ResumenAlarma = {
      fecha,
      dryRun,
      candidatas: 0,
      alarmadas: 0,
      yaReclamadas: 0,
      enviado: false,
      items: [],
    };

    const filas = await this.getCandidatas(fecha, cfg, opts);
    if (filas === null) {
      // `query` traga la excepción y devuelve null: sin este chequeo, un error
      // de base se leería como "hoy nadie faltó" y el worker callaría siempre.
      resumen.abortado = 'DB_ERROR';
      console.error('❌ [alarma-cita] Error consultando candidatas — se aborta la pasada.');
      return resumen;
    }

    resumen.candidatas = filas.length;
    if (filas.length === 0) return resumen;

    if (filas.length > TOPE_CORDURA) {
      resumen.abortado = 'TOPE_CORDURA';
      console.error(
        `🚨 [alarma-cita] ${filas.length} citas sin profesional conectado en una sola pasada ` +
          `(tope ${TOPE_CORDURA}). Eso no es una ausencia: es un dato roto. NO se avisó nada.`
      );
      return resumen;
    }

    // Se reclama ANTES de enviar. Si el proceso muere entre el claim y el
    // envío, esas citas quedan 'claimed' y la pasada siguiente las re-toma a
    // los 15 min; al revés, un reinicio en mal momento repetiría el aviso.
    const alarmar: CitaSinCoach[] = [];
    for (const fila of filas) {
      if (dryRun) {
        alarmar.push(fila);
        continue;
      }
      const reclamada = await this.reclamar(fecha, fila);
      if (reclamada) alarmar.push(fila);
      else resumen.yaReclamadas++;
    }

    resumen.items = alarmar;
    if (alarmar.length === 0) return resumen;

    const mensaje = construirMensaje(alarmar, process.env.ALARMA_CITA_PANEL_URL);
    resumen.mensaje = mensaje;

    if (dryRun) {
      resumen.alarmadas = alarmar.length;
      return resumen;
    }

    const envio = await whapiService.enviarTexto(cfg.grupo, mensaje);
    if (envio.success) {
      resumen.enviado = true;
      resumen.alarmadas = alarmar.length;
      await this.marcarEnviadas(fecha, alarmar, envio.messageId);
    } else {
      resumen.error = envio.error;
      await this.marcarError(fecha, alarmar, envio.error || 'error desconocido');
      console.error(`❌ [alarma-cita] No se pudo avisar al grupo: ${envio.error}`);
    }
    return resumen;
  }

  /** Bitácora del día: qué se avisó, de quién y a qué hora. */
  async getEstado(fecha: string): Promise<{
    fecha: string;
    porEstado: Record<string, number>;
    filas: Record<string, unknown>[];
  } | null> {
    const filas = await postgresService.query(
      `SELECT historia_id, estado, intentos, medico, sede_id, hora_cita, paciente,
              message_id, error,
              to_char(enviada_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS enviada_at
         FROM alarma_cita_envio
        WHERE fecha = $1::date
        ORDER BY hora_cita NULLS LAST, historia_id`,
      [fecha]
    );
    if (filas === null) return null;
    const porEstado: Record<string, number> = {};
    for (const f of filas) {
      const e = String(f.estado);
      porEstado[e] = (porEstado[e] || 0) + 1;
    }
    return { fecha, porEstado, filas };
  }

  // -------------------------------------------------------------------------
  // Base de datos
  // -------------------------------------------------------------------------

  private async getCandidatas(
    fecha: string,
    cfg: Config,
    opts: { limit?: number }
  ): Promise<CitaSinCoach[] | null> {
    const ahora = Date.now();
    const hasta = new Date(ahora - cfg.graciaMin * 60_000).toISOString();
    const desde = new Date(ahora - cfg.maxMin * 60_000).toISOString();
    const limit = Math.min(opts.limit || cfg.maxPorCorrida, TOPE_CORDURA + 1);

    const params: unknown[] = [desde, hasta, fecha, limit];
    let extra = '';
    if (cfg.sedes.length > 0) {
      params.push(cfg.sedes);
      extra += `\n         AND h."sede_id" = ANY($${params.length}::text[])`;
    }

    // Filtros que no son obvios (mismos criterios que link-auto.getCandidatas):
    //  · La guarda regex va ANTES del ::timestamptz — `fechaAtencion` es TEXT y
    //    una sola fila mal formada abortaría la consulta del día entero.
    //  · Trepsi cancela en `trepsi_appointments` y NO toca `HistoriaClinica`:
    //    sin el NOT EXISTS alarmaríamos por citas que el paciente canceló.
    //  · Médico Corporativo queda fuera: su examen es presencial, no hay nada
    //    que "conectar". Manda el `origen` y solo si viene vacío se mira la
    //    especialidad del profesional.
    //  · El NOT EXISTS sobre torniquete es un test de SOLAPE entre la jornada
    //    y el intervalo [hora de la cita, ahora]: cualquier latido ahí adentro
    //    significa que el profesional estuvo, y no hay alarma.
    const sql = `
      SELECT h."_id"    AS historia_id,
             h."medico" AS medico,
             h."sede_id" AS sede_id,
             h."celular" AS celular,
             to_char(h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'HH24:MI') AS hora_cita,
             TRIM(COALESCE(h."primerNombre",'') || ' ' || COALESCE(h."primerApellido",'')) AS paciente,
             COALESCE(
               NULLIF(p.alias, ''),
               NULLIF(TRIM(COALESCE(p.primer_nombre,'') || ' ' || COALESCE(p.primer_apellido,'')), ''),
               h."medico"
             ) AS medico_nombre
        FROM "HistoriaClinica" h
        JOIN profesionales p ON p.codigo = h."medico" AND p.activo = TRUE
       WHERE h."fechaAtencion" IS NOT NULL
         AND h."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         AND h."fechaAtencion"::timestamptz >= $1::timestamptz
         AND h."fechaAtencion"::timestamptz <= $2::timestamptz
         AND h."fechaConsulta" IS NULL
         AND UPPER(COALESCE(h."atendido", 'PENDIENTE')) NOT IN ('ATENDIDO', 'NO CONTESTA')
         AND COALESCE(h."pvEstado", '') <> 'No Contesta'
         AND COALESCE(h."numeroId", '') NOT IN ('TEST', 'test')
         AND NOT EXISTS (SELECT 1 FROM trepsi_appointments t
                          WHERE t.historia_id = h."_id" AND t.estado = 'cancelled')
         AND NOT (
               LOWER(COALESCE(h."origen", '')) = 'corporativo'
               OR (COALESCE(h."origen", '') = ''
                   AND TRANSLATE(LOWER(COALESCE(p.especialidad, '')), 'áéíóúü', 'aeiouu')
                       = 'medico corporativo')
             )
         AND NOT EXISTS (
               SELECT 1 FROM torniquete_jornadas tj
                WHERE tj.codigo = h."medico"
                  AND tj.fecha = $3::date
                  AND tj.entrada_at <= NOW()
                  AND COALESCE(tj.salida_at, tj.ultimo_latido_at) >= h."fechaAtencion"::timestamptz
             )
         AND NOT EXISTS (
               SELECT 1 FROM alarma_cita_envio e
                WHERE e.fecha = $3::date AND e.historia_id = h."_id"
                  AND (   e.estado = 'enviada'
                       OR e.intentos >= 3
                       OR (e.estado = 'claimed' AND e.claimed_at > NOW() - INTERVAL '15 minutes') )
             )${extra}
       ORDER BY h."fechaAtencion"::timestamptz ASC
       LIMIT $4`;

    const rows = await postgresService.query(sql, params);
    if (rows === null) return null;

    return rows.map((r: Record<string, unknown>) => ({
      historiaId: String(r.historia_id),
      medico: String(r.medico ?? ''),
      medicoNombre: String(r.medico_nombre ?? r.medico ?? ''),
      sedeId: r.sede_id ? String(r.sede_id) : null,
      horaCita: r.hora_cita ? String(r.hora_cita) : '',
      paciente: String(r.paciente ?? '').trim(),
      celular: r.celular ? String(r.celular) : null,
    }));
  }

  /**
   * Claim atómico por cita. `ON CONFLICT ... DO UPDATE ... WHERE` no devuelve
   * filas si el WHERE es falso: 0 filas = ya la tiene otra pasada (u otra
   * instancia). Una fila 'claimed' se re-toma a los 15 min, así un crash a
   * mitad de envío se auto-sana en vez de perder el aviso.
   */
  private async reclamar(fecha: string, c: CitaSinCoach): Promise<boolean> {
    const r = await postgresService.query(
      `INSERT INTO alarma_cita_envio
              (fecha, historia_id, estado, intentos, medico, sede_id, hora_cita, paciente, claimed_at)
       VALUES ($1::date, $2, 'claimed', 1, $3, $4, $5, $6, NOW())
       ON CONFLICT (fecha, historia_id) DO UPDATE
          SET estado = 'claimed', intentos = alarma_cita_envio.intentos + 1,
              claimed_at = NOW(), error = NULL
        WHERE alarma_cita_envio.estado <> 'enviada'
          AND alarma_cita_envio.intentos < 3
          AND (alarma_cita_envio.estado <> 'claimed'
               OR alarma_cita_envio.claimed_at < NOW() - INTERVAL '15 minutes')
       RETURNING historia_id`,
      [fecha, c.historiaId, c.medico, c.sedeId, c.horaCita, c.paciente]
    );
    return Array.isArray(r) && r.length > 0;
  }

  private async marcarEnviadas(
    fecha: string,
    items: CitaSinCoach[],
    messageId?: string
  ): Promise<void> {
    await postgresService.query(
      `UPDATE alarma_cita_envio
          SET estado = 'enviada', enviada_at = NOW(), message_id = $3, error = NULL
        WHERE fecha = $1::date AND historia_id = ANY($2::text[])`,
      [fecha, items.map((i) => i.historiaId), messageId ?? null]
    );
  }

  private async marcarError(fecha: string, items: CitaSinCoach[], error: string): Promise<void> {
    await postgresService.query(
      `UPDATE alarma_cita_envio
          SET estado = 'error', error = $3
        WHERE fecha = $1::date AND historia_id = ANY($2::text[])`,
      [fecha, items.map((i) => i.historiaId), error.slice(0, 500)]
    );
  }
}

export default new AlarmaCitaService();
