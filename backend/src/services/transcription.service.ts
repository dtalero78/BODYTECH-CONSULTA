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
Eres un asistente clínico que sintetiza una historia clínica a partir de la
transcripción completa de una consulta médica de fisiatría / medicina
deportiva en español. Recibes el texto íntegro de la conversación entre el
médico y el paciente.

OBJETIVO: leer toda la conversación como un todo y diligenciar los campos
clínicos como lo haría un médico que resume la consulta. NO te limites a
copiar frases literales — interpretá, integrá y parafraseá en lenguaje
clínico neutro en tercera persona.

Devuelve un objeto JSON con tantas claves como puedas justificar a partir
de la conversación. Para cada clave que incluyas, en algún punto de la
transcripción debe haber tratado el tema (aunque no se haya usado la
misma palabra). Si el tema nunca apareció en la conversación, omitilo.

Claves permitidas:
  - motivo_consulta_texto (string): por qué consulta el paciente, en una o
    dos oraciones. Sintetizá del intercambio inicial, no copies textual.
  - ant_patologico_obs (string): antecedentes patológicos personales
    (enfermedades previas, cirugías, traumas, condiciones crónicas).
    Integralos en una redacción coherente; si el paciente dice "me operaron
    la nariz cuando era chica y me fracturé el brazo izquierdo a los 10",
    escribilo como "Refiere cirugía nasal en la infancia y fractura
    de miembro superior izquierdo a los 10 años."
  - ant_farmacologico_obs (string): medicamentos que toma habitualmente,
    incluyendo dosis/frecuencia si se mencionan. Si dice "no tomo nada"
    escribí "No refiere consumo de medicamentos."
  - ant_alergicos_obs (string): alergias conocidas. Si dice "no soy alérgico
    a nada" → "No refiere alergias conocidas."
  - hallazgos_descripcion (string): hallazgos clínicos relevantes del examen
    físico, observaciones del médico o resumen de signos. Puede ser
    inferido del intercambio (ej: si el médico evaluó postura, marcha o
    rango de movimiento durante la consulta).
  - hallazgos_dolor (string): descripción del dolor del paciente (zona,
    tipo, tiempo de evolución, irradiación, factores que lo aumentan o
    alivian). Integrá toda la información dispersa en la conversación
    sobre dolor en un único párrafo.
  - cc_peso_nuevo (number, kg): SOLO si el peso fue mencionado con un
    número explícito. No inferir.
  - cc_estatura_nuevo (number, cm): SOLO si la estatura fue mencionada con
    un número explícito. Convertir m→cm si es necesario.
  - tas (number, mmHg sistólica): SOLO si se midió y se dijo el valor.
  - tad (number, mmHg diastólica): SOLO si se midió y se dijo el valor.
  - fcr (number, lpm): SOLO si la frecuencia cardíaca se midió y se dijo.

REGLAS DURAS:
  1. Para los 5 campos numéricos (peso, estatura, tas, tad, fcr): SOLO
     incluir si el valor está explícito en el transcript. NUNCA inferir
     números de contexto general ("se ve delgada" no es peso).
  2. Para los campos texto: SI hay material en el transcript sobre ese
     tema, sintetizarlo en clínico tercera persona. SI el tema no apareció
     en la conversación, omitir la clave.
  3. Números como nativos JSON (no strings). Peso en kg, estatura en cm.
     Si el médico dice "pesa 110 libras" → 49.9 kg. Si dice "mide 1.65 m"
     → 165 cm.
  4. Texto en español neutro, tercera persona, lenguaje clínico conciso.
     Evitá los marcadores conversacionales ("dijo que", "menciona que",
     "según refiere") salvo cuando agreguen valor informativo.
  5. NO inventes diagnósticos, conductas, ni recomendaciones que el médico
     no haya abordado. Si la conversación no menciona dolor, omitir
     hallazgos_dolor.

