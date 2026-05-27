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
import { evaluarConsulta, EvaluacionResult } from './managed-agents-calidad.service';
import { evaluarConsultaOpenAI } from './openai-calidad.service';
import { openai } from './openai.service';
import {
  obtenerUrlMediaTwilio,
  descargarMp4ComoBuffer,
  extraerAudio,
} from './twilio-media.service';

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
  compositionSid: string,
  historiaId: string,
  numeroId: string | null,
  medico: string | null
): Promise<void> {
  const tag = `[calidad][eval#${evaluacionId}]`;

  try {
    // 1. Obtener URL pre-firmada de Twilio
    await agregarPaso(evaluacionId, 'Solicitando URL de la grabación a Twilio...');
    console.log(`${tag} Resolviendo URL del MP4 (composition ${compositionSid})...`);
    const mp4Url = await obtenerUrlMediaTwilio(compositionSid);
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
    const transcript = (whisperResp as { text?: string }).text?.trim() ?? '';
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
   * Crea una fila de evaluación en estado 'procesando' y dispara el
   * pipeline en background. Retorna el id de la evaluación creada.
   */
  async dispararEvaluacion(historiaId: string): Promise<number> {
    const session = await this.getSession(historiaId);

    if (!session.found) {
      throw Object.assign(new Error('Historia clínica no encontrada'), { statusCode: 404 });
    }

    if (!session.compositionSid) {
      throw Object.assign(
        new Error('La historia clínica no tiene grabación asociada (composition_sid).'),
        { statusCode: 409 }
      );
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
      session.compositionSid,
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
