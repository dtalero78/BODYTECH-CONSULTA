import axios from 'axios';
import { toFile } from 'openai/uploads';
import postgresService from './postgres.service';
import medicalHistoryService, { EDITABLE_FIELDS } from './medical-history.service';
import { openai } from './openai.service';
import {
  obtenerUrlMediaTwilio,
  descargarMp4ComoBuffer,
  extraerAudio,
} from './twilio-media.service';

/**
 * Phase 3 — Pipeline de transcripción post-llamada.
 *
 * Flujo:
 *   1. linkRoomToHistoria(roomName, historiaId)         → al iniciar la sesión.
 *   2. Twilio graba (recordParticipantsOnConnect=true).
 *   3. Webhook recording-ready dispara processRecording(...).
 *   4. processRecording: download audio → Whisper → GPT-4o-mini → 11 PATCH.
 *   5. transcription_status pasa por: pending → processing → done | error.
 *
 * IMPORTANTE: todas las escrituras a HistoriaClinica pasan por
 * `medicalHistoryService.updateField`. NO se construye SQL ni se llama
 * `pg.query` directo para los 11 campos target ni para el status.
 */

// Claves que GPT-4o-mini puede devolver. El llamador filtra contra
// EDITABLE_FIELDS antes de despachar al updateField.
const TRANSCRIPTION_TARGET_FIELDS = [
  'motivo_consulta_texto',
  'ant_patologico_obs',
  'ant_farmacologico_obs',
  'ant_alergicos_obs',
  'hallazgos_descripcion',
  'hallazgos_dolor',
  'cc_peso_nuevo',
  'cc_estatura_nuevo',
  'tas',
  'tad',
  'fcr',
] as const;

type TranscriptionTargetField = (typeof TRANSCRIPTION_TARGET_FIELDS)[number];

const TARGET_FIELDS_SET = new Set<string>(TRANSCRIPTION_TARGET_FIELDS);

const EXTRACTION_PROMPT = `
Eres un asistente clínico que extrae datos estructurados a partir de la
transcripción de una consulta médica de fisiatría / medicina deportiva en
español. Recibes el texto íntegro de la consulta entre el médico y el
paciente.

Devuelve EXCLUSIVAMENTE un objeto JSON con SOLO las claves cuyo valor esté
mencionado de manera explícita e inequívoca en el transcript. NO inventes,
NO completes con valores plausibles, NO infieras de contexto general. Si
dudas, OMITE la clave.

Claves permitidas (incluye sólo las que apliquen):
  - motivo_consulta_texto (string, español neutro)
  - ant_patologico_obs (string)
  - ant_farmacologico_obs (string)
  - ant_alergicos_obs (string)
  - hallazgos_descripcion (string)
  - hallazgos_dolor (string)
  - cc_peso_nuevo (number, en kg)
  - cc_estatura_nuevo (number, en cm)
  - tas (number, mmHg sistólica)
  - tad (number, mmHg diastólica)
  - fcr (number, lpm en reposo)

Reglas:
  - Los números deben ir como números nativos JSON (no strings).
  - Si el médico menciona el peso en libras, conviértelo a kg.
  - Si la estatura está en metros, conviértela a cm (ej: 1.73 m → 173).
  - Si el médico no menciona explícitamente un valor, NO incluyas la clave.
  - Las descripciones deben ser concisas, en español neutro y en tercera
    persona (ej: "Refiere dolor lumbar de 3 semanas de evolución").

Devuelve únicamente el JSON, sin texto adicional.
`.trim();

interface TwilioCredentials {
  sid: string;
  token: string;
}

function getTwilioCreds(): TwilioCredentials | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.error('[Transcription] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN no están configurados');
    return null;
  }
  return { sid, token };
}

class TranscriptionService {
  /**
   * Vincula un roomName con la historia clínica activa. Idempotente.
   * Marca la historia con transcription_status = 'pending'.
   */
  async linkRoomToHistoria(roomName: string, historiaId: string): Promise<void> {
    if (!roomName || !historiaId) {
      console.warn('[Transcription] linkRoomToHistoria: roomName/historiaId vacíos');
      return;
    }

    try {
      await postgresService.query(
        `INSERT INTO room_historia_map (room_name, historia_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (room_name)
         DO UPDATE SET historia_id = EXCLUDED.historia_id, created_at = NOW()`,
        [roomName, historiaId]
      );
      console.log(`[Transcription] Room linked: ${roomName} → ${historiaId}`);

      const r = await medicalHistoryService.updateField(historiaId, 'transcription_status', 'pending');
      if (!r.success) {
        console.warn(
          `[Transcription] No pude marcar status=pending en ${historiaId}: ${r.error}`
        );
      }
    } catch (e: any) {
      console.error('[Transcription] Error en linkRoomToHistoria:', e?.message || e);
    }
  }

