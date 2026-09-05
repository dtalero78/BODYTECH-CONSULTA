// ============================================================================
// llamadas-voz.service — el coach llama al paciente, en vivo, y queda grabado.
//
// Hasta ahora la "llamada" era un robot: Twilio marcaba al paciente y le
// reproducía un audio pregrabado; el coach nunca estaba en la línea. Esto es
// otra cosa: una conversación real, y con grabación.
//
// Cómo se arma (puente por celular, dos tramos):
//
//   1. El coach aprieta "Llamar". Twilio marca PRIMERO al celular del coach.
//   2. Cuando el coach contesta, Twilio pide el TwiML de /twiml: le dice
//      "conectando con Juan" y hace <Dial> al paciente.
//   3. Cuando el paciente contesta, ANTES de unirlos, oye el aviso de /aviso:
//      "esta llamada será grabada". Es obligatorio (Ley 1581): no es opcional.
//   4. Quedan unidos. La grabación arranca al contestar el paciente, en dos
//      canales separados (coach / paciente) — eso es lo que después le permite
//      a Calidad saber quién dijo qué.
//   5. Cuelga cualquiera → /dial-fin cierra el estado, y un rato después llega
//      /grabacion con el audio listo.
//
// Por qué al celular y no al navegador: cero permisos de micrófono, no depende
// del wifi del coach, y el panel ya carga la videollamada — meterle otro motor
// de audio es riesgo que hoy no hace falta. El servidor queda igual para un
// softphone después: solo cambiaría el primer tramo.
//
// Los webhooks de Twilio llegan desordenados y repetidos. Por eso las
// transiciones son una función pura (`aplicarEvento`) y los UPDATE nunca
// retroceden desde un estado terminal ni pisan un timestamp ya escrito.
// ============================================================================

import twilio from 'twilio';
import axios from 'axios';
import type { Readable } from 'stream';
import postgresService from './postgres.service';
import usuariosService from './usuarios.service';
import { formatCelularE164 } from './link-paciente.service';
import type { SessionPayload } from './auth.service';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Número saliente unificado de Bodytech — el mismo que ya conoce el paciente. */
const FROM = process.env.TWILIO_VOICE_FROM || '+576016284820';

/** Segundos que suena el celular del coach / del paciente antes de rendirse. */
const TIMEOUT_COACH_SEG = 25;
const TIMEOUT_PACIENTE_SEG = 30;

/** Una llamada sin cierre por webhook después de esto se da por caída. */
const MINUTOS_LLAMADA_HUERFANA = 20;

/**
 * Credenciales de VOZ. Twilio firma los webhooks con el token de la cuenta que
 * hizo la llamada, así que si Voice corre en una subcuenta hay que validar con
 * ESE token, no con el general.
 */
export function credencialesVoz(): { accountSid: string; authToken: string } {
  return {
    accountSid: process.env.TWILIO_VOICE_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_VOICE_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '',
  };
}

/** Base pública que Twilio puede alcanzar (en local no hay forma; es prod/staging). */
export function baseUrlPublica(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'https://bodytech.app').replace(
    /\/+$/,
    ''
  );
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export type EstadoLlamada =
  | 'iniciando' // fila creada, aún no se pidió la llamada a Twilio
  | 'llamando_coach' // suena el celular del coach
  | 'llamando_paciente' // el coach contestó; suena el del paciente
  | 'en_llamada' // los dos conectados
  | 'completada' // hablaron y colgaron
  | 'sin_respuesta' // el paciente no contestó (o ocupado)
  | 'coach_no_contesto' // el coach no atendió su propio celular
  | 'fallida'; // Twilio no pudo (número inválido, error de red, huérfana)

export const ESTADOS_TERMINALES: ReadonlyArray<EstadoLlamada> = [
  'completada',
  'sin_respuesta',
  'coach_no_contesto',
  'fallida',
];