Devuelve únicamente el JSON, sin texto adicional ni markdown.
`.trim();

// ── Variante NUTRICIONAL ────────────────────────────────────────────────────
// El panel nutricional (MedicalHistoryPanel) guarda en el JSONB
// `datosNutricionales` (no en columnas). Estas claves coinciden con el guion de
// GuidedNutricion. La transcripción las autollena (solo las que queden vacías,
// sin pisar lo que el coach ya escribió).
const NUTRICION_DATOS_KEYS = [
  'motivoConsultaTexto', 'objetivoPrincipal', 'objetivosEspecificos',
  'descripcionEnfermedad', 'medicamentosActuales', 'alergias', 'cirugias', 'hospitalizaciones',
  'realizaActividadFisica', 'frecuenciaEjercicio', 'tipoEntrenamiento', 'intensidadPercibida', 'horarioEjercicio',
  'horasSueno', 'calidadSueno', 'nivelEstres',
  'numComidasDia', 'consumoAgua', 'horariosComida', 'suplementos', 'cambiosPesoRecientes',
  'consumoAlcohol', 'frecuenciaAlcohol', 'recordatorio24h',
  'anamnesisDesayuno', 'anamnesisMediaManana', 'anamnesisAlmuerzo', 'anamnesisMediaTarde', 'anamnesisCena', 'anamnesisFinSemana',
  'alimentosPreferidos', 'alimentosRechazados', 'preferenciasAlimentarias', 'alergiasAlimentarias', 'intoleranciasAlimentarias',
  'signosClinicos', 'problemasDigestivos', 'masticacionDeglucion',
  'pesoHabitual', 'porcentajeGrasa', 'masaMuscular', 'circunferenciaCintura', 'circunferenciaCadera',
] as const;
const NUTRICION_DATOS_SET = new Set<string>(NUTRICION_DATOS_KEYS);
// Columnas top-level (en EDITABLE_FIELDS) que también extraemos en la variante nutricional.
const NUTRICION_COLUMN_KEYS = ['peso', 'talla'] as const;

const NUTRICION_EXTRACTION_PROMPT = `
Eres un asistente de nutrición que sintetiza la anamnesis nutricional a partir de
la transcripción completa de una consulta (coach + afiliado) en español.

OBJETIVO: leer toda la conversación y diligenciar SOLO los campos sobre los que
se haya hablado. Parafrasea en lenguaje claro y en tercera persona. Si un tema no
apareció, OMITÍ la clave.

Devuelve un objeto JSON con valores string. Claves permitidas:

Motivo/objetivo:
  - motivoConsultaTexto (string)
  - objetivoPrincipal: exactamente uno de ["Pérdida de grasa","Ganancia de masa muscular","Rendimiento deportivo","Salud general","Otro"]
  - objetivosEspecificos (string)

Antecedentes:
  - descripcionEnfermedad, medicamentosActuales, alergias, cirugias, hospitalizaciones (strings)

Actividad física:
  - realizaActividadFisica: "Sí" o "No"
  - frecuenciaEjercicio (string: veces por semana)
  - tipoEntrenamiento: uno de ["Fuerza","Cardio","Mixto","Otro"]
  - intensidadPercibida: uno de ["Baja","Media","Alta"]
  - horarioEjercicio: uno de ["AM","PM","Mixto"]

Estilo de vida:
  - horasSueno (string)
  - calidadSueno: uno de ["Buena","Regular","Mala"]
  - nivelEstres: uno de ["Bajo","Medio","Alto"]

Hábitos alimentarios:
  - numComidasDia, consumoAgua, horariosComida, suplementos, cambiosPesoRecientes (strings)
  - consumoAlcohol: "Sí" o "No"
  - frecuenciaAlcohol (string)
  - recordatorio24h (string: lo consumido en las últimas 24 h)

Patrón alimentario habitual:
  - anamnesisDesayuno, anamnesisMediaManana, anamnesisAlmuerzo, anamnesisMediaTarde, anamnesisCena, anamnesisFinSemana (strings)

Preferencias:
  - alimentosPreferidos, alimentosRechazados, preferenciasAlimentarias, alergiasAlimentarias, intoleranciasAlimentarias (strings)

Signos clínicos:
  - signosClinicos, problemasDigestivos, masticacionDeglucion (strings)

Medidas (SOLO si se dijo el número explícito):
  - peso (kg), talla (cm), pesoHabitual (kg), porcentajeGrasa, masaMuscular (kg),
    circunferenciaCintura (cm), circunferenciaCadera (cm)