  /**
   * Devuelve el historiaId vinculado a un roomName, o null si no hay vínculo.
   */
  async getHistoriaIdForRoom(roomName: string): Promise<string | null> {
    if (!roomName) return null;
    const rows = await postgresService.query(
      'SELECT historia_id FROM room_historia_map WHERE room_name = $1 LIMIT 1',
      [roomName]
    );
    if (!rows || rows.length === 0) return null;
    return rows[0].historia_id ?? null;
  }

  /**
   * Pipeline completo del recording. Nunca lanza al caller.
   *
   * - Resuelve historiaId. Si no hay → log + abort.
   * - status=processing → download → Whisper → guardar texto → GPT-4o-mini.
   * - PATCH por field reutilizando medicalHistoryService.updateField.
   * - status=done o status=error según corresponda.
   */
  async processRecording(
    roomName: string,
    recordingSid: string,
    mediaUrl: string
  ): Promise<void> {
    const t0 = Date.now();
    let historiaId: string | null = null;

    try {
      console.log(
        `[Transcription] processRecording start room=${roomName} sid=${recordingSid}`
      );

      historiaId = await this.getHistoriaIdForRoom(roomName);
      if (!historiaId) {
        console.warn(
          `[Transcription] No hay historia vinculada al room ${roomName}, abortando.`
        );
        return;
      }

      const creds = getTwilioCreds();
      if (!creds) {
        await this.markStatus(historiaId, 'error');
        return;
      }

      // 1) Marcar processing
      await this.markStatus(historiaId, 'processing');

      // 2) Descargar audio de Twilio
      console.log(`[Transcription] Descargando audio de ${mediaUrl}`);
      const audioResp = await axios.get<ArrayBuffer>(mediaUrl, {
        responseType: 'arraybuffer',
        auth: { username: creds.sid, password: creds.token },
        // Twilio puede redirigir al CDN de S3 con un signed URL; axios sigue el redirect
        // y la auth básica solo aplica al primer request, lo que es lo correcto.
        maxRedirects: 5,
        timeout: 60_000,
      });
      const audioBuf = Buffer.from(audioResp.data as ArrayBuffer);
      console.log(`[Transcription] Audio descargado: ${audioBuf.byteLength} bytes`);

      if (audioBuf.byteLength === 0) {
        console.error('[Transcription] Audio descargado tiene 0 bytes');
        await this.markStatus(historiaId, 'error');
        return;
      }

      // 3-6) Pipeline común: Whisper → guardar transcript → GPT-4o-mini → PATCH.
      await this.runWhisperPipeline(historiaId, audioBuf, 'recording.mp3', t0);
      return;
    } catch (err: any) {
      console.error(
        '[Transcription] Pipeline error:',
        err?.message || err,
        err?.stack
      );
      if (historiaId) {
        await this.markStatus(historiaId, 'error').catch(() => {
          /* swallow */
        });
      }
    }
  }

  /**
   * Pipeline trigger desde el webhook `composition-status` cuando el
   * status='completed'. Esta es la entry point preferida: 1 trigger por
   * llamada (no 4 por participante), audio ya mixeado y de mejor calidad.
   *
   * - Resuelve mediaUrl del composition via Twilio.
   * - Descarga el MP4 (puede ser >25 MB).
   * - Extrae audio MP3 mono 16 kHz con ffmpeg (~2-5 MB).
   * - Reutiliza la misma pipeline Whisper → GPT-4o-mini → PATCH.
   *
   * Nunca lanza al caller (mismo contrato que processRecording).
   */
  async processComposition(historiaId: string, compositionSid: string): Promise<void> {
    const t0 = Date.now();
    if (!historiaId || !compositionSid) {
      console.warn(
        `[Transcription] processComposition: historiaId/compositionSid vacíos (h=${historiaId} c=${compositionSid})`
      );
      return;
    }

    try {
      console.log(
        `[Transcription] processComposition start historia=${historiaId} composition=${compositionSid}`
      );

      // 1) Marcar processing antes de cualquier I/O largo.
      await this.markStatus(historiaId, 'processing');

      // 2) Resolver URL pre-firmada del MP4
      const mp4Url = await obtenerUrlMediaTwilio(compositionSid);
      console.log(`[Transcription] Composition MP4 URL resuelta (TTL 1h)`);

      // 3) Descargar MP4 a buffer
      const mp4Buffer = await descargarMp4ComoBuffer(mp4Url);
      console.log(
        `[Transcription] MP4 descargado: ${(mp4Buffer.byteLength / 1024 / 1024).toFixed(1)} MB`
      );
      if (mp4Buffer.byteLength === 0) {
        console.error('[Transcription] MP4 descargado tiene 0 bytes');
        await this.markStatus(historiaId, 'error');
        return;
      }

      // 4) Extraer audio MP3 mono 16 kHz con ffmpeg para encajar en Whisper (<25 MB)
      const audioBuf = await extraerAudio(mp4Buffer);
      console.log(
        `[Transcription] Audio extraído: ${(audioBuf.byteLength / 1024 / 1024).toFixed(2)} MB`
      );

      // 5-7) Pipeline común
      await this.runWhisperPipeline(historiaId, audioBuf, 'composition.mp3', t0);
    } catch (err: any) {
      console.error(
        '[Transcription] processComposition error:',
        err?.message || err,
        err?.stack
      );
      await this.markStatus(historiaId, 'error').catch(() => {
        /* swallow */
      });
    }
  }

