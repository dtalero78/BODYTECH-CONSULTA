// ============================================================================
// llamadas-voz.service — el coach llama al paciente, en vivo, y queda grabado.
//
// Hasta ahora la "llamada" era un robot: Twilio marcaba al paciente y le
// reproducía un audio pregrabado; el coach nunca estaba en la línea. Esto es
// otra cosa: una conversación real, y con grabación.
//
// Cómo se arma (softphone en el navegador + un tramo telefónico):
//
//   1. El coach aprieta "Llamar". El navegador se conecta a Twilio con el SDK
//      de voz (audífonos, sin celular). Twilio pide el TwiML de /softphone:
//      "conectando con Juan" y <Dial> al paciente DESDE el número de Bodytech.
//   2. (El primer diseño marcaba antes al celular del coach. Se descartó: el
//      coach no debe depender de su teléfono, y el paciente debe ver siempre
//      el número de Bodytech — que es lo que hace el callerId del <Dial>.)
//   3. Cuando el paciente contesta, ANTES de unirlos, oye el aviso de /aviso:
//      "esta llamada será grabada". Es obligatorio (Ley 1581): no es opcional.
//   4. Quedan unidos. La grabación arranca al contestar el paciente, en dos
//      canales separados (coach / paciente) — eso es lo que después le permite
//      a Calidad saber quién dijo qué.
//   5. Cuelga cualquiera → /dial-fin cierra el estado, y un rato después llega
//      /grabacion con el audio listo.
//
// El navegador necesita un token de voz (API Key + TwiML App) que emite
// `tokenVoz`; la TwiML App tiene voice_url=/softphone y status_callback=
// /estado-app, así los estados del tramo del coach llegan por CallSid.
//
// Los webhooks de Twilio llegan desordenados y repetidos. Por eso las
// transiciones son una función pura (`aplicarEvento`) y los UPDATE nunca
// retroceden desde un estado terminal ni pisan un timestamp ya escrito.
// ============================================================================

import twilio from 'twilio';
import axios from 'axios';
import type { Readable } from 'stream';
import postgresService from './postgres.service';
import { formatCelularE164 } from './link-paciente.service';
import { descargarGrabacionVozComoBuffer } from './twilio-media.service';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { transcribeService } from './video/transcribe.service';
import type { SessionPayload } from './auth.service';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Número saliente unificado de Bodytech — el mismo que ya conoce el paciente. */
const FROM = process.env.TWILIO_VOICE_FROM || '+576016284820';

/** Segundos que suena el celular del paciente antes de rendirse. */
const TIMEOUT_PACIENTE_SEG = 30;

/** Una llamada sin cierre por webhook después de esto se da por caída. */
const MINUTOS_LLAMADA_HUERFANA = 20;

// La grabación se pide con `record-from-answer-dual`: Twilio deja al coach en un
// canal y al paciente en el otro. Amazon Transcribe lee esos canales por
// separado (ChannelIdentification), así que la atribución es EXACTA — no se
// infiere quién habla, y como nosotros armamos el puente sabemos cuál es cuál:
// el canal 0 es el tramo padre (el softphone del coach) y el 1 el del paciente.
// Por eso acá no se usa Whisper, que aplastaría los dos canales en un bloque.
const S3_REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = process.env.RECORDINGS_BUCKET || '';
const PREFIJO_AUDIO = 'audio-llamada';
const CANALES = { ch0: 'Coach', ch1: 'Paciente' };

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

/** Lo que necesita el navegador para hablar: API Key (firma el token) + TwiML App. */
export function configSoftphone(): {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  appSid: string;
} {
  return {
    accountSid: process.env.TWILIO_VOICE_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '',
    apiKeySid: process.env.TWILIO_API_KEY_SID || '',
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || '',
    appSid: process.env.TWILIO_VOICE_APP_SID || '',
  };
}

/** Identidad del coach dentro de Twilio: es lo que llega como `From: client:…`. */
export function identidadCoach(userId: number): string {
  return `coach-${userId}`;
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
  coachCelular: string | null;
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
  /** NULL = no se intentó; processing | done | error. */
  transcriptionStatus: 'processing' | 'done' | 'error' | null;
  transcriptionText: string | null;
  transcribedAt: string | null;
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
    coachCelular: r.coach_celular ? String(r.coach_celular) : null,
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
    transcriptionStatus: (r.transcription_status as LlamadaVoz['transcriptionStatus']) || null,
    transcriptionText: r.transcription_text ? String(r.transcription_text) : null,
    transcribedAt: iso(r.transcribed_at),
  };
}

export type ErrorInicio =
  | 'HISTORIA_NO_ENCONTRADA'
  | 'SIN_CELULAR_PACIENTE'
  | 'LLAMADA_EN_CURSO'
  | 'SOFTPHONE_NO_CONFIGURADO'
  | 'DB_ERROR';

