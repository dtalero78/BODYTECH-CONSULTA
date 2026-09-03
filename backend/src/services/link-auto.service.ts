// ============================================================================
// link-auto.service — envío AUTOMÁTICO del link de la videollamada.
//
// Antes, el paciente recibía su link solo si el coach apretaba "Contactar". Si
// el coach se olvidaba, llegaba tarde o no abría la plataforma, la cita se
// perdía en silencio — que es exactamente lo que mide el indicador "No
// contactó". Este worker cierra ese hueco: cada mañana manda el link a toda la
// agenda del día.
//
// Ritmo: una tanda a LINK_AUTO_HORA y después un barrido cada pocos minutos
// hasta LINK_AUTO_HORA_FIN. El barrido no es un detalle: una cita creada a las
// 10:00 para las 15:00 de HOY nunca alcanzaría una única pasada matutina.
//
// Idempotencia: POR CITA, en `link_auto_envio` (PK `fecha, historia_id`), con
// un claim atómico. No se usa `link_enviado_at` como candado a propósito — si
// el proceso muriera entre el claim y el envío, esa cita quedaría marcada como
// contactada para siempre sin que nadie hubiera recibido nada, y esa columna
// alimenta indicadores. Acá `link_enviado_at` se escribe SOLO tras un envío
// exitoso, igual que con el botón manual.
//
// Apagado por defecto (LINK_AUTO_ENABLED). Manda WhatsApp a pacientes reales:
// el despliegue va por lista blanca de celulares y después sede por sede.
// ============================================================================

import postgresService from './postgres.service';
import {
  prepararLinkDeCita,
  enviarLinkPaciente,
  FilaCitaLink,
  LinkPreparado,
  MotivoOmision,
} from './link-paciente.service';
import { nowColombia, rangoDiaColombia, horaAMinutos } from '../helpers/colombia-time.helper';

/**
 * Si una pasada encuentra más candidatas que esto, algo está mal (ventana de
 * fechas mal calculada, carga masiva) y NO se envía nada. El volumen real es de
 * ~30 citas por día; 3.000 WhatsApps no se deshacen.
 */
const TOPE_CORDURA = 200;

export interface ItemCorrida {
  historiaId: string;
  accion: 'ENVIADA' | 'ENVIARIA' | 'OMITIDA' | 'OMITIRIA' | 'FALLIDA' | 'YA_RECLAMADA';
  nombre: string;
  numeroId?: string;
  celular?: string;
  medico?: string;
  sedeId?: string;
  horaCita?: string;
  appointmentTime?: string;
  roomName?: string;
  /** false ⇒ en un envío real la sala sería OTRA (esta se generó al vuelo). */
  roomNameReusada?: boolean;
  roomNameWithParams?: string;
  linkPaciente?: string;
  motivo?: MotivoOmision;
  via?: string;
  error?: string;
}

export interface ResumenCorrida {
  fecha: string;
  dryRun: boolean;
  candidatas: number;
  enviadas: number;
  omitidas: number;
  fallidas: number;
  yaReclamadas: number;
  items: ItemCorrida[];
  abortado?: string;
}

interface Config {
  enabled: boolean;
  horaInicio: number;
  horaFin: number;
  maxPorCorrida: number;
  pausaMs: number;
  maxIntentos: number;
  allowlist: string[];
  sedes: string[];
  exigirProfesional: boolean;
}