REGLAS DURAS:
  1. En los campos con lista de valores permitidos, usa EXACTAMENTE uno de esos
     valores, con tildes ("Sí", no "Si").
  2. Medidas numéricas: solo si hay número explícito; conviértelo a la unidad
     indicada y devuélvelo como string sin unidad (ej. "72").
  3. Omití las claves de temas que no se trataron. NO inventes.
  4. Devuelve únicamente el JSON, sin markdown.
`.trim();

/** ¿Valor string no vacío? Para no pisar lo que el coach ya escribió. */
function isFilledStr(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

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

/**
 * Deriva extensión + mime de un Content-Type de upload del navegador.
 * MediaRecorder produce típicamente `audio/webm;codecs=opus` (Chrome) o
 * `audio/mp4` (Safari). Whisper reconoce el formato por el nombre de archivo,
 * así que la extensión importa.
 */
function audioFormatFromContentType(contentType: string): { ext: string; mime: string } {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('webm')) return { ext: 'webm', mime: 'audio/webm' };
  if (ct.includes('ogg')) return { ext: 'ogg', mime: 'audio/ogg' };
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac'))
    return { ext: 'mp4', mime: 'audio/mp4' };
  if (ct.includes('wav')) return { ext: 'wav', mime: 'audio/wav' };
  if (ct.includes('mpeg') || ct.includes('mp3')) return { ext: 'mp3', mime: 'audio/mpeg' };
  // Default: el grabador client-side por defecto graba webm/opus.
  return { ext: 'webm', mime: 'audio/webm' };
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
   * ¿La historia ya tiene transcripción (o la está procesando)? Se usa como
   * guard para que el path por composición de Twilio NO re-transcriba cuando
   * el audio client-side ya entregó el transcript. NO se usa en el retry
   * manual (retranscribeHistoria) — ese fuerza re-transcripción a propósito.
   */
  async hasTranscript(historiaId: string): Promise<boolean> {
    if (!historiaId) return false;
    try {
      const rows = await postgresService.query(
        `SELECT "transcription_status", "transcription_text"
           FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
        [historiaId]
      );
      if (!rows || rows.length === 0) return false;
      const status = rows[0].transcription_status;
      const text = rows[0].transcription_text;
      return (
        status === 'done' ||
        status === 'processing' ||
        (typeof text === 'string' && text.trim().length > 0)
      );
    } catch (e: any) {
      console.warn('[Transcription] hasTranscript error:', e?.message || e);
      return false;
    }
  }

  /** Estado de transcripción de una historia (para decisiones de fallback). */
  private async getTranscriptState(
    historiaId: string
  ): Promise<{ status: string | null; hasText: boolean }> {
    try {
      const rows = await postgresService.query(
        `SELECT "transcription_status", "transcription_text"
           FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
        [historiaId]
      );
      if (!rows || rows.length === 0) return { status: null, hasText: false };
      const status = (rows[0].transcription_status ?? null) as string | null;
      const text = rows[0].transcription_text;
      return { status, hasText: typeof text === 'string' && text.trim().length > 0 };
    } catch (e: any) {
      console.warn('[Transcription] getTranscriptState error:', e?.message || e);
      return { status: null, hasText: false };
    }
  }

  /**
   * Decide si transcribir desde la composición (FALLBACK). La entrada principal
   * es el audio client-side; la composición solo cubre cuando ese path no
   * entregó. Maneja el race "client en vuelo": si la historia está 'processing'
   * cuando la composición termina, espera y reconfirma antes de re-transcribir
   * — así no duplica trabajo si el client va a terminar bien, pero tampoco deja
   * la historia atascada si el client falla justo después.
   *
   * Nunca lanza al caller (fire-and-forget desde el webhook).
   */
  async ensureTranscribedFromComposition(
    historiaId: string,
    compositionSid: string
  ): Promise<void> {
    if (!historiaId || !compositionSid) return;
    const state = await this.getTranscriptState(historiaId);

    // Ya hay transcript utilizable → la composición queda solo para video.
    if (state.hasText || state.status === 'done') {
      console.log(
        `[Transcription] ensureFromComposition: historia ${historiaId} ya tiene transcript (status=${state.status}) — no re-transcribo.`
      );
      return;
    }

    // Client-side en vuelo: esperar y reconfirmar antes de gastar en la
    // composición. Cierra el race en que el client falla justo después.
    if (state.status === 'processing') {
      const RECHECK_MS = 120_000;
      console.log(
        `[Transcription] ensureFromComposition: historia ${historiaId} en 'processing' (client-side) — reconfirmo en ${RECHECK_MS / 1000}s.`
      );
      setTimeout(() => {
        void (async () => {
          const s2 = await this.getTranscriptState(historiaId);
          if (s2.hasText || s2.status === 'done') {
            console.log(
              `[Transcription] ensureFromComposition: historia ${historiaId} resolvió por client-side — fallback innecesario.`
            );
            return;
          }
          console.log(
            `[Transcription] ensureFromComposition: historia ${historiaId} sigue sin transcript (status=${s2.status}) — corro fallback por composición.`
          );
          this.processComposition(historiaId, compositionSid).catch((err) => {
            console.error('[Transcription] ensureFromComposition fallback lanzó:', err);
          });
        })();
      }, RECHECK_MS);
      return;
    }

    // pending | error | null → transcribir desde composición ya.
    await this.processComposition(historiaId, compositionSid);
  }

  /**
   * Entrada del pipeline para audio grabado en el navegador (client-side) y
   * subido directo. Es la entrada PRINCIPAL desde que el médico finaliza la
   * llamada: el transcript queda listo a los segundos, sin esperar el render
   * de la composición de Twilio. Reutiliza el motor común runWhisperPipeline.
   *
   * Nunca lanza al caller (fire-and-forget desde el controller).
   */
  async processClientAudio(
    historiaId: string,
    audioBuf: Buffer,
    contentType: string,
    variant: 'consulta' | 'nutricional' = 'consulta'
  ): Promise<void> {
    const t0 = Date.now();
    if (!historiaId) {
      console.warn('[Transcription] processClientAudio: historiaId vacío');
      return;
    }
    try {
      if (!audioBuf || audioBuf.byteLength === 0) {
        console.error('[Transcription] processClientAudio: audio vacío');
        await this.markStatus(historiaId, 'error');
        return;
      }

      const { ext, mime } = audioFormatFromContentType(contentType);
      console.log(
        `[Transcription] processClientAudio start historia=${historiaId} variant=${variant} ${(audioBuf.byteLength / 1024 / 1024).toFixed(2)} MB (${mime})`
      );

      // Marcar processing antes del I/O largo (Whisper + GPT).
      await this.markStatus(historiaId, 'processing');

      if (variant === 'nutricional') {
        await this.runNutricionPipeline(historiaId, audioBuf, `consulta.${ext}`, t0, mime);
      } else {
        await this.runWhisperPipeline(historiaId, audioBuf, `consulta.${ext}`, t0, mime);
      }
    } catch (err: any) {
      console.error(
        '[Transcription] processClientAudio error:',
        err?.message || err,
        err?.stack
      );
      await this.markStatus(historiaId, 'error').catch(() => {
        /* swallow */
      });
    }
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

      // Dedup: si el audio client-side ya entregó (o está entregando) el
      // transcript, no re-transcribimos desde la grabación de Twilio.
      if (await this.hasTranscript(historiaId)) {
        console.log(
          `[Transcription] processRecording: historia ${historiaId} ya transcrita/en proceso — skip.`
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
    t0: number,
    audioMime: string = 'audio/mpeg'
  ): Promise<void> {
    try {
      // 1) Whisper
      const audioFile = await toFile(audioBuf, audioFileName, {
        type: audioMime,
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
   * Pipeline para la variante NUTRICIONAL: Whisper → guarda transcript →
   * GPT-4o-mini extrae campos de la anamnesis nutricional → autollena el JSONB
   * `datosNutricionales` (y columnas peso/talla) SOLO en los campos vacíos, para
   * no pisar lo que el coach ya escribió. Persiste sin pasar por el bulk-save del
   * panel.
   *
   * Captura sus propios errores y los persiste en status='error'.
   */
  private async runNutricionPipeline(
    historiaId: string,
    audioBuf: Buffer,
    audioFileName: string,
    t0: number,
    audioMime: string = 'audio/mpeg'
  ): Promise<void> {
    try {
      // 1) Whisper
      const audioFile = await toFile(audioBuf, audioFileName, { type: audioMime });
      const whisperResp = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'es',
      });
      const transcript = (whisperResp as any)?.text?.trim?.() ?? '';
      console.log(`[Transcription][nutri] Whisper OK, ${transcript.length} chars`);

      if (!transcript) {
        console.error('[Transcription][nutri] Whisper devolvió transcript vacío');
        await this.markStatus(historiaId, 'error');
        return;
      }

      // 2) Persistir transcript completo (misma columna que la variante consulta)
      await medicalHistoryService.updateField(historiaId, 'transcription_text', transcript);

      // 3) GPT-4o-mini → JSON nutricional
      const gptResp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: NUTRICION_EXTRACTION_PROMPT },
          { role: 'user', content: `Transcripción de la consulta:\n\n${transcript}` },
        ],
      });
      const raw = gptResp.choices?.[0]?.message?.content?.trim() || '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.error('[Transcription][nutri] No pude parsear JSON de GPT:', e);
        await this.markStatus(historiaId, 'error');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.error('[Transcription][nutri] GPT no devolvió un objeto plano');
        await this.markStatus(historiaId, 'error');
        return;
      }
      const obj = parsed as Record<string, unknown>;
      console.log(`[Transcription][nutri] GPT keys: [${Object.keys(obj).join(', ')}]`);

      // 4) Estado actual (peso/talla columnas + datosNutricionales JSONB) para
      //    rellenar SOLO lo vacío.
      const rows = await postgresService.query(
        `SELECT "peso", "talla", "datosNutricionales" FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
        [historiaId]
      );
      if (!rows || rows.length === 0) {
        console.warn(`[Transcription][nutri] historia ${historiaId} no encontrada`);
        await this.markStatus(historiaId, 'error');
        return;
      }
      const current = rows[0] as { peso?: unknown; talla?: unknown; datosNutricionales?: unknown };
      const currentDatos: Record<string, unknown> =
        current.datosNutricionales && typeof current.datosNutricionales === 'object' && !Array.isArray(current.datosNutricionales)
          ? { ...(current.datosNutricionales as Record<string, unknown>) }
          : {};

      let applied = 0;

      // 4a) Columnas top-level peso/talla (whitelist) — solo si están vacías.
      for (const col of NUTRICION_COLUMN_KEYS) {
        if (isFilledStr(obj[col]) && !isFilledStr((current as Record<string, unknown>)[col])) {
          try {
            const r = await medicalHistoryService.updateField(historiaId, col, String(obj[col]).trim());
            if (r.success) applied++;
          } catch (e: any) {
            console.warn(`[Transcription][nutri] updateField ${col} falló:`, e?.message || e);
          }
        }
      }

      // 4b) Claves del JSONB datosNutricionales — merge en los vacíos.
      let mergedCount = 0;
      for (const key of NUTRICION_DATOS_SET) {
        if (isFilledStr(obj[key]) && !isFilledStr(currentDatos[key])) {
          currentDatos[key] = String(obj[key]).trim();
          mergedCount++;
        }
      }
      if (mergedCount > 0) {
        await postgresService.query(
          `UPDATE "HistoriaClinica" SET "datosNutricionales" = $1 WHERE "_id" = $2`,
          [JSON.stringify(currentDatos), historiaId]
        );
        applied += mergedCount;
      }

      console.log(
        `[Transcription][nutri] autollenado: ${applied} campos (${mergedCount} en datosNutricionales) historia=${historiaId} ms=${Date.now() - t0}`
      );

      // El transcript siempre quedó guardado → done aunque GPT no extrajera nada.
      await this.markStatus(historiaId, 'done');
    } catch (err: any) {
      console.error('[Transcription][nutri] Pipeline error:', err?.message || err, err?.stack);
      await this.markStatus(historiaId, 'error').catch(() => {
        /* swallow */
      });
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
