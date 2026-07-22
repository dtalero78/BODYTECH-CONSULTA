/**
 * Pipeline principal de evaluación de calidad de consultas médicas.
 *
 * Flow de dispararEvaluacion:
 *   1. INSERT en consulta_evaluaciones con estado 'procesando'.
 *   2. Background (fire-and-forget):
 *      a. Obtener URL pre-firmada de Twilio Compositions.
 *      b. Descargar audio MP4 con auth básica + extraer buffer.
 *      c. estado='transcribiendo' → Whisper (whisper-1, es).
 *      d. estado='evaluando' → Managed Agents (evaluarConsulta).
 *      e. estado='completado' con evaluacion JSONB y puntaje_total.
 *   3. catch global → estado='error' con error_msg.
 */

import { toFile } from 'openai/uploads';
import postgresService from './postgres.service';
import twilioService from './twilio.service';
import { evaluarConsulta, EvaluacionResult } from './managed-agents-calidad.service';
import { evaluarConsultaOpenAI } from './openai-calidad.service';
import { openai } from './openai.service';
import {
  obtenerUrlMediaTwilio,
  descargarMp4ComoBuffer,
  extraerAudio,
} from './twilio-media.service';
import { chimeRecordingService } from './video/chime-recording.service';
import { transcribeService } from './video/transcribe.service';

/** Origen de la grabación de una consulta. */
type Grabacion =
  | { kind: 'twilio'; compositionSid: string }
  | { kind: 'chime'; roomName: string }
  | { kind: 'none' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** roomName más reciente vinculado a una historia (para resolver grabación Chime). */
async function roomNameForHistoria(historiaId: string): Promise<string | null> {
  const rows = await postgresService.query(
    `SELECT room_name FROM room_historia_map WHERE historia_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [historiaId]
  );
  return (rows?.[0]?.room_name as string) || null;
}

/**
 * Decide de dónde sale la grabación de una consulta:
 * - `composition_sid` presente → Twilio (flujo de composición de siempre).
 * - si no, hay fila en `chime_recordings` para la sala → Chime (MP4 en S3).
 * - si no → ninguna.
 */
async function resolverGrabacion(historiaId: string, compositionSid: string | null): Promise<Grabacion> {
  if (compositionSid) return { kind: 'twilio', compositionSid };
  const roomName = await roomNameForHistoria(historiaId);
  if (roomName) {
    const rec = await chimeRecordingService.getRecordingUrl(roomName);
    if (rec) return { kind: 'chime', roomName };
  }
  return { kind: 'none' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  found: boolean;
  compositionSid: string | null;
  patientName: string | null;
  numeroId: string | null;
  doctorName: string | null;
  empresa: string | null;
  fechaConsulta: string | null;
  fechaAtencion: string | null;
}

export interface EvaluacionRow {
  id: number;
  historia_id: string;
  transcript: string | null;
  evaluacion: EvaluacionResult | null;
  puntaje_total: number | null;
  estado: string;
  session_id: string | null;
  error_msg: string | null;
  pasos: Array<{ ts: string; texto: string }>;
  created_at: string;
  updated_at: string;
}

export interface HistorialRow {
  id: number;
  puntaje_total: number | null;
  estado: string;
  created_at: string;
  error_msg: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/** Agrega un paso al array JSONB `pasos` de la evaluación. */
async function agregarPaso(evaluacionId: number, texto: string): Promise<void> {
  const paso = { ts: new Date().toISOString(), texto };
  await postgresService.query(
    `UPDATE consulta_evaluaciones
     SET pasos = pasos || $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify([paso]), evaluacionId]
  );
}