function leerConfig(): Config {
  const bool = (v: string | undefined) => v === '1' || v === 'true';
  const csv = (v: string | undefined) =>
    (v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };

  return {
    enabled: bool(process.env.LINK_AUTO_ENABLED),
    horaInicio: horaAMinutos(process.env.LINK_AUTO_HORA || '07:00', 7 * 60),
    horaFin: horaAMinutos(process.env.LINK_AUTO_HORA_FIN || '19:00', 19 * 60),
    maxPorCorrida: num(process.env.LINK_AUTO_MAX_POR_CORRIDA, 60),
    pausaMs: num(process.env.LINK_AUTO_PAUSA_MS, 1500),
    maxIntentos: num(process.env.LINK_AUTO_MAX_INTENTOS, 3),
    // Los celulares de la lista blanca se normalizan a E.164 para comparar
    // contra lo que devuelve prepararLinkDeCita.
    allowlist: csv(process.env.LINK_AUTO_SOLO_CELULARES).map((c) =>
      c.startsWith('+') ? c : `+${c.replace(/\D/g, '')}`
    ),
    sedes: csv(process.env.LINK_AUTO_SEDES),
    exigirProfesional: bool(process.env.LINK_AUTO_EXIGIR_PROFESIONAL),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class LinkAutoService {
  /**
   * `setInterval` no espera al callback. Con la plataforma caída (timeout de
   * 15 s por paciente) una pasada puede durar más que el intervalo y pisarse
   * con la siguiente → envíos duplicados. El claim en BD lo evitaría igual,
   * pero esto ahorra el viaje.
   */
  private corriendo = false;

  /** Lo llama el worker de index.ts. */
  async maybeDispatch(): Promise<void> {
    const cfg = leerConfig();
    if (!cfg.enabled) return;

    // Patrón "ya pasó la hora", no "es la hora": tolera reinicios del
    // contenedor y que el intervalo no caiga justo en el minuto objetivo.
    const { fecha, minutos } = nowColombia();
    if (minutos < cfg.horaInicio || minutos >= cfg.horaFin) return;

    if (this.corriendo) {
      console.warn('[link-auto] la pasada anterior sigue corriendo — se salta esta.');
      return;
    }

    this.corriendo = true;
    try {
      const r = await this.dispatch(fecha);
      if (r.enviadas > 0 || r.fallidas > 0) {
        console.log(
          `🔗 [Link-Auto] ${fecha}: ${r.enviadas} enviadas · ${r.fallidas} fallidas · ${r.omitidas} omitidas (${r.candidatas} candidatas)`
        );
      }
    } finally {
      this.corriendo = false;
    }
  }

  /**
   * Una pasada. `dryRun` corre exactamente el mismo camino de decisión pero no
   * escribe NADA: ni el claim, ni la sala, ni la marca de enviado. Es la forma
   * de ver a quién le llegaría antes de que le llegue.
   */
  async dispatch(
    fecha: string,
    opts: { dryRun?: boolean; limit?: number; historiaId?: string } = {}
  ): Promise<ResumenCorrida> {
    const cfg = leerConfig();
    const dryRun = opts.dryRun === true;
    const resumen: ResumenCorrida = {
      fecha,
      dryRun,
      candidatas: 0,
      enviadas: 0,
      omitidas: 0,
      fallidas: 0,
      yaReclamadas: 0,
      items: [],
    };

    const filas = await this.getCandidatas(fecha, cfg, opts);
    if (filas === null) {
      // `postgresService.query` traga la excepción y devuelve null. Sin este
      // chequeo, un error de base se leería como "hoy no hay citas" y el worker
      // callaría en silencio, todos los días.
      resumen.abortado = 'DB_ERROR';
      console.error('❌ [link-auto] Error consultando citas candidatas — se aborta la pasada.');
      return resumen;
    }

    resumen.candidatas = filas.length;
    if (filas.length === 0) return resumen;

    if (filas.length > TOPE_CORDURA) {
      resumen.abortado = 'TOPE_CORDURA';
      console.error(
        `🚨 [link-auto] ${filas.length} candidatas para ${fecha} (tope ${TOPE_CORDURA}). ` +
          'Eso no es una agenda normal: NO se envió nada. Revisar la ventana de fechas.'
      );
      return resumen;
    }

    // Si la plataforma falla una vez, el resto de la pasada va directo a
    // Twilio: no tiene sentido gastar 15 s de timeout por cada paciente.
    let plataformaViva = true;

    for (const fila of filas) {
      const prep = prepararLinkDeCita(fila, {
        allowlist: cfg.allowlist,
        exigirProfesional: cfg.exigirProfesional,
      });

      if (!prep.ok) {
        resumen.omitidas++;
        resumen.items.push({
          historiaId: fila.historiaId,
          accion: dryRun ? 'OMITIRIA' : 'OMITIDA',
          nombre: nombreDe(fila),
          numeroId: fila.numeroId ?? undefined,
          celular: fila.celular ?? undefined,
          medico: fila.medico ?? undefined,
          horaCita: fila.horaBogota ?? undefined,
          motivo: prep.motivo,
        });
        if (!dryRun) await this.marcarOmitida(fecha, fila, prep.motivo);
        continue;
      }

      const d: LinkPreparado = prep.data;
      const base: ItemCorrida = {
        historiaId: d.historiaId,
        accion: 'ENVIARIA',
        nombre: d.patientName,
        numeroId: fila.numeroId ?? undefined,
        celular: d.phoneE164,
        medico: fila.medico ?? undefined,
        horaCita: d.horaCita,
        appointmentTime: d.appointmentTime,
        roomName: d.roomName,
        roomNameReusada: d.roomNameReusada,
        roomNameWithParams: d.roomNameWithParams,
        linkPaciente: d.linkPaciente,
      };

      if (dryRun) {
        resumen.items.push(base);
        continue;
      }

      const reclamada = await this.reclamar(fecha, d.historiaId, cfg.maxIntentos);
      if (!reclamada) {
        resumen.yaReclamadas++;
        resumen.items.push({ ...base, accion: 'YA_RECLAMADA' });
        continue;
      }

      const r = await enviarLinkPaciente({
        historiaId: d.historiaId,
        phone: d.phoneE164,
        patientName: d.patientName,
        appointmentTime: d.appointmentTime,
        roomNameWithParams: d.roomNameWithParams,
        origen: 'auto',
        esperarEfectos: true,
        usarPlataforma: plataformaViva,
      });

      if (r.success) {
        if (r.via === 'twilio' && plataformaViva) plataformaViva = false;
        resumen.enviadas++;
        resumen.items.push({ ...base, accion: 'ENVIADA', via: r.via });
        await this.marcarEnviada(fecha, d, r.messageSid, r.via);
      } else {
        plataformaViva = false;
        resumen.fallidas++;
        resumen.items.push({ ...base, accion: 'FALLIDA', error: r.error });
        await this.marcarError(fecha, d.historiaId, r.error || 'error desconocido');
        console.error(`❌ [link-auto] Falló el envío a ${d.phoneE164}: ${r.error}`);
      }

      await sleep(cfg.pausaMs);
    }

    return resumen;
  }

  /** Resumen del día para el panel admin: conteo por estado + el detalle. */
  async getEstado(fecha: string): Promise<{
    fecha: string;
    porEstado: Record<string, number>;
    filas: Record<string, unknown>[];
  } | null> {
    const filas = await postgresService.query(
      `SELECT historia_id, estado, motivo, intentos, celular, hora_cita, room_name,
              message_sid, via, error,
              to_char(enviado_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS enviado_at,
              to_char(next_try_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS next_try_at
         FROM link_auto_envio
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
    opts: { limit?: number; historiaId?: string }
  ): Promise<FilaCitaLink[] | null> {
    let rango: { inicioUtc: string; finUtc: string };
    try {
      rango = rangoDiaColombia(fecha);
    } catch {
      return null;
    }

    const limit = Math.min(opts.limit || cfg.maxPorCorrida, TOPE_CORDURA + 1);
    const params: unknown[] = [
      rango.inicioUtc,
      rango.finUtc,
      fecha,
      cfg.maxIntentos,
      limit,
    ];

    let extra = '';
    if (cfg.sedes.length > 0) {
      params.push(cfg.sedes);
      extra += `\n  AND h."sede_id" = ANY($${params.length}::text[])`;
    }
    if (opts.historiaId) {
      params.push(opts.historiaId);
      extra += `\n  AND h."_id" = $${params.length}`;
    }

    // Notas sobre filtros que no son obvios:
    //  · La guarda regex va ANTES de cualquier ::timestamptz. Sin ella, UNA
    //    sola fila con fechaAtencion mal formada aborta la query entera y el
    //    worker no manda nada en todo el día.
    //  · La ventana se compara como timestamptz, no como texto: fechaAtencion
    //    es TEXT y mezcla formatos ('Z' y '-05:00'), así que compararla contra
    //    un Date sería una comparación lexicográfica que a veces acierta.
    //  · link_enviado_at < inicio del día ⇒ se reenvía a las citas reprogramadas
    //    DESDE otro día (con la hora nueva), sin duplicarle a nadie de hoy.
    //  · `medico_valido` viaja como COLUMNA, no como filtro: una cita cuyo
    //    `medico` no existe en `profesionales` se omite en la capa de arriba,
    //    pero queda registrada. Filtrarla acá la haría invisible, y son justo
    //    las que hay que ver (mybodytech guarda ahí el nombre, no el código).
    //  · Las citas de Trepsi canceladas siguen "vivas" en HistoriaClinica
    //    (trepsi.service.cancel solo toca trepsi_appointments), y Trepsi es el
    //    94% del volumen: sin este NOT EXISTS le mandaríamos el link a gente
    //    que canceló.
    const sql = `
      SELECT h."_id" AS historia_id, h."primerNombre" AS primer_nombre,
             h."primerApellido" AS primer_apellido, h."numeroId" AS numero_id,
             h."celular" AS celular, h."medico" AS medico,
             h."video_room_name" AS video_room_name, h."sede_id" AS sede_id,
             COALESCE(
               to_char(h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'HH24:MI'),
               NULLIF(h."horaAtencion", '')
             ) AS hora_bogota,
             EXISTS (SELECT 1 FROM profesionales p
                      WHERE p.codigo = h."medico" AND p.activo = TRUE) AS medico_valido
        FROM "HistoriaClinica" h
       WHERE h."fechaAtencion" IS NOT NULL
         AND h."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         AND h."fechaAtencion"::timestamptz >= $1::timestamptz
         AND h."fechaAtencion"::timestamptz <  $2::timestamptz
         AND h."fechaConsulta" IS NULL
         AND UPPER(COALESCE(h."atendido", 'PENDIENTE')) NOT IN ('ATENDIDO', 'NO CONTESTA')
         AND COALESCE(h."pvEstado", '') <> 'No Contesta'
         AND COALESCE(h."numeroId", '') NOT IN ('TEST', 'test')
         AND (h."link_enviado_at" IS NULL OR h."link_enviado_at" < $1::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM trepsi_appointments t
                          WHERE t.historia_id = h."_id" AND t.estado = 'cancelled')
         AND NOT EXISTS (
               SELECT 1 FROM link_auto_envio e
                WHERE e.fecha = $3::date AND e.historia_id = h."_id"
                  AND (   e.estado = 'enviado'
                       OR e.intentos >= $4
                       OR (e.estado = 'claimed' AND e.claimed_at > NOW() - INTERVAL '15 minutes')
                       OR (e.estado IN ('error','omitido') AND e.next_try_at > NOW()) ))${extra}
       ORDER BY h."fechaAtencion"::timestamptz ASC
       LIMIT $5`;

    const rows = await postgresService.query(sql, params);
    if (rows === null) return null;

    return rows.map((r: Record<string, unknown>) => ({
      historiaId: String(r.historia_id),
      primerNombre: r.primer_nombre ? String(r.primer_nombre) : null,
      primerApellido: r.primer_apellido ? String(r.primer_apellido) : null,
      numeroId: r.numero_id ? String(r.numero_id) : null,
      celular: r.celular ? String(r.celular) : null,
      medico: r.medico ? String(r.medico) : null,
      videoRoomName: r.video_room_name ? String(r.video_room_name) : null,
      horaBogota: r.hora_bogota ? String(r.hora_bogota) : null,
      medicoValido: r.medico_valido === true,
    }));
  }

  /**
   * Claim atómico. `ON CONFLICT ... DO UPDATE ... WHERE` no devuelve filas si
   * el WHERE es falso, así que 0 filas = otra pasada (u otra instancia) la
   * tiene. Una fila 'claimed' solo se re-toma pasados 15 min: así un crash a
   * mitad de envío se auto-sana en la pasada siguiente en vez de perderse.
   */
  private async reclamar(fecha: string, historiaId: string, maxIntentos: number): Promise<boolean> {
    const r = await postgresService.query(
      `INSERT INTO link_auto_envio (fecha, historia_id, estado, intentos, claimed_at, next_try_at)
       VALUES ($1::date, $2, 'claimed', 1, NOW(), NOW())
       ON CONFLICT (fecha, historia_id) DO UPDATE
          SET estado = 'claimed', intentos = link_auto_envio.intentos + 1,
              claimed_at = NOW(), error = NULL
        WHERE link_auto_envio.estado IN ('error', 'omitido', 'claimed')
          AND link_auto_envio.intentos < $3
          AND link_auto_envio.next_try_at <= NOW()
          AND (link_auto_envio.estado <> 'claimed'
               OR link_auto_envio.claimed_at < NOW() - INTERVAL '15 minutes')
       RETURNING historia_id`,
      [fecha, historiaId, maxIntentos]
    );
    return Array.isArray(r) && r.length > 0;
  }

  private async marcarEnviada(
    fecha: string,
    d: LinkPreparado,
    messageSid: string | undefined,
    via: string
  ): Promise<void> {
    await postgresService
      .query(
        `UPDATE link_auto_envio
            SET estado = 'enviado', enviado_at = NOW(), error = NULL, motivo = NULL,
                celular = $3, hora_cita = $4, room_name = $5, message_sid = $6, via = $7
          WHERE fecha = $1::date AND historia_id = $2`,
        [fecha, d.historiaId, d.phoneE164, d.horaCita, d.roomName, messageSid || null, via]
      )
      .catch((e) => console.error('⚠️ [link-auto] Error marcando enviada:', e?.message ?? e));
  }

  /** Backoff lineal: 15 min por intento ya hecho. */
  private async marcarError(fecha: string, historiaId: string, error: string): Promise<void> {
    await postgresService
      .query(
        `UPDATE link_auto_envio
            SET estado = 'error', error = $3,
                next_try_at = NOW() + (intentos * INTERVAL '15 minutes')
          WHERE fecha = $1::date AND historia_id = $2`,
        [fecha, historiaId, error.slice(0, 500)]
      )
      .catch((e) => console.error('⚠️ [link-auto] Error marcando error:', e?.message ?? e));
  }

  /**
   * Una omisión no consume intento: el motivo puede desaparecer durante el día
   * (a una cita sin médico se lo pueden asignar a las 9). Se re-evalúa en media
   * hora. El UPSERT no pisa una fila ya 'enviado'.
   */
  private async marcarOmitida(
    fecha: string,
    fila: FilaCitaLink,
    motivo: MotivoOmision
  ): Promise<void> {
    await postgresService
      .query(
        `INSERT INTO link_auto_envio (fecha, historia_id, estado, motivo, intentos, celular, hora_cita, next_try_at)
         VALUES ($1::date, $2, 'omitido', $3, 0, $4, $5, NOW() + INTERVAL '30 minutes')
         ON CONFLICT (fecha, historia_id) DO UPDATE
            SET estado = 'omitido', motivo = $3, celular = $4, hora_cita = $5,
                next_try_at = NOW() + INTERVAL '30 minutes'
          WHERE link_auto_envio.estado <> 'enviado'`,
        [fecha, fila.historiaId, motivo, fila.celular, fila.horaBogota]
      )
      .catch((e) => console.error('⚠️ [link-auto] Error marcando omitida:', e?.message ?? e));
  }
}

function nombreDe(f: FilaCitaLink): string {
  const n = `${f.primerNombre || ''} ${f.primerApellido || ''}`.trim();
  return n || '(sin nombre)';
}

export default new LinkAutoService();