export function esTerminal(estado: string): boolean {
  return (ESTADOS_TERMINALES as ReadonlyArray<string>).includes(estado);
}

/** Lo que nos cuenta Twilio, ya normalizado. */
export type EventoLlamada =
  | { tipo: 'coach'; status: string }
  | { tipo: 'paciente'; status: string }
  | { tipo: 'dial_fin'; dialStatus: string };

/**
 * PURA. Dado el estado actual y un evento, el estado nuevo — o `null` si el
 * evento no mueve nada (repetido, fuera de orden, o ya terminal).
 *
 * Los `status` de Twilio: queued | initiated | ringing | in-progress |
 * completed | busy | no-answer | failed | canceled. El `DialCallStatus` del
 * <Dial>: completed | answered | busy | no-answer | failed | canceled.
 */
export function aplicarEvento(actual: EstadoLlamada, ev: EventoLlamada): EstadoLlamada | null {
  if (esTerminal(actual)) return null;

  if (ev.tipo === 'coach') {
    switch (ev.status) {
      case 'initiated':
      case 'queued':
      case 'ringing':
        return actual === 'iniciando' ? 'llamando_coach' : null;
      case 'in-progress':
      case 'answered':
        return actual === 'iniciando' || actual === 'llamando_coach' ? 'llamando_paciente' : null;
      case 'busy':
      case 'no-answer':
      case 'failed':
      case 'canceled':
        // Si el coach nunca contestó, es SU no-respuesta. Si ya había contestado
        // y el tramo terminó así, es un fallo de la llamada.
        return actual === 'iniciando' || actual === 'llamando_coach' ? 'coach_no_contesto' : 'fallida';
      case 'completed':
        // El tramo del coach cerró. Si nunca llegamos a unir con el paciente y
        // /dial-fin no dijo nada, lo damos por "sin respuesta" del paciente.
        if (actual === 'en_llamada') return 'completada';
        if (actual === 'llamando_paciente') return 'sin_respuesta';
        return 'coach_no_contesto';
      default:
        return null;
    }
  }

  if (ev.tipo === 'paciente') {
    switch (ev.status) {
      case 'initiated':
      case 'queued':
      case 'ringing':
        return actual === 'llamando_coach' || actual === 'iniciando' ? 'llamando_paciente' : null;
      case 'in-progress':
      case 'answered':
        return actual !== 'en_llamada' ? 'en_llamada' : null;
      case 'completed':
        return actual === 'en_llamada' ? 'completada' : null;
      case 'busy':
      case 'no-answer':
      case 'failed':
      case 'canceled':
        return actual === 'en_llamada' ? 'completada' : 'sin_respuesta';
      default:
        return null;
    }
  }

  // dial_fin: lo que <Dial> reporta al terminar de intentar con el paciente.
  switch (ev.dialStatus) {
    case 'completed':
    case 'answered':
      return 'completada';
    case 'busy':
    case 'no-answer':
    case 'canceled':
      return actual === 'en_llamada' ? 'completada' : 'sin_respuesta';
    case 'failed':
      return actual === 'en_llamada' ? 'completada' : 'fallida';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// TwiML (puro: solo arma XML)
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SAY = `voice="alice" language="es-MX"`;

/**
 * Lo que oye el COACH al contestar: un "conectando con…" y el <Dial> al
 * paciente. La grabación (dos canales, desde que contesta el paciente) y todos
 * los callbacks se declaran acá.
 */
export function twimlParaCoach(p: {
  llamadaId: number;
  pacienteNombre: string;
  pacienteCelular: string;
  base: string;
}): string {
  const u = (path: string) => escapeXml(`${p.base}/api/twilio/llamadas/${p.llamadaId}${path}`);
  const nombre = escapeXml(p.pacienteNombre || 'el paciente');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say ${SAY}>Conectando con ${nombre}.</Say>` +
    `<Dial callerId="${escapeXml(FROM)}" timeout="${TIMEOUT_PACIENTE_SEG}"` +
    ` record="record-from-answer-dual"` +
    ` recordingStatusCallback="${u('/grabacion')}" recordingStatusCallbackMethod="POST"` +
    ` recordingStatusCallbackEvent="completed"` +
    ` action="${u('/dial-fin')}" method="POST">` +
    `<Number url="${u('/aviso')}" method="POST"` +
    ` statusCallback="${u('/estado?leg=paciente')}" statusCallbackMethod="POST"` +
    ` statusCallbackEvent="initiated ringing answered completed">` +
    escapeXml(p.pacienteCelular) +
    `</Number>` +
    `</Dial>` +
    `</Response>`
  );
}

/**
 * Lo que oye el PACIENTE al contestar, antes de que lo unan con el coach. El
 * aviso de grabación es obligatorio; queda dentro de la grabación como prueba.
 */
export function twimlAvisoPaciente(p: { pacienteNombre: string }): string {
  const nombre = p.pacienteNombre ? `Hola ${escapeXml(p.pacienteNombre)}, ` : 'Hola, ';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say ${SAY}>${nombre}te habla Bodytech. Esta llamada será grabada con fines de calidad.</Say>` +
    `</Response>`
  );
}

/** Lo que oye el COACH cuando <Dial> termina sin que el paciente atendiera. */
export function twimlDialFin(dialStatus: string): string {
  const mensaje =
    dialStatus === 'busy'
      ? 'El paciente tiene la línea ocupada.'
      : dialStatus === 'no-answer' || dialStatus === 'canceled'
        ? 'El paciente no contestó.'
        : dialStatus === 'failed'
          ? 'No se pudo completar la llamada.'
          : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    (mensaje ? `<Say ${SAY}>${mensaje}</Say>` : '') +
    `<Hangup/>` +
    `</Response>`
  );
}

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export interface LlamadaVoz {
  id: number;
  historiaId: string;
  numeroId: string | null;
  pacienteNombre: string | null;
  pacienteCelular: string;
  coachCodigo: string | null;
  coachUsuarioId: number | null;
  coachNombre: string | null;
  coachCelular: string;
  sedeId: string | null;
  estado: EstadoLlamada;
  motivoFin: string | null;
  callSid: string | null;
  duracionSeg: number | null;
  iniciadaAt: string;
  contestadaCoachAt: string | null;
  contestadaPacienteAt: string | null;
  finalizadaAt: string | null;
  recordingSid: string | null;
  recordingDuracionSeg: number | null;
  recordingEstado: 'pendiente' | 'lista' | 'error';
  error: string | null;
}