/** Actualiza el estado de la evaluación. */
async function setEstado(
  evaluacionId: number,
  estado: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const setClauses: string[] = ['estado = $1', 'updated_at = NOW()'];
  const params: unknown[] = [estado];
  let idx = 2;

  for (const [key, value] of Object.entries(extra)) {
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  params.push(evaluacionId);

  await postgresService.query(
    `UPDATE consulta_evaluaciones SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    params as unknown[]
  );
}

/**
 * Busca el formulario pre-consulta del paciente por numero_id.
 * No rompe si la tabla no existe o no hay registro.
 */
async function buscarFormulario(
  numeroId: string | null
): Promise<Record<string, unknown> | null> {
  if (!numeroId) return null;
  try {
    const rows = await postgresService.query(
      `SELECT genero, edad, fecha_nacimiento, lugar_nacimiento, ciudad_residencia,
              estado_civil, nivel_educativo, profesion_oficio, hijos,
              estatura, peso, ejercicio, fuma, consumo_licor,
              presion_alta, problemas_azucar, problemas_cardiacos, enfermedad_higado,
              enfermedad_pulmonar, hernias, hormigueos, varices, hepatitis,
              dolor_cabeza, dolor_espalda, embarazo, usa_anteojos, usa_lentes_contacto,
              cirugia_ocular, cirugia_programada, condicion_medica, problemas_sueno,
              trastorno_psicologico, sintomas_psicologicos, diagnostico_cancer,
              enfermedades_laborales, enfermedad_osteomuscular, enfermedad_autoinmune,
              familia_diabetes, familia_hipertension, familia_infartos, familia_cancer,
              familia_trastornos, familia_infecciosas, familia_hereditarias, familia_geneticas
       FROM formularios
       WHERE numero_id = $1
       LIMIT 1`,
      [numeroId]
    );
    if (rows && rows.length > 0) return rows[0] as Record<string, unknown>;
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[calidad] No se pudo consultar formulario:', msg);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline asíncrono (fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────────

async function procesarEvaluacion(
  evaluacionId: number,
  source: Grabacion,
  historiaId: string,
  numeroId: string | null,
  medico: string | null
): Promise<void> {
  const tag = `[calidad][eval#${evaluacionId}]`;

  try {
    let transcript = '';

    // 0. Reutilizar el transcript ya generado por el pipeline de transcripción
    //    (audio client-side de la consulta). Independiente del proveedor de video
    //    (Twilio o Chime): si existe, evita re-transcribir (doble costo y latencia).
    const cached = await postgresService.query(
      `SELECT "transcription_text" FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
      [historiaId]
    );
    const cachedText = cached?.[0]?.transcription_text;

    if (typeof cachedText === 'string' && cachedText.trim().length > 0) {
      transcript = cachedText.trim();
      console.log(`${tag} Reutilizando transcript existente (${transcript.length} chars) — no re-transcribo`);
      await agregarPaso(
        evaluacionId,
        `Reutilizando transcripción de la consulta (${transcript.length} caracteres)...`
      );
      // Estado → evaluando + guardar transcript en la evaluación
      await setEstado(evaluacionId, 'evaluando', { transcript });
    } else if (source.kind === 'chime') {
      // Sin transcript guardado y grabación en Chime → Amazon Transcribe lee el
      // MP4 de S3 directo (sin ffmpeg) y separa hablantes. Es asíncrono: sondeamos.
      await setEstado(evaluacionId, 'transcribiendo');
      await agregarPaso(
        evaluacionId,
        'Transcribiendo la grabación con Amazon Transcribe (separando médico/paciente)...'
      );
      const MAX_INTENTOS = 72; // ~6 min a 5s
      let intentos = 0;
      let motivo = '';
      while (intentos < MAX_INTENTOS) {
        const r = await transcribeService.getOrStartTranscription(source.roomName);
        if (r.status === 'completed') {
          transcript = (r.transcript || '').trim();
          break;
        }
        if (r.status === 'failed') {
          motivo = r.reason || 'Transcribe falló';
          break;
        }
        // no_recording (MP4 aún concatenando) | in_progress → esperar
        await sleep(5000);
        intentos++;
      }
      if (!transcript) {
        await setEstado(evaluacionId, 'error', {
          error_msg: motivo || 'La transcripción no terminó a tiempo. Intenta de nuevo en un momento.',
        });
        return;
      }
      console.log(`${tag} Transcript de Transcribe (${transcript.length} chars)`);
      await agregarPaso(
        evaluacionId,
        `Transcripción completada (${transcript.length} caracteres). Enviando al agente de IA...`
      );
      await setEstado(evaluacionId, 'evaluando', { transcript });
    } else if (source.kind === 'twilio') {
      // 1. Obtener URL pre-firmada de Twilio
      await agregarPaso(evaluacionId, 'Solicitando URL de la grabación a Twilio...');
      console.log(`${tag} Resolviendo URL del MP4 (composition ${source.compositionSid})...`);
      const mp4Url = await obtenerUrlMediaTwilio(source.compositionSid);
      await agregarPaso(evaluacionId, 'URL obtenida. Descargando grabación...');

      // 2. Descargar MP4 como buffer (sin disco)
      console.log(`${tag} Descargando MP4...`);
      const mp4Buffer = await descargarMp4ComoBuffer(mp4Url);
      const mbVideo = (mp4Buffer.byteLength / (1024 * 1024)).toFixed(2);
      console.log(`${tag} MP4 en buffer: ${mbVideo} MB`);
      await agregarPaso(evaluacionId, `Grabación descargada (${mbVideo} MB). Extrayendo audio...`);

      // 3. Estado → transcribiendo
      await setEstado(evaluacionId, 'transcribiendo');

      // 3b. Extraer solo el audio con ffmpeg (evita el límite de 25 MB de Whisper)
      console.log(`${tag} Extrayendo audio con ffmpeg...`);
      const audioBuffer = await extraerAudio(mp4Buffer);
      const mbAudio = (audioBuffer.byteLength / (1024 * 1024)).toFixed(2);
      console.log(`${tag} Audio extraído: ${mbAudio} MB`);
      await agregarPaso(evaluacionId, `Audio extraído (${mbAudio} MB). Transcribiendo con Whisper...`);

      // 4. Whisper
      console.log(`${tag} Transcribiendo con Whisper (es)...`);
      const audioFile = await toFile(audioBuffer, 'recording.mp3', { type: 'audio/mpeg' });
      const whisperResp = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'es',
      });
      transcript = (whisperResp as { text?: string }).text?.trim() ?? '';
      console.log(`${tag} Transcript (${transcript.length} chars)`);

      if (!transcript) {
        await setEstado(evaluacionId, 'error', {
          error_msg: 'Whisper devolvió transcript vacío',
        });
        return;
      }

      await agregarPaso(
        evaluacionId,
        `Transcripción completada (${transcript.length} caracteres). Enviando al agente de IA...`
      );

      // 5. Estado → evaluando + guardar transcript
      await setEstado(evaluacionId, 'evaluando', { transcript });
    }

    // Guarda: sin transcript no hay nada que evaluar (p. ej. sin grabación ni
    // transcripción previa). dispararEvaluacion ya lo bloquea antes, pero por si
    // acaso no llamamos al agente con texto vacío.
    if (!transcript) {
      await setEstado(evaluacionId, 'error', {
        error_msg: 'No hay grabación ni transcripción disponible para evaluar esta consulta.',
      });
      return;
    }

    // 6. Formulario pre-consulta para contexto del agente
    const formulario = await buscarFormulario(numeroId);
    if (formulario) {
      console.log(`${tag} Formulario pre-consulta encontrado para historia ${historiaId}`);
    }

    // 7. Evaluador: Anthropic Managed Agents (default) u OpenAI (fallback).
    // Toggleable con CALIDAD_EVALUATOR=openai mientras el cap de Anthropic
    // esté bloqueado. Mismo contrato y schema de resultado en ambos.
    const evaluator = (process.env.CALIDAD_EVALUATOR ?? 'anthropic').toLowerCase();
    const usarOpenAI = evaluator === 'openai';
    console.log(`${tag} Llamando a ${usarOpenAI ? 'OpenAI (gpt-4o-mini)' : 'Anthropic Managed Agents'}...`);
    await agregarPaso(
      evaluacionId,
      `Sesión iniciada con ${usarOpenAI ? 'OpenAI' : 'Anthropic'}. Esperando respuesta...`,
    );

    const runEvaluator = usarOpenAI ? evaluarConsultaOpenAI : evaluarConsulta;
    const { sessionId, evaluacion } = await runEvaluator(transcript, formulario, medico, {
      onProgreso: (texto) => agregarPaso(evaluacionId, texto),
    });
    await agregarPaso(evaluacionId, 'Evaluación completada. Guardando resultados...');

    // Guard de tipo sobre puntaje_total
    let puntaje: number | null = null;
    if (
      evaluacion &&
      typeof evaluacion.puntaje_total === 'number' &&
      Number.isFinite(evaluacion.puntaje_total)
    ) {
      puntaje = evaluacion.puntaje_total;
    } else if (evaluacion && evaluacion.puntaje_total != null) {
      const n = Number(evaluacion.puntaje_total);
      if (Number.isFinite(n)) puntaje = n;
    }

    // 8. Estado → completado
    await setEstado(evaluacionId, 'completado', {
      evaluacion: JSON.stringify(evaluacion),
      puntaje_total: puntaje,
      session_id: sessionId,
    });
    console.log(`${tag} Evaluacion completada (puntaje ${puntaje}, session ${sessionId})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Error:`, msg);
    try {
      await setEstado(evaluacionId, 'error', {
        error_msg: msg.slice(0, 5000),
      });
    } catch (dbErr: unknown) {
      const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error(`${tag} no se pudo persistir el error en DB:`, dbMsg);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública del servicio
// ─────────────────────────────────────────────────────────────────────────────

class CalidadService {
  /**
   * Obtiene los datos de sesión de una historia clínica:
   * información del paciente + compositionSid (si existe grabación).
   */
  async getSession(historiaId: string): Promise<SessionInfo> {
    const rows = await postgresService.query(
      `SELECT "_id", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
              "numeroId", "empresa", "fechaConsulta", "fechaAtencion",
              "medico", composition_sid
       FROM "HistoriaClinica"
       WHERE "_id" = $1
       LIMIT 1`,
      [historiaId]
    );

    if (!rows || rows.length === 0) {
      return {
        found: false,
        compositionSid: null,
        patientName: null,
        numeroId: null,
        doctorName: null,
        empresa: null,
        fechaConsulta: null,
        fechaAtencion: null,
      };
    }

    const hc = rows[0] as Record<string, unknown>;
    const patientName =
      [hc.primerNombre, hc.segundoNombre, hc.primerApellido, hc.segundoApellido]
        .filter(Boolean)
        .join(' ')
        .trim() || null;

    return {
      found: true,
      compositionSid: (hc.composition_sid as string | null) || null,
      patientName,
      numeroId: (hc.numeroId as string | null) || null,
      doctorName: (hc.medico as string | null) || null,
      empresa: (hc.empresa as string | null) || null,
      fechaConsulta: (hc.fechaConsulta as string | null) || null,
      fechaAtencion: (hc.fechaAtencion as string | null) || null,
    };
  }

  /**
   * Genera URL pre-firmada del MP4 de Twilio para una composición dada.
   * El frontend puede usarla para reproducir el video directamente.
   */
  async getVideoUrl(compositionSid: string): Promise<string> {
    return obtenerUrlMediaTwilio(compositionSid);
  }

  /**
   * Composición ON-DEMAND. Las composiciones ya NO se crean automáticamente al
   * cerrar la llamada (eso costaba componer TODAS las llamadas aunque casi
   * ninguna se evalúe). En cambio, se crean acá, la primera vez que se abre
   * Calidad para una historia.
   *
   * Idempotente: si la historia ya tiene `composition_sid`, o el room ya tiene
   * una composición en Twilio, se reutiliza. Devuelve el sid y su estado actual
   * (`enqueued` → `processing` → `completed`); el frontend hace polling hasta
   * `completed` para reproducir/evaluar.
   *
   * Nota: la grabación por participante SÍ se sigue creando en cada llamada
   * (la transcripción depende de ella), así que las grabaciones existen para
   * componer bajo demanda.
   */
  async ensureComposition(historiaId: string): Promise<{
    recordingKind: 'twilio' | 'chime' | null;
    status: string;
    videoUrl: string | null;
    compositionSid: string | null;
  }> {
    // 1) ¿la historia ya tiene composición Twilio? → estado + URL si está lista.
    const session = await this.getSession(historiaId);
    if (!session.found) {
      throw Object.assign(new Error('Historia clínica no encontrada'), { statusCode: 404 });
    }
    if (session.compositionSid) {
      const status = await twilioService.getCompositionStatus(session.compositionSid);
      const videoUrl = status === 'completed' ? await this.getVideoUrl(session.compositionSid) : null;
      return { recordingKind: 'twilio', status, videoUrl, compositionSid: session.compositionSid };
    }

    // 1-bis) ¿grabación en Chime (MP4 en S3)? → servir el link firmado, sin
    // composición Twilio. El estado refleja la concatenación: processing → completed.
    const roomNameChime = await roomNameForHistoria(historiaId);
    if (roomNameChime) {
      const rec = await chimeRecordingService.getRecordingUrl(roomNameChime);
      if (rec) {
        if (rec.status === 'ready' && rec.url) {
          return { recordingKind: 'chime', status: 'completed', videoUrl: rec.url, compositionSid: null };
        }
        if (rec.status === 'error') {
          return { recordingKind: 'chime', status: 'failed', videoUrl: null, compositionSid: null };
        }
        return { recordingKind: 'chime', status: 'processing', videoUrl: null, compositionSid: null };
      }
    }

    // 2) Twilio legacy on-demand: rooms Twilio sin composición todavía.
    const rows = await postgresService.query(
      `SELECT room_name, room_sid FROM room_historia_map WHERE historia_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [historiaId]
    );
    const row = rows?.[0] as { room_name?: string; room_sid?: string } | undefined;
    if (!row || (!row.room_name && !row.room_sid)) {
      throw Object.assign(
        new Error('Esta historia no tiene una sala de video asociada (no se puede generar el video).'),
        { statusCode: 409 }
      );
    }

    // Preferir el room_sid guardado: un room COMPLETADO no se resuelve por nombre
    // (Twilio 404). Si falta (filas viejas), intentar por nombre — solo funciona
    // si la sala aún está activa.
    let roomSid = row.room_sid || '';
    if (!roomSid) {
      try {
        roomSid = await twilioService.getRoomSidByName(row.room_name as string);
      } catch {
        throw Object.assign(
          new Error('No se pudo generar el video: la sala de esta consulta ya finalizó y no quedó registrada.'),
          { statusCode: 409 }
        );
      }
    }

    // 3) Reutilizar si el room ya tiene composición; si no, crearla.
    let compositionSid = await twilioService.getLatestCompositionSid(roomSid);
    if (!compositionSid) {
      const comp = await twilioService.createComposition(roomSid);
      compositionSid = comp.sid;
    }

    // 4) Guardar el sid en la historia para no volver a crearla.
    await postgresService.query(
      `UPDATE "HistoriaClinica" SET "composition_sid" = $1 WHERE "_id" = $2`,
      [compositionSid, historiaId]
    );

    const status = await twilioService.getCompositionStatus(compositionSid);
    const videoUrl = status === 'completed' ? await this.getVideoUrl(compositionSid) : null;
    return { recordingKind: 'twilio', status, videoUrl, compositionSid };
  }

  /**
   * Crea una fila de evaluación en estado 'procesando' y dispara el
   * pipeline en background. Retorna el id de la evaluación creada.
   */
  async dispararEvaluacion(historiaId: string): Promise<number> {
    const session = await this.getSession(historiaId);

    if (!session.found) {
      throw Object.assign(new Error('Historia clínica no encontrada'), { statusCode: 404 });
    }

    // Resolver el origen de la grabación (Twilio composición vs Chime S3). Ya no
    // exigimos composition_sid: una consulta Chime no tiene composición, pero sí
    // grabación en S3 (o un transcript del navegador). Se puede evaluar mientras
    // exista un transcript o una grabación de la que sacarlo.
    const source = await resolverGrabacion(historiaId, session.compositionSid);
    if (source.kind === 'none') {
      const cached = await postgresService.query(
        `SELECT "transcription_text" FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
        [historiaId]
      );
      const hasTranscript =
        typeof cached?.[0]?.transcription_text === 'string' &&
        cached[0].transcription_text.trim().length > 0;
      if (!hasTranscript) {
        throw Object.assign(
          new Error('Esta consulta no tiene grabación ni transcripción para evaluar.'),
          { statusCode: 409 }
        );
      }
    }

    // INSERT → retornar id
    const rows = await postgresService.query(
      `INSERT INTO consulta_evaluaciones
         (historia_id, estado, pasos)
       VALUES ($1, 'procesando', '[]'::jsonb)
       RETURNING id`,
      [historiaId]
    );

    if (!rows || rows.length === 0) {
      throw new Error('Error creando fila de evaluación en la base de datos');
    }

    const evaluacionId: number = (rows[0] as { id: number }).id;

    // Fire-and-forget — el catch evita unhandledRejection
    procesarEvaluacion(
      evaluacionId,
      source,
      historiaId,
      session.numeroId,
      session.doctorName
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[calidad][eval#${evaluacionId}] procesamiento async falló:`, msg);
    });

    return evaluacionId;
  }

  /** Obtiene una evaluación por id. */
  async getEvaluacion(id: number): Promise<EvaluacionRow | null> {
    const rows = await postgresService.query(
      `SELECT id, historia_id, transcript, evaluacion, puntaje_total,
              estado, session_id, error_msg, pasos, created_at, updated_at
       FROM consulta_evaluaciones
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    return rows[0] as EvaluacionRow;
  }

  /** Lista el historial de evaluaciones de una historia clínica, más recientes primero. */
  async getHistorial(historiaId: string): Promise<HistorialRow[]> {
    const rows = await postgresService.query(
      `SELECT id, puntaje_total, estado, created_at, error_msg
       FROM consulta_evaluaciones
       WHERE historia_id = $1
       ORDER BY created_at DESC`,
      [historiaId]
    );
    return (rows || []) as HistorialRow[];
  }
}

export default new CalidadService();