  /**
   * Pipeline interno compartido entre processRecording y processComposition.
   * Recibe el audio ya descargado y se encarga de:
   *   - Whisper
   *   - Persistir transcript completo en transcription_text
   *   - GPT-4o-mini → JSON estructurado
   *   - PATCH a los 11 campos via medicalHistoryService.updateField
   *   - Marcar status done|error
   *
   * Captura sus propios errores y los persiste en status='error'.
   */
  private async runWhisperPipeline(
    historiaId: string,
    audioBuf: Buffer,
    audioFileName: string,
    t0: number
  ): Promise<void> {
    try {
      // 1) Whisper
      const audioFile = await toFile(audioBuf, audioFileName, {
        type: 'audio/mpeg',
      });

      const whisperResp = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'es',
      });
      const transcript = (whisperResp as any)?.text?.trim?.() ?? '';
      console.log(`[Transcription] Whisper OK, ${transcript.length} chars`);

      if (!transcript) {
        console.error('[Transcription] Whisper devolvió transcript vacío');
        await this.markStatus(historiaId, 'error');
        return;
      }

      // 2) Persistir transcript completo
      await medicalHistoryService.updateField(historiaId, 'transcription_text', transcript);

      // 3) GPT-4o-mini → JSON estructurado
      const gptResp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          {
            role: 'user',
            content: `Transcripción de la consulta:\n\n${transcript}`,
          },
        ],
      });
      const raw = gptResp.choices?.[0]?.message?.content?.trim() || '';
      console.log(`[Transcription] GPT response chars=${raw.length}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.error('[Transcription] No pude parsear JSON de GPT:', e);
        await this.markStatus(historiaId, 'error');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.error('[Transcription] GPT no devolvió un objeto plano');
        await this.markStatus(historiaId, 'error');
        return;
      }

      // 4) Aplicar PATCH por field reutilizando updateField
      const obj = parsed as Record<string, unknown>;
      const keys = Object.keys(obj);
      console.log(`[Transcription] GPT keys: [${keys.join(', ')}]`);

      let applied = 0;
      let skipped = 0;
      let attempted = 0;
      for (const key of keys) {
        if (!TARGET_FIELDS_SET.has(key)) {
          console.warn(`[Transcription] Clave ignorada (no permitida): ${key}`);
          skipped++;
          continue;
        }
        if (!EDITABLE_FIELDS.includes(key)) {
          console.warn(`[Transcription] Clave ignorada (no en EDITABLE_FIELDS): ${key}`);
          skipped++;
          continue;
        }
        attempted++;
        const value = obj[key];
        // try/catch por campo: si uno lanza/falla, los demás siguen.
        try {
          const r = await medicalHistoryService.updateField(historiaId, key as TranscriptionTargetField, value);
          if (r.success) {
            applied++;
          } else {
            console.warn(
              `[Transcription] updateField falló key=${key} value=${JSON.stringify(value)} err=${r.error}`
            );
            skipped++;
          }
        } catch (perFieldErr: any) {
          console.error(
            `[Transcription] updateField lanzó key=${key} err=${perFieldErr?.message || perFieldErr}`
          );
          skipped++;
        }
      }
      console.log(
        `[Transcription] PATCH completados: ${applied} OK / ${skipped} skip (intentados=${attempted})`
      );

      // 6) Status final:
      //   - 'done'  si al menos un campo se aplicó OK, o si GPT no devolvió ninguna
      //     clave aplicable (transcript persistido pero sin extracciones — esperado).
      //   - 'error' si se intentó persistir N>0 campos y TODOS fallaron.
      const finalStatus: 'done' | 'error' =
        attempted > 0 && applied === 0 ? 'error' : 'done';
      await this.markStatus(historiaId, finalStatus);
      console.log(
        `[Transcription] ${finalStatus.toUpperCase()} historia=${historiaId} ms=${Date.now() - t0}`
      );
    } catch (err: any) {
      console.error(
        '[Transcription] Pipeline error:',
        err?.message || err,
        err?.stack
      );
      if (historiaId) {
        await this.markStatus(historiaId, 'error').catch(() => {
          /* swallow */
        });
      }
    }
  }

  /**
   * Wrapper para escribir el status. Usa updateField para mantener el path único
   * (whitelist + auditoría).
   */
  private async markStatus(
    historiaId: string,
    status: 'pending' | 'processing' | 'done' | 'error'
  ): Promise<void> {
    const r = await medicalHistoryService.updateField(
      historiaId,
      'transcription_status',
      status
    );
    if (!r.success) {
      console.warn(
        `[Transcription] markStatus(${status}) falló para ${historiaId}: ${r.error}`
      );
    }
  }
}

export default new TranscriptionService();