const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function filaALlamada(r: Record<string, unknown>): LlamadaVoz {
  return {
    id: Number(r.id),
    historiaId: String(r.historia_id),
    numeroId: r.numero_id ? String(r.numero_id) : null,
    pacienteNombre: r.paciente_nombre ? String(r.paciente_nombre) : null,
    pacienteCelular: String(r.paciente_celular),
    coachCodigo: r.coach_codigo ? String(r.coach_codigo) : null,
    coachUsuarioId: r.coach_usuario_id != null ? Number(r.coach_usuario_id) : null,
    coachNombre: r.coach_nombre ? String(r.coach_nombre) : null,
    coachCelular: String(r.coach_celular),
    sedeId: r.sede_id ? String(r.sede_id) : null,
    estado: String(r.estado) as EstadoLlamada,
    motivoFin: r.motivo_fin ? String(r.motivo_fin) : null,
    callSid: r.call_sid ? String(r.call_sid) : null,
    duracionSeg: r.duracion_seg != null ? Number(r.duracion_seg) : null,
    iniciadaAt: iso(r.iniciada_at) || new Date(0).toISOString(),
    contestadaCoachAt: iso(r.contestada_coach_at),
    contestadaPacienteAt: iso(r.contestada_paciente_at),
    finalizadaAt: iso(r.finalizada_at),
    recordingSid: r.recording_sid ? String(r.recording_sid) : null,
    recordingDuracionSeg: r.recording_duracion_seg != null ? Number(r.recording_duracion_seg) : null,
    recordingEstado: (String(r.recording_estado) as LlamadaVoz['recordingEstado']) || 'pendiente',
    error: r.error ? String(r.error) : null,
  };
}