export type ResultadoInicio =
  | { ok: true; llamada: LlamadaVoz }
  | { ok: false; error: ErrorInicio; detalle?: string };

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

class LlamadasVozService {
  private s3 = new S3Client({ region: S3_REGION });

  /**
   * Token de voz para el navegador del coach. Solo puede hacer llamadas
   * SALIENTES por la TwiML App de Bodytech; no recibe. Vence en una hora y el
   * SDK avisa antes (`tokenWillExpire`) para pedir otro.
   */
  tokenVoz(session: SessionPayload): { token: string; identity: string; ttl: number } | null {
    const c = configSoftphone();
    if (!c.accountSid || !c.apiKeySid || !c.apiKeySecret || !c.appSid) return null;
    const ttl = 3600;
    const identity = identidadCoach(session.userId);
    const { AccessToken } = twilio.jwt;
    const token = new AccessToken(c.accountSid, c.apiKeySid, c.apiKeySecret, { identity, ttl });
    token.addGrant(
      new AccessToken.VoiceGrant({ outgoingApplicationSid: c.appSid, incomingAllow: false })
    );
    return { token: token.toJwt(), identity, ttl };
  }

  /**
   * Crea la llamada. El celular del PACIENTE se resuelve acá, del servidor: el
   * cliente solo manda la cita — nunca un número, para que nadie pueda usar el
   * número de Bodytech para llamar a quien quiera. Después de esto, el
   * navegador se conecta con el SDK y Twilio pide /softphone.
   */
  async iniciar(historiaId: string, session: SessionPayload): Promise<ResultadoInicio> {
    const c = configSoftphone();
    if (!c.appSid || !c.apiKeySid) return { ok: false, error: 'SOFTPHONE_NO_CONFIGURADO' };

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
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,'iniciando')
       RETURNING *`,
      [
        historiaId,
        h.numeroId ? String(h.numeroId) : null,
        pacienteNombre || null,
        pacienteCelular,
        session.codigo ?? (h.medico ? String(h.medico) : null),
        session.userId,
        session.nombre ?? null,
        h.sede_id ? String(h.sede_id) : null,
      ]
    );
    if (!creada || creada.length === 0) return { ok: false, error: 'DB_ERROR' };
    return { ok: true, llamada: filaALlamada(creada[0]) };
  }

  /**
   * El navegador del coach se conectó y Twilio pide qué hacer (/softphone).
   * Solo el coach que creó la llamada puede manejarla: la identidad del token
   * (`From: client:coach-<id>`) tiene que coincidir con la fila. Marca el
   * tramo del coach como contestado y guarda el CallSid, que es la única
   * llave con la que después llegan los estados de la TwiML App.
   */
  async conectarSoftphone(
    id: number,
    callSid: string,
    fromIdentity: string
  ): Promise<LlamadaVoz | null> {
    const actual = await this.get(id);
    if (!actual) return null;
    if (fromIdentity !== `client:${identidadCoach(actual.coachUsuarioId ?? -1)}`) {
      console.warn(`[llamadas-voz] softphone #${id}: identidad ${fromIdentity} no es la del coach`);
      return null;
    }
    if (actual.estado !== 'iniciando' && actual.estado !== 'llamando_coach') return null;
    const rows = await postgresService.query(
      `UPDATE llamadas_voz
          SET call_sid = COALESCE(call_sid, $2), estado = 'llamando_paciente',
              contestada_coach_at = COALESCE(contestada_coach_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND estado IN ('iniciando', 'llamando_coach') RETURNING *`,
      [id, callSid]
    );
    return rows && rows.length > 0 ? filaALlamada(rows[0]) : null;
  }

  /** Estado del tramo del coach, que la TwiML App reporta solo con el CallSid. */
  async registrarEstadoPorCallSid(
    callSid: string,
    status: string,
    duracionSeg: number | null
  ): Promise<void> {
    const rows = await postgresService.query(`SELECT id FROM llamadas_voz WHERE call_sid = $1 LIMIT 1`, [
      callSid,
    ]);
    if (!rows || rows.length === 0) return;
    await this.registrarEstadoLeg(Number(rows[0].id), 'coach', status, { duracionSeg });
  }

  async get(id: number): Promise<LlamadaVoz | null> {
    const rows = await postgresService.query(`SELECT * FROM llamadas_voz WHERE id = $1`, [id]);
    if (!rows || rows.length === 0) return null;
    return filaALlamada(rows[0]);
  }

  /**
   * Las llamadas de una historia, más reciente primero.
   *
   * Antes de listar, pregunta por los jobs de transcripción en curso DE ESTA
   * historia. El job de Transcribe termina en ~1 minuto, pero el barrido corre
   * cada pocos minutos: sin esto, alguien que abre la pantalla veía
   * "Transcribiendo…" durante minutos sobre un texto que ya estaba listo. Es una
   * consulta barata a AWS y solo por las llamadas de esta historia.
   */
  async listarPorHistoria(
    historiaId: string,
    opts: { refrescar?: boolean } = {}
  ): Promise<LlamadaVoz[] | null> {
    if (opts.refrescar !== false) await this.refrescarTranscripciones(historiaId);
    const rows = await postgresService.query(
      `SELECT * FROM llamadas_voz WHERE historia_id = $1 ORDER BY iniciada_at DESC`,
      [historiaId]
    );
    if (rows === null) return null;
    return rows.map((r: Record<string, unknown>) => filaALlamada(r));
  }

  /** Consulta los jobs en curso de una historia y guarda los que ya terminaron. */
  private async refrescarTranscripciones(historiaId: string): Promise<void> {
    if (!S3_BUCKET) return;
    const rows = await postgresService.query(
      `SELECT id, recording_sid, transcription_s3_key FROM llamadas_voz
        WHERE historia_id = $1 AND transcription_status = 'processing'
          AND transcription_s3_key IS NOT NULL`,
      [historiaId]
    );
    for (const r of rows ?? []) {
      try {
        await this.sondearJob(
          Number(r.id),
          String(r.recording_sid),
          String(r.transcription_s3_key)
        );
      } catch (e: unknown) {
        // Que AWS no responda no puede impedir listar las llamadas.
        console.warn(
          `[llamadas-voz] No se pudo refrescar #${r.id}:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  /**
   * Pregunta cómo va un job y, si terminó, guarda el texto y libera el audio.
   * Devuelve true solo cuando quedó transcrita.
   */
  private async sondearJob(id: number, recordingSid: string, key: string): Promise<boolean> {
    const res = await transcribeService.getOrStartFromS3(
      `bodytech-llamada-${recordingSid}`,
      `s3://${S3_BUCKET}/${key}`,
      'mp3',
      { canales: CANALES }
    );
    if (res.status === 'in_progress') return false;
    if (res.status === 'completed' && (res.transcript || '').trim()) {
      await this.guardarTranscripcion(id, res.transcript!.trim());
      await this.borrarAudio(key);
      return true;
    }
    await this.marcarTranscripcionError(id, res.reason || 'Transcribe no devolvió texto');
    await this.borrarAudio(key);
    return false;
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

  // --- Transcripción -------------------------------------------------------

  /**
   * Transcribe la grabación con Whisper y la guarda en la fila. Corre sola al
   * llegar la grabación (webhook) y en el barrido de pendientes. Idempotente:
   * el UPDATE que la pone en 'processing' exige que no esté ya hecha ni en
   * curso, así dos disparos simultáneos no pagan Whisper dos veces.
   */
  async transcribirGrabacion(id: number, opts: { forzar?: boolean } = {}): Promise<boolean> {
    if (!S3_BUCKET) {
      console.warn('[llamadas-voz] RECORDINGS_BUCKET no configurado: no se transcribe.');
      return false;
    }
    const tomada = await postgresService.query(
      `UPDATE llamadas_voz SET transcription_status = 'processing', transcription_error = NULL, updated_at = NOW()
        WHERE id = $1 AND recording_estado = 'lista' AND recording_sid IS NOT NULL
          AND (${opts.forzar ? 'TRUE' : "transcription_status IS DISTINCT FROM 'done'"})
          AND (transcription_status IS DISTINCT FROM 'processing' OR updated_at < NOW() - INTERVAL '20 minutes')
        RETURNING recording_sid, transcription_s3_key`,
      [id]
    );
    if (!tomada || tomada.length === 0) return false;
    const recordingSid = String(tomada[0].recording_sid);
    const keyPrevia = tomada[0].transcription_s3_key as string | null;

    try {
      // El MP3 se sube a S3 porque Transcribe solo lee de ahí. Si un intento
      // anterior ya lo subió, se reusa: el job es idempotente por nombre.
      const key = keyPrevia || `${PREFIJO_AUDIO}/${recordingSid}.mp3`;
      if (!keyPrevia) {
        const mp3 = await descargarGrabacionVozComoBuffer(recordingSid);
        await this.s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: mp3,
            ContentType: 'audio/mpeg',
            Tagging: 'app=bodytech-consulta&tipo=audio-llamada',
          })
        );
        await postgresService.query(
          `UPDATE llamadas_voz SET transcription_s3_key = $2, updated_at = NOW() WHERE id = $1`,
          [id, key]
        );
      }

      const r = await transcribeService.getOrStartFromS3(
        `bodytech-llamada-${recordingSid}`,
        `s3://${S3_BUCKET}/${key}`,
        'mp3',
        { canales: CANALES }
      );
      if (r.status === 'failed') {
        await this.marcarTranscripcionError(id, r.reason || 'Transcribe rechazó el job');
        await this.borrarAudio(key);
        return false;
      }
      if (r.status === 'completed' && (r.transcript || '').trim()) {
        await this.guardarTranscripcion(id, r.transcript!.trim());
        await this.borrarAudio(key);
        return true;
      }
      // in_progress: lo termina el barrido (Transcribe tarda minutos).
      console.log(`📝 [llamadas-voz] Job de transcripción iniciado para la llamada #${id}`);
      return false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ [llamadas-voz] Transcripción de la llamada #${id} falló: ${msg}`);
      await this.marcarTranscripcionError(id, msg);
      return false;
    }
  }

  private async guardarTranscripcion(id: number, texto: string): Promise<void> {
    await postgresService.query(
      `UPDATE llamadas_voz SET transcription_status = 'done', transcription_text = $2,
              transcribed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id, texto]
    );
    console.log(`📝 [llamadas-voz] Llamada #${id} transcrita con hablantes (${texto.length} caracteres)`);
  }

  private async marcarTranscripcionError(id: number, msg: string): Promise<void> {
    await postgresService
      .query(
        `UPDATE llamadas_voz SET transcription_status = 'error', transcription_error = $2, updated_at = NOW() WHERE id = $1`,
        [id, msg.slice(0, 500)]
      )
      .catch(() => undefined);
  }

  /** El audio ya dio su texto: es dato de paciente y no se queda en S3. */
  private async borrarAudio(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch (e: unknown) {
      console.warn(`[llamadas-voz] No se pudo borrar ${key}:`, e instanceof Error ? e.message : e);
    }
  }

  /**
   * Grabaciones listas sin transcripción (webhook perdido, contenedor
   * reiniciado a mitad de Whisper, o anteriores a esta función). Las de error
   * se reintentan hasta 3 veces, contando por el texto del error.
   */
  async transcribirPendientes(limite = 10): Promise<number> {
    if (!S3_BUCKET) return 0;
    // Dos poblaciones: las que nunca arrancaron (o fallaron hace rato) y las que
    // tienen un job corriendo. Transcribe es asíncrono, así que sondear es parte
    // del trabajo normal, no una recuperación.
    const rows = await postgresService.query(
      `SELECT id, recording_sid, transcription_s3_key, transcription_status
         FROM llamadas_voz
        WHERE recording_estado = 'lista' AND recording_sid IS NOT NULL
          AND (transcription_status IS NULL
               OR transcription_status = 'processing'
               OR (transcription_status = 'error' AND updated_at < NOW() - INTERVAL '30 minutes'))
        ORDER BY id LIMIT $1`,
      [limite]
    );
    let hechas = 0;
    for (const r of rows ?? []) {
      const id = Number(r.id);
      try {
        if (r.transcription_status === 'processing' && r.transcription_s3_key) {
          // Job ya lanzado: solo preguntar cómo va.
          if (await this.sondearJob(id, String(r.recording_sid), String(r.transcription_s3_key))) {
            hechas++;
          }
        } else if (await this.transcribirGrabacion(id)) {
          hechas++;
        }
      } catch (e: unknown) {
        console.error(`[llamadas-voz] Sondeo de #${id} falló:`, e instanceof Error ? e.message : e);
      }
    }
    return hechas;
  }

  /**
   * Llamadas que nunca recibieron su cierre (contenedor reiniciado, webhook
   * perdido). Se dan por fallidas para que el coach pueda volver a llamar.
   */
  async cerrarHuerfanas(): Promise<void> {
    const terminales = ESTADOS_TERMINALES.map((e) => `'${e}'`).join(',');
    await postgresService.query(
      `UPDATE llamadas_voz
          SET estado = 'fallida', motivo_fin = COALESCE(motivo_fin, 'huerfana'),
              finalizada_at = COALESCE(finalizada_at, NOW()), updated_at = NOW()
        WHERE estado NOT IN (${terminales})
          AND iniciada_at < NOW() - INTERVAL '${MINUTOS_LLAMADA_HUERFANA} minutes'`
    );
    // Creada pero el navegador nunca se conectó (micrófono negado, pestaña
    // cerrada): no vale la pena esperar 20 min para dejar llamar de nuevo.
    await postgresService.query(
      `UPDATE llamadas_voz
          SET estado = 'fallida', motivo_fin = COALESCE(motivo_fin, 'sin_conexion_navegador'),
              finalizada_at = COALESCE(finalizada_at, NOW()), updated_at = NOW()
        WHERE estado = 'iniciando' AND iniciada_at < NOW() - INTERVAL '3 minutes'`
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
