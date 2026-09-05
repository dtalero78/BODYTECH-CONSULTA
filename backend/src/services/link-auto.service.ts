// ============================================================================
// link-auto.service — los WhatsApp automáticos del día: recordatorio y link.
//
// Son DOS mensajes, en dos momentos, con dos plantillas. Confundirlos fue el
// primer diseño, y estaba mal:
//
//   · RECORDATORIO — a las 07:00, a toda la agenda del día: "hoy tienes
//     consulta a las 3 p. m." + botón Reprogramar. SIN "Conectarme": a esa hora
//     no hay coach en la sala, y el paciente que entraba a las 7 de la mañana
//     no encontraba a nadie.
//   · LINK — minutos antes de cada cita (LINK_AUTO_MINUTOS_ANTES): la plantilla
//     de siempre, Conectarme + Reprogramar. Es el mismo mensaje que manda el
//     botón "Contactar" del coach, solo que ya nadie tiene que acordarse.
//
// Los dos comparten la maquinaria: quién tiene cita hoy, excluir canceladas de
// Trepsi, no mandar dos veces, la bitácora. La idempotencia es POR CITA Y POR
// TIPO, en `link_auto_envio` (PK fecha, historia_id, tipo), con claim atómico.
// A propósito NO se usa `link_enviado_at` como candado: si el proceso muriera
// entre el claim y el envío, la cita quedaría marcada como contactada sin que
// nadie hubiera recibido nada, y esa columna alimenta indicadores.
//
// Apagados por defecto (LINK_AUTO_ENABLED / RECORDATORIO_ENABLED). Mandan
// WhatsApp a pacientes reales: el despliegue va por lista blanca y por sede.
// ============================================================================