export type ErrorInicio =
  | 'HISTORIA_NO_ENCONTRADA'
  | 'SIN_CELULAR_PACIENTE'
  | 'SIN_CELULAR_COACH'
  | 'LLAMADA_EN_CURSO'
  | 'TWILIO_NO_CONFIGURADO'
  | 'TWILIO_ERROR'
  | 'DB_ERROR';

export type ResultadoInicio =
  | { ok: true; llamada: LlamadaVoz }
  | { ok: false; error: ErrorInicio; detalle?: string };

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

class LlamadasVozService {
  /**
   * Arranca una llamada. Los celulares se resuelven ACÁ, del servidor: el del
   * paciente de la historia y el del coach de su usuario. El cliente solo manda
   * la cita — nunca un número, para que nadie pueda usar el número de Bodytech
   * para llamar a quien quiera.
   */
  async iniciar(historiaId: string, session: SessionPayload): Promise<ResultadoInicio> {
    const { accountSid, authToken } = credencialesVoz();
    if (!accountSid || !authToken) return { ok: false, error: 'TWILIO_NO_CONFIGURADO' };

    const hc = await postgresService.query(
      `SELECT "_id", "numeroId", "primerNombre", "primerApellido", "celular", "medico", "sede_id"
         FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
      [historiaId]
    );
    if (hc === null) return { ok: false, error: 'DB_ERROR' };
    if (hc.length === 0) return { ok: false, error: 'HISTORIA_NO_ENCONTRADA' };
    const h = hc[0] as Record<string, unknown>;

    const pacienteCelular = formatCelularE164(String(h.celular || ''));
    if (!pacienteCelular) return { ok: false, error: 'SIN_CELULAR_PACIENTE' };

    const usuario = await usuariosService.findActiveById(session.userId);
    const coachCelular = formatCelularE164(usuario?.celular || '');
    if (!coachCelular) return { ok: false, error: 'SIN_CELULAR_COACH' };

    // Un coach, una llamada a la vez. Las filas que quedaron colgadas (nunca
    // llegó el cierre de Twilio) se dan por caídas antes de contar.
    await this.cerrarHuerfanas();
    const activa = await postgresService.query(
      `SELECT id FROM llamadas_voz
        WHERE coach_usuario_id = $1 AND estado NOT IN (${ESTADOS_TERMINALES.map((e) => `'${e}'`).join(',')})
        LIMIT 1`,
      [session.userId]
    );
    if (activa === null) return { ok: false, error: 'DB_ERROR' };
    if (activa.length > 0) return { ok: false, error: 'LLAMADA_EN_CURSO' };

    const pacienteNombre = [h.primerNombre, h.primerApellido]
      .map((x) => (x ? String(x).trim() : ''))
      .filter(Boolean)
      .join(' ');

    const creada = await postgresService.query(
      `INSERT INTO llamadas_voz
         (historia_id, numero_id, paciente_nombre, paciente_celular,
          coach_codigo, coach_usuario_id, coach_nombre, coach_celular, sede_id, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'iniciando')
       RETURNING *`,
      [
        historiaId,
        h.numeroId ? String(h.numeroId) : null,
        pacienteNombre || null,
        pacienteCelular,
        session.codigo ?? (h.medico ? String(h.medico) : null),
        session.userId,
        session.nombre ?? null,
        coachCelular,
        h.sede_id ? String(h.sede_id) : null,
      ]
    );
    if (!creada || creada.length === 0) return { ok: false, error: 'DB_ERROR' };
    const llamada = filaALlamada(creada[0]);

    // Primer tramo: el celular del coach. Cuando conteste, Twilio pide /twiml.
    const base = baseUrlPublica();
    try {
      const client = twilio(accountSid, authToken);
      const call = await client.calls.create({
        to: coachCelular,
        from: FROM,
        url: `${base}/api/twilio/llamadas/${llamada.id}/twiml`,
        method: 'POST',
        statusCallback: `${base}/api/twilio/llamadas/${llamada.id}/estado?leg=coach`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        timeout: TIMEOUT_COACH_SEG,
      });
      await postgresService.query(
        `UPDATE llamadas_voz SET call_sid = $2, estado = 'llamando_coach', updated_at = NOW()
          WHERE id = $1 AND estado = 'iniciando'`,
        [llamada.id, call.sid]
      );
      return { ok: true, llamada: { ...llamada, callSid: call.sid, estado: 'llamando_coach' } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ [llamadas-voz] Twilio no pudo iniciar la llamada #${llamada.id}: ${msg}`);
      await postgresService.query(
        `UPDATE llamadas_voz SET estado = 'fallida', error = $2, finalizada_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [llamada.id, msg.slice(0, 500)]
      );
      return { ok: false, error: 'TWILIO_ERROR', detalle: msg };
    }
  }

  async get(id: number): Promise<LlamadaVoz | null> {
    const rows = await postgresService.query(`SELECT * FROM llamadas_voz WHERE id = $1`, [id]);
    if (!rows || rows.length === 0) return null;
    return filaALlamada(rows[0]);
  }

  /** Las llamadas de una historia, más reciente primero. */
  async listarPorHistoria(historiaId: string): Promise<LlamadaVoz[] | null> {
    const rows = await postgresService.query(
      `SELECT * FROM llamadas_voz WHERE historia_id = $1 ORDER BY iniciada_at DESC`,
      [historiaId]
    );
    if (rows === null) return null;
    return rows.map((r: Record<string, unknown>) => filaALlamada(r));
  }

  /**
   * ¿Esta sesión puede ver esta llamada? El coach solo las suyas; coordinador
   * y admin todas. Escuchar el AUDIO es aparte (ver `puedeEscuchar`).
   */
  puedeVer(session: SessionPayload, llamada: LlamadaVoz): boolean {
    if (session.role === 'admin' || session.role === 'coordinador') return true;
    return llamada.coachUsuarioId === session.userId;
  }

  /** Las grabaciones son audio de pacientes: solo quien audita. Los coaches no. */
  puedeEscuchar(session: SessionPayload): boolean {
    return session.role === 'admin' || session.role === 'coordinador';
  }

  // --- Webhooks ------------------------------------------------------------

  /**
   * Cambio de estado de un tramo (coach o paciente). Idempotente: la
   * transición la decide `aplicarEvento`, y el UPDATE exige que el estado en
   * BD sea todavía el que vimos — si otro webhook ganó la carrera, no pisamos.
   */
  async registrarEstadoLeg(
    id: number,
    leg: 'coach' | 'paciente',
    status: string,
    extras: { callSid?: string; duracionSeg?: number | null }
  ): Promise<void> {
    const actual = await this.get(id);
    if (!actual) return;

    const nuevo = aplicarEvento(actual.estado, { tipo: leg, status });
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id, actual.estado];

    if (nuevo) {
      params.push(nuevo);
      sets.push(`estado = $${params.length}`);
      if (esTerminal(nuevo)) sets.push('finalizada_at = COALESCE(finalizada_at, NOW())');
    }
    const contesto = status === 'in-progress' || status === 'answered';
    if (leg === 'coach' && contesto) sets.push('contestada_coach_at = COALESCE(contestada_coach_at, NOW())');
    if (leg === 'paciente' && contesto) {
      sets.push('contestada_paciente_at = COALESCE(contestada_paciente_at, NOW())');
    }
    if (leg === 'paciente' && extras.callSid) {
      params.push(extras.callSid);
      sets.push(`dial_call_sid = COALESCE(dial_call_sid, $${params.length})`);
    }
    if (leg === 'coach' && status === 'completed' && extras.duracionSeg != null) {
      params.push(extras.duracionSeg);
      sets.push(`duracion_seg = COALESCE(duracion_seg, $${params.length})`);
    }
    if (sets.length === 1 && !nuevo) return; // nada que escribir

    await postgresService.query(
      `UPDATE llamadas_voz SET ${sets.join(', ')} WHERE id = $1 AND estado = $2`,
      params
    );
  }

  /** `action` del <Dial>: cómo terminó el intento con el paciente. */
  async registrarDialFin(id: number, dialStatus: string, dialDuracionSeg: number | null): Promise<void> {
    const actual = await this.get(id);
    if (!actual) return;
    const nuevo = aplicarEvento(actual.estado, { tipo: 'dial_fin', dialStatus });
    if (!nuevo) return;
    await postgresService.query(
      `UPDATE llamadas_voz
          SET estado = $3, motivo_fin = COALESCE(motivo_fin, $4),
              duracion_seg = COALESCE($5, duracion_seg),
              finalizada_at = COALESCE(finalizada_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND estado = $2`,
      [id, actual.estado, nuevo, dialStatus, dialDuracionSeg]
    );
  }

  /** La grabación quedó lista en Twilio. */
  async registrarGrabacion(
    id: number,
    p: { recordingSid: string; recordingUrl: string; duracionSeg: number | null; status: string }
  ): Promise<void> {
    const lista = p.status === 'completed';
    await postgresService.query(
      `UPDATE llamadas_voz
          SET recording_sid = COALESCE(recording_sid, $2),
              recording_url = COALESCE(recording_url, $3),
              recording_duracion_seg = COALESCE($4, recording_duracion_seg),
              recording_estado = $5, updated_at = NOW()
        WHERE id = $1`,
      [id, p.recordingSid, p.recordingUrl, p.duracionSeg, lista ? 'lista' : 'error']
    );
  }

  /**
   * Llamadas que nunca recibieron su cierre (contenedor reiniciado, webhook
   * perdido). Se dan por fallidas para que el coach pueda volver a llamar.
   */
  async cerrarHuerfanas(): Promise<void> {
    await postgresService.query(
      `UPDATE llamadas_voz
          SET estado = 'fallida', motivo_fin = COALESCE(motivo_fin, 'huerfana'),
              finalizada_at = COALESCE(finalizada_at, NOW()), updated_at = NOW()
        WHERE estado NOT IN (${ESTADOS_TERMINALES.map((e) => `'${e}'`).join(',')})
          AND iniciada_at < NOW() - INTERVAL '${MINUTOS_LLAMADA_HUERFANA} minutes'`
    );
  }

  // --- Audio ---------------------------------------------------------------

  /**
   * El MP3 de la grabación, como stream desde Twilio. La grabación vive en
   * Twilio (igual que las composiciones de video que ya usa Calidad); el
   * navegador nunca ve la URL de Twilio ni las credenciales — pasa por acá,
   * con el rol ya verificado. Cuando el bucket S3 esté conectado en producción,
   * este es el único punto que cambia.
   */
  async abrirAudio(
    llamada: LlamadaVoz
  ): Promise<{ stream: Readable; contentType: string; contentLength?: string } | null> {
    if (!llamada.recordingSid || llamada.recordingEstado !== 'lista') return null;
    const { accountSid, authToken } = credencialesVoz();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${llamada.recordingSid}.mp3`;
    const res = await axios.get<Readable>(url, {
      auth: { username: accountSid, password: authToken },
      responseType: 'stream',
    });
    return {
      stream: res.data,
      contentType: 'audio/mpeg',
      contentLength: res.headers['content-length'] as string | undefined,
    };
  }
}

export default new LlamadasVozService();