import postgresService from './postgres.service';
import {
  prepararLinkDeCita,
  enviarLinkPaciente,
  enviarRecordatorioPaciente,
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

export type TipoEnvio = 'recordatorio' | 'link';

export interface ItemCorrida {
  tipo: TipoEnvio;
  historiaId: string;
  accion: 'ENVIADA' | 'ENVIARIA' | 'OMITIDA' | 'OMITIRIA' | 'FALLIDA' | 'YA_RECLAMADA';
  nombre: string;
  numeroId?: string;
  celular?: string;
  medico?: string;
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
  tipo: TipoEnvio;
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
  linkEnabled: boolean;
  /** Cuánto antes de la cita sale el link. */
  linkMinutosAntes: number;
  /** Si el worker estuvo caído, igual manda hasta estos minutos DESPUÉS de la hora. */
  linkGraciaMin: number;
  recordatorioEnabled: boolean;
  recordatorioHora: number;
  recordatorioHoraFin: number;
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
    linkEnabled: bool(process.env.LINK_AUTO_ENABLED),
    linkMinutosAntes: num(process.env.LINK_AUTO_MINUTOS_ANTES, 15),
    linkGraciaMin: num(process.env.LINK_AUTO_GRACIA_MIN, 5),
    recordatorioEnabled: bool(process.env.RECORDATORIO_ENABLED),
    recordatorioHora: horaAMinutos(process.env.RECORDATORIO_HORA || '07:00', 7 * 60),
    recordatorioHoraFin: horaAMinutos(process.env.RECORDATORIO_HORA_FIN || '19:00', 19 * 60),
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

  /** Lo llama el worker de index.ts. Decide qué tipo(s) tocan en esta pasada. */
  async maybeDispatch(): Promise<void> {
    const cfg = leerConfig();
    if (!cfg.linkEnabled && !cfg.recordatorioEnabled) return;

    const { fecha, minutos } = nowColombia();
    if (this.corriendo) {
      console.warn('[link-auto] la pasada anterior sigue corriendo — se salta esta.');
      return;
    }

    this.corriendo = true;
    try {
      // Recordatorio: patrón "ya pasó la hora", no "es la hora" — tolera
      // reinicios y que el intervalo no caiga justo en el minuto. Con tope
      // superior, para que un servidor caído toda la mañana no mande el
      // "hoy tienes consulta" a las 11 de la noche.
      if (cfg.recordatorioEnabled && minutos >= cfg.recordatorioHora && minutos < cfg.recordatorioHoraFin) {
        this.log(await this.dispatch(fecha, { tipo: 'recordatorio' }));
      }
      // Link: la ventana la define la hora de CADA cita, no la del día.
      if (cfg.linkEnabled) {
        this.log(await this.dispatch(fecha, { tipo: 'link' }));
      }
    } finally {
      this.corriendo = false;
    }
  }

  private log(r: ResumenCorrida): void {
    if (r.enviadas > 0 || r.fallidas > 0 || r.abortado) {
      console.log(
        `🔗 [Link-Auto] ${r.fecha} ${r.tipo}: ${r.enviadas} enviadas · ${r.fallidas} fallidas · ${r.omitidas} omitidas (${r.candidatas} candidatas)${r.abortado ? ' · ABORTADO ' + r.abortado : ''}`
      );
    }
  }

  /**
   * Una pasada de UN tipo. `dryRun` corre exactamente el mismo camino de
   * decisión pero no escribe NADA: ni el claim, ni la sala, ni la marca de
   * enviado. Es la forma de ver a quién le llegaría antes de que le llegue.
   */
  async dispatch(
    fecha: string,
    opts: { tipo: TipoEnvio; dryRun?: boolean; limit?: number; historiaId?: string }
  ): Promise<ResumenCorrida> {
    const cfg = leerConfig();
    const tipo = opts.tipo;
    const dryRun = opts.dryRun === true;
    const resumen: ResumenCorrida = {
      fecha,
      tipo,
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
      console.error(`❌ [link-auto] Error consultando candidatas (${tipo}) — se aborta la pasada.`);
      return resumen;
    }

    resumen.candidatas = filas.length;
    if (filas.length === 0) return resumen;

    if (filas.length > TOPE_CORDURA) {
      resumen.abortado = 'TOPE_CORDURA';
      console.error(
        `🚨 [link-auto] ${filas.length} candidatas (${tipo}) para ${fecha} (tope ${TOPE_CORDURA}). ` +
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
          tipo,
          historiaId: fila.historiaId,
          accion: dryRun ? 'OMITIRIA' : 'OMITIDA',
          nombre: nombreDe(fila),
          numeroId: fila.numeroId ?? undefined,
          celular: fila.celular ?? undefined,
          medico: fila.medico ?? undefined,
          horaCita: fila.horaBogota ?? undefined,
          motivo: prep.motivo,
        });
        if (!dryRun) await this.marcarOmitida(fecha, tipo, fila, prep.motivo);
        continue;
      }

      const d: LinkPreparado = prep.data;
      const base: ItemCorrida = {
        tipo,
        historiaId: d.historiaId,
        accion: 'ENVIARIA',
        nombre: d.patientName,
        numeroId: fila.numeroId ?? undefined,
        celular: d.phoneE164,
        medico: fila.medico ?? undefined,
        horaCita: d.horaCita,
        appointmentTime: d.appointmentTime,
        // La sala solo importa para el LINK; el recordatorio no la toca.
        ...(tipo === 'link'
          ? {
              roomName: d.roomName,
              roomNameReusada: d.roomNameReusada,
              roomNameWithParams: d.roomNameWithParams,
              linkPaciente: d.linkPaciente,
            }
          : {}),
      };

      if (dryRun) {
        resumen.items.push(base);
        continue;
      }

      const reclamada = await this.reclamar(fecha, tipo, d.historiaId, cfg.maxIntentos);
      if (!reclamada) {
        resumen.yaReclamadas++;
        resumen.items.push({ ...base, accion: 'YA_RECLAMADA' });
        continue;
      }

      const r =
        tipo === 'link'
          ? await enviarLinkPaciente({
              historiaId: d.historiaId,
              phone: d.phoneE164,
              patientName: d.patientName,
              appointmentTime: d.appointmentTime,
              roomNameWithParams: d.roomNameWithParams,
              origen: 'auto',
              esperarEfectos: true,
              usarPlataforma: plataformaViva,
            })
          : await enviarRecordatorioPaciente({
              historiaId: d.historiaId,
              phone: d.phoneE164,
              patientName: d.patientName,
              appointmentTime: d.appointmentTime,
              usarPlataforma: plataformaViva,
            });

      if (r.success) {
        if (r.via === 'twilio' && plataformaViva) plataformaViva = false;
        resumen.enviadas++;
        resumen.items.push({ ...base, accion: 'ENVIADA', via: r.via });
        await this.marcarEnviada(fecha, tipo, d, r.messageSid, r.via);
      } else {
        plataformaViva = false;
        resumen.fallidas++;
        resumen.items.push({ ...base, accion: 'FALLIDA', error: r.error });
        await this.marcarError(fecha, tipo, d.historiaId, r.error || 'error desconocido');
        console.error(`❌ [link-auto] Falló ${tipo} a ${d.phoneE164}: ${r.error}`);
      }

      await sleep(cfg.pausaMs);
    }

    return resumen;
  }

  /** Bitácora del día para el panel admin: conteo por tipo y estado + el detalle. */
  async getEstado(fecha: string): Promise<{
    fecha: string;
    porTipo: Record<string, Record<string, number>>;
    filas: Record<string, unknown>[];
  } | null> {
    const filas = await postgresService.query(
      `SELECT tipo, historia_id, estado, motivo, intentos, celular, hora_cita, room_name,
              message_sid, via, error,
              to_char(enviado_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS enviado_at,
              to_char(next_try_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS next_try_at
         FROM link_auto_envio
        WHERE fecha = $1::date
        ORDER BY tipo, hora_cita NULLS LAST, historia_id`,
      [fecha]
    );
    if (filas === null) return null;

    const porTipo: Record<string, Record<string, number>> = {};
    for (const f of filas) {
      const t = String(f.tipo);
      const e = String(f.estado);
      porTipo[t] = porTipo[t] || {};
      porTipo[t][e] = (porTipo[t][e] || 0) + 1;
    }
    return { fecha, porTipo, filas };
  }

  // -------------------------------------------------------------------------
  // Base de datos
  // -------------------------------------------------------------------------

  private async getCandidatas(
    fecha: string,
    cfg: Config,
    opts: { tipo: TipoEnvio; limit?: number; historiaId?: string }
  ): Promise<FilaCitaLink[] | null> {
    let dia: { inicioUtc: string; finUtc: string };
    try {
      dia = rangoDiaColombia(fecha);
    } catch {
      return null;
    }

    // La ventana de la cita:
    //  · recordatorio → todo el día.
    //  · link → de (ahora - gracia) a (ahora + minutosAntes). Una cita puntual
    //    pedida a mano (historiaId) ignora la ventana: es "mandáselo YA".
    let desde = dia.inicioUtc;
    let hasta = dia.finUtc;
    if (opts.tipo === 'recordatorio' && !opts.historiaId) {
      // Solo citas que todavía no pasaron. A las 07:00 es el día entero; pero
      // si la tanda corre tarde (servidor caído, flag prendido a media tarde)
      // no se le dice "hoy tienes consulta a las 10" a quien ya la tuvo.
      const ahora = new Date().toISOString();
      if (ahora > desde) desde = ahora;
    }
    if (opts.tipo === 'link' && !opts.historiaId) {
      const ahora = Date.now();
      desde = new Date(ahora - cfg.linkGraciaMin * 60_000).toISOString();
      hasta = new Date(ahora + cfg.linkMinutosAntes * 60_000).toISOString();
    }

    const limit = Math.min(opts.limit || cfg.maxPorCorrida, TOPE_CORDURA + 1);
    const params: unknown[] = [desde, hasta, fecha, cfg.maxIntentos, limit, opts.tipo, dia.inicioUtc];

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
    //    es TEXT y mezcla formatos ('Z' y '-05:00').
    //  · link_enviado_at < inicio del día ⇒ una cita reprogramada DESDE otro
    //    día vuelve a recibir su mensaje (con la hora nueva); una ya contactada
    //    HOY por el coach no recibe ni el recordatorio ni el link de nuevo.
    //  · `medico_valido` viaja como COLUMNA, no como filtro: una cita cuyo
    //    `medico` no existe en `profesionales` se omite en la capa de arriba,
    //    pero queda registrada. Filtrarla acá la haría invisible, y son justo
    //    las que hay que ver (mybodytech guarda ahí el nombre, no el código).
    //  · Las citas de Trepsi canceladas siguen "vivas" en HistoriaClinica
    //    (trepsi.service.cancel solo toca trepsi_appointments), y Trepsi es el
    //    94% del volumen: sin este NOT EXISTS le escribiríamos a gente que
    //    canceló.
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
         AND h."fechaAtencion"::timestamptz <= $2::timestamptz
         AND h."fechaConsulta" IS NULL
         AND UPPER(COALESCE(h."atendido", 'PENDIENTE')) NOT IN ('ATENDIDO', 'NO CONTESTA')
         AND COALESCE(h."pvEstado", '') <> 'No Contesta'
         AND COALESCE(h."numeroId", '') NOT IN ('TEST', 'test')
         AND (h."link_enviado_at" IS NULL OR h."link_enviado_at" < $7::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM trepsi_appointments t
                          WHERE t.historia_id = h."_id" AND t.estado = 'cancelled')
         AND NOT EXISTS (
               SELECT 1 FROM link_auto_envio e
                WHERE e.fecha = $3::date AND e.historia_id = h."_id" AND e.tipo = $6
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
  private async reclamar(
    fecha: string,
    tipo: TipoEnvio,
    historiaId: string,
    maxIntentos: number
  ): Promise<boolean> {
    const r = await postgresService.query(
      `INSERT INTO link_auto_envio (fecha, historia_id, tipo, estado, intentos, claimed_at, next_try_at)
       VALUES ($1::date, $2, $4, 'claimed', 1, NOW(), NOW())
       ON CONFLICT (fecha, historia_id, tipo) DO UPDATE
          SET estado = 'claimed', intentos = link_auto_envio.intentos + 1,
              claimed_at = NOW(), error = NULL
        WHERE link_auto_envio.estado IN ('error', 'omitido', 'claimed')
          AND link_auto_envio.intentos < $3
          AND link_auto_envio.next_try_at <= NOW()
          AND (link_auto_envio.estado <> 'claimed'
               OR link_auto_envio.claimed_at < NOW() - INTERVAL '15 minutes')
       RETURNING historia_id`,
      [fecha, historiaId, maxIntentos, tipo]
    );
    return Array.isArray(r) && r.length > 0;
  }

  private async marcarEnviada(
    fecha: string,
    tipo: TipoEnvio,
    d: LinkPreparado,
    messageSid: string | undefined,
    via: string
  ): Promise<void> {
    await postgresService
      .query(
        `UPDATE link_auto_envio
            SET estado = 'enviado', enviado_at = NOW(), error = NULL, motivo = NULL,
                celular = $4, hora_cita = $5, room_name = $6, message_sid = $7, via = $8
          WHERE fecha = $1::date AND historia_id = $2 AND tipo = $3`,
        [
          fecha,
          d.historiaId,
          tipo,
          d.phoneE164,
          d.horaCita,
          tipo === 'link' ? d.roomName : null,
          messageSid || null,
          via,
        ]
      )
      .catch((e) => console.error('⚠️ [link-auto] Error marcando enviada:', e?.message ?? e));
  }

  /** Backoff lineal: 15 min por intento ya hecho. */
  private async marcarError(fecha: string, tipo: TipoEnvio, historiaId: string, error: string): Promise<void> {
    await postgresService
      .query(
        `UPDATE link_auto_envio
            SET estado = 'error', error = $4,
                next_try_at = NOW() + (intentos * INTERVAL '15 minutes')
          WHERE fecha = $1::date AND historia_id = $2 AND tipo = $3`,
        [fecha, historiaId, tipo, error.slice(0, 500)]
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
    tipo: TipoEnvio,
    fila: FilaCitaLink,
    motivo: MotivoOmision
  ): Promise<void> {
    await postgresService
      .query(
        `INSERT INTO link_auto_envio (fecha, historia_id, tipo, estado, motivo, intentos, celular, hora_cita, next_try_at)
         VALUES ($1::date, $2, $3, 'omitido', $4, 0, $5, $6, NOW() + INTERVAL '30 minutes')
         ON CONFLICT (fecha, historia_id, tipo) DO UPDATE
            SET estado = 'omitido', motivo = $4, celular = $5, hora_cita = $6,
                next_try_at = NOW() + INTERVAL '30 minutes'
          WHERE link_auto_envio.estado <> 'enviado'`,
        [fecha, fila.historiaId, tipo, motivo, fila.celular, fila.horaBogota]
      )
      .catch((e) => console.error('⚠️ [link-auto] Error marcando omitida:', e?.message ?? e));
  }
}

function nombreDe(f: FilaCitaLink): string {
  const n = `${f.primerNombre || ''} ${f.primerApellido || ''}`.trim();
  return n || '(sin nombre)';
}

export default new LinkAutoService();
