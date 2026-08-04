/**
 * Grabación de videollamadas de Amazon Chime → MP4 en S3.
 *
 * Equivalente a las "compositions" de Twilio, con dos pasos:
 *   1. Media Capture Pipeline  → graba el video compuesto (con audio) a S3 en chunks.
 *   2. Media Concatenation Pipeline → une los chunks en un solo MP4.
 *
 * Se activa solo cuando RECORDINGS_ENABLED=true y hay RECORDINGS_BUCKET. Mientras
 * tanto (fase 1) queda inerte: todos los métodos salen temprano.
 *
 * Credenciales: el SDK de AWS toma AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY del
 * entorno (BODYTECH corre en DigitalOcean, sin rol IAM).
 */
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  DeleteMediaCapturePipelineCommand,
  CreateMediaConcatenationPipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import postgresService from '../postgres.service';

const REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.RECORDINGS_BUCKET || '';
const ENABLED = (process.env.RECORDINGS_ENABLED || 'false').toLowerCase() === 'true' && !!BUCKET;
// Muestreo de calidad: cuántas grabaciones por coach al mes (repartidas). El mes
// se parte en esta cantidad de franjas iguales y se graba la primera consulta de
// cada coach en cada franja → N grabaciones repartidas parejo, tope garantizado.
// Ajustable por env sin redeploy. NO afecta lo clínico (el autollenado usa la vía
// del navegador, corre en todas las consultas); solo limita la muestra de /calidad.
const MUESTRAS_POR_MES = Math.max(1, Number(process.env.CHIME_SAMPLES_PER_MONTH) || 10);

interface ChimeMeetingLike {
  MeetingId?: string;
  MeetingArn?: string;
}

class ChimeRecordingService {
  private pipelines = new ChimeSDKMediaPipelinesClient({ region: REGION });
  private s3 = new S3Client({ region: REGION });
  private tableReady = false;

  get enabled(): boolean {
    return ENABLED;
  }

  get bucket(): string {
    return BUCKET;
  }

  get region(): string {
    return REGION;
  }

  /**
   * Ubicación en S3 del MP4 de una sala, para alimentar a Amazon Transcribe
   * (necesita el URI s3://, no una URL firmada). Devuelve el estado de la fila
   * y el s3Uri cuando el MP4 ya existe. `null` si no hay grabación registrada.
   */
  async getRecordingS3Uri(
    roomName: string
  ): Promise<{ status: string; s3Uri: string | null; key: string | null } | null> {
    if (!ENABLED) return null;
    await this.ensureTable();
    const rows = await postgresService.query(
      `SELECT s3_recording_prefix, status FROM chime_recordings
       WHERE room_name = $1 ORDER BY id DESC LIMIT 1`,
      [roomName]
    );
    if (!rows || rows.length === 0) return null;
    const prefix = rows[0].s3_recording_prefix;
    const status = rows[0].status;
    if (!prefix) return { status, s3Uri: null, key: null };

    const listed = await this.s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}/` })
    );
    const mp4 = (listed.Contents || []).find((o) => o.Key?.toLowerCase().endsWith('.mp4'));
    if (!mp4?.Key) return { status, s3Uri: null, key: null }; // aún procesando
    return { status: 'ready', s3Uri: `s3://${BUCKET}/${mp4.Key}`, key: mp4.Key };
  }

  /** Crea la tabla de grabaciones si no existe (aditiva, idempotente). */
  private async ensureTable(): Promise<void> {
    if (this.tableReady) return;
    await postgresService.query(`
      CREATE TABLE IF NOT EXISTS chime_recordings (
        id SERIAL PRIMARY KEY,
        room_name TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        capture_pipeline_arn TEXT,
        capture_pipeline_id TEXT,
        s3_capture_prefix TEXT,
        s3_recording_prefix TEXT,
        status TEXT DEFAULT 'capturing',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )
    `);
    this.tableReady = true;
  }

  /** Arranca la captura del meeting a S3. Idempotente por meetingId. */
  async startCapture(roomName: string, meeting: ChimeMeetingLike): Promise<void> {
    if (!ENABLED || !meeting.MeetingId || !meeting.MeetingArn) return;
    try {
      await this.ensureTable();

      // No arrancar dos veces para el mismo meeting.
      const existing = await postgresService.query(
        `SELECT id FROM chime_recordings WHERE meeting_id = $1 LIMIT 1`,
        [meeting.MeetingId]
      );
      if (existing && existing.length > 0) return;

      // Compuerta de muestreo: 10/mes por coach, repartidas en franjas de ~3 días
      // (una por franja). Si esta franja ya tiene grabación de este coach, no se
      // graba (invisible para la llamada; la historia clínica no se afecta).
      if (!(await this.debeGrabarPorMuestreo(roomName))) {
        await postgresService
          .query(`UPDATE video_sessions SET recording_enabled = false WHERE room_name = $1`, [roomName])
          .catch(() => {});
        return;
      }

      const capturePrefix = `captures/${meeting.MeetingId}`;
      const res = await this.pipelines.send(
        new CreateMediaCapturePipelineCommand({
          SourceType: 'ChimeSdkMeeting',
          SourceArn: meeting.MeetingArn,
          SinkType: 'S3Bucket',
          SinkArn: `arn:aws:s3:::${BUCKET}/${capturePrefix}`,
          ChimeSdkMeetingConfiguration: {
            ArtifactsConfiguration: {
              Audio: { MuxType: 'AudioWithCompositedVideo' },
              Video: { State: 'Disabled' },
              Content: { State: 'Disabled' },
              CompositedVideo: {
                Layout: 'GridView',
                Resolution: 'HD',
                GridViewConfiguration: { ContentShareLayout: 'Vertical' },
              },
            },
          },
        })
      );

      const pipe = res.MediaCapturePipeline;
      await postgresService.query(
        `INSERT INTO chime_recordings
           (room_name, meeting_id, capture_pipeline_arn, capture_pipeline_id, s3_capture_prefix, status)
         VALUES ($1, $2, $3, $4, $5, 'capturing')`,
        [roomName, meeting.MeetingId, pipe?.MediaPipelineArn || null, pipe?.MediaPipelineId || null, capturePrefix]
      );
      console.log(`[ChimeRecording] Captura iniciada: meeting ${meeting.MeetingId} (sala ${roomName})`);
    } catch (err: any) {
      console.error(`[ChimeRecording] Error iniciando captura: ${err.message}`);
    }
  }

  /** Detiene la captura y arranca la concatenación → un MP4 único en S3. */
  async stopAndConcatenate(meetingId: string): Promise<void> {
    if (!ENABLED || !meetingId) return;
    try {
      await this.ensureTable();
      const recordingPrefix = `recordings/${meetingId}`;

      // Claim ATÓMICO: endRoom puede dispararse varias veces (colgar + cleanup del
      // componente + beforeunload). Un solo UPDATE condicional flipea
      // capturing→concatenating, así SOLO UNA llamada concatena (evita MP4
      // duplicados). Las demás obtienen 0 filas y salen.
      const claim = await postgresService.query(
        `UPDATE chime_recordings
           SET status='concatenating', s3_recording_prefix=$2, ended_at=NOW()
         WHERE meeting_id=$1 AND status='capturing'
         RETURNING capture_pipeline_arn, capture_pipeline_id`,
        [meetingId, recordingPrefix]
      );
      if (!claim || claim.length === 0) return; // otra llamada ya lo tomó
      const rec = claim[0];

      // Detener la captura (los chunks ya quedaron en S3).
      if (rec.capture_pipeline_id) {
        try {
          await this.pipelines.send(
            new DeleteMediaCapturePipelineCommand({ MediaPipelineId: rec.capture_pipeline_id })
          );
        } catch (e: any) {
          // Cuando el meeting ya terminó (todos salieron, o es una captura huérfana
          // que el barrido cierra horas después), AWS ya auto-terminó el pipeline y
          // el Delete devuelve NotFound. Es ESPERADO y no afecta la concatenación
          // (usa el ARN + los artefactos en S3). Solo lo registramos como info.
          const notFound =
            e?.name === 'NotFoundException' ||
            /not\s*found|find the requested identifier/i.test(e?.message || '');
          if (notFound) {
            console.log(
              `[ChimeRecording] Pipeline de captura ya finalizado en AWS (meeting ${meetingId}); se procede a concatenar.`
            );
          } else {
            console.warn(`[ChimeRecording] No se pudo detener la captura: ${e.message}`);
          }
        }
      }

      if (!rec.capture_pipeline_arn) {
        await postgresService.query(
          `UPDATE chime_recordings SET status='error' WHERE meeting_id=$1`,
          [meetingId]
        );
        return;
      }

      await this.pipelines.send(
        new CreateMediaConcatenationPipelineCommand({
          Sources: [
            {
              Type: 'MediaCapturePipeline',
              MediaCapturePipelineSourceConfiguration: {
                MediaPipelineArn: rec.capture_pipeline_arn,
                ChimeSdkMeetingConfiguration: {
                  ArtifactsConfiguration: {
                    // Patrón estándar de Chime: Audio + CompositedVideo enabled
                    // (el MP4 compuesto lleva el audio).
                    Audio: { State: 'Enabled' },
                    Video: { State: 'Disabled' },
                    Content: { State: 'Disabled' },
                    DataChannel: { State: 'Disabled' },
                    TranscriptionMessages: { State: 'Disabled' },
                    MeetingEvents: { State: 'Disabled' },
                    CompositedVideo: { State: 'Enabled' },
                  },
                },
              },
            },
          ],
          Sinks: [
            {
              Type: 'S3Bucket',
              S3BucketSinkConfiguration: { Destination: `arn:aws:s3:::${BUCKET}/${recordingPrefix}` },
            },
          ],
        })
      );

      console.log(`[ChimeRecording] Concatenación iniciada: meeting ${meetingId} → s3://${BUCKET}/${recordingPrefix}`);
    } catch (err: any) {
      console.error(`[ChimeRecording] Error concatenando: ${err.message}`);
    }
  }

  /**
   * meetingId de la grabación que sigue capturando para una sala. Sirve para
   * concatenar tras un reinicio del contenedor, cuando el mapa en memoria del
   * provider ya no tiene el meeting pero la captura quedó viva en AWS.
   */
  async getCapturingMeetingId(roomName: string): Promise<string | null> {
    if (!ENABLED) return null;
    try {
      await this.ensureTable();
      const rows = await postgresService.query(
        `SELECT meeting_id FROM chime_recordings
         WHERE room_name = $1 AND status = 'capturing' ORDER BY id DESC LIMIT 1`,
        [roomName]
      );
      return rows?.[0]?.meeting_id || null;
    } catch {
      return null;
    }
  }

  /**
   * Muestreo estratificado por franjas de tiempo. El mes se parte en
   * `MUESTRAS_POR_MES` franjas iguales (~3 días con el default de 10) y en cada
   * franja se graba SOLO la primera consulta de cada coach. Resultado: hasta
   * N grabaciones por coach al mes, REPARTIDAS parejo, sin necesidad de saber
   * cuántas consultas hará (un coach con pocas consultas tendrá menos de N —
   * natural). Devuelve true si esta consulta cae en una franja donde el coach
   * aún no tiene grabación.
   *
   * Zona horaria: Colombia = UTC-5 (los límites de día se arman con
   * Date.UTC(y, m, d, 5, ...), igual que getDailyStats). Ante cualquier duda
   * (sin coach identificable o error de consulta) devuelve true: mejor grabar de
   * más que perder una muestra de auditoría — el tope real de costo lo protege
   * además el barrido de huérfanas.
   */
  private async debeGrabarPorMuestreo(roomName: string): Promise<boolean> {
    try {
      const vs = await postgresService.query(
        `SELECT medico FROM video_sessions WHERE room_name = $1 LIMIT 1`,
        [roomName]
      );
      const medico: string | undefined = vs?.[0]?.medico;
      if (!medico) return true; // sin coach → no bloquear

      // "Ahora" en hora Colombia: desplazar UTC-5 y leer los campos UTC.
      const ahoraCo = new Date(Date.now() - 5 * 3600_000);
      const y = ahoraCo.getUTCFullYear();
      const m = ahoraCo.getUTCMonth(); // 0-11
      const diaDelMes = ahoraCo.getUTCDate(); // 1-31
      const diasEnMes = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

      const tamFranja = diasEnMes / MUESTRAS_POR_MES;
      const franja = Math.floor((diaDelMes - 1) / tamFranja); // 0 .. N-1
      // ceil (no floor): con franjas no enteras (meses de 28/31 días) floor
      // desalinea el rango con la asignación de franja y clasifica mal los días
      // del borde. ceil mantiene las franjas contiguas, sin huecos ni solapes.
      const diaInicio = Math.ceil(franja * tamFranja) + 1;
      const diaFin = Math.ceil((franja + 1) * tamFranja) + 1; // primer día de la franja siguiente

      // Límites en UTC (inicio de día en Colombia = 05:00 UTC).
      const inicioUtc = new Date(Date.UTC(y, m, diaInicio, 5, 0, 0)).toISOString();
      const finUtc = new Date(Date.UTC(y, m, diaFin, 5, 0, 0)).toISOString();

      // ¿Este coach ya tiene una grabación REALMENTE iniciada en esta franja?
      // (chime_recordings = capturas que arrancaron; se une al coach por sala)
      const rec = await postgresService.query(
        `SELECT 1
           FROM chime_recordings cr
           JOIN video_sessions vs2 ON vs2.room_name = cr.room_name
          WHERE vs2.medico = $1
            AND cr.created_at >= $2 AND cr.created_at < $3
          LIMIT 1`,
        [medico, inicioUtc, finUtc]
      );
      const yaGrabo = !!(rec && rec.length > 0);
      if (yaGrabo) {
        console.log(
          `[ChimeRecording] Muestreo: coach ${medico} ya grabó en la franja ${franja + 1}/${MUESTRAS_POR_MES} del mes → se omite (sala ${roomName})`
        );
      }
      return !yaGrabo;
    } catch (err: any) {
      console.warn(`[ChimeRecording] Muestreo: no se pudo evaluar cuota (${err?.message}) → se graba por seguridad`);
      return true;
    }
  }

  /**
   * Detiene la captura de meetings huérfanos: filas que quedaron en 'capturing'
   * más de `olderThanMinutes` (p. ej. porque el paciente cerró la pestaña sin
   * colgar y quedó "colgado", o el contenedor se reinició a mitad de consulta y
   * endRoom nunca corrió). Sin esto, el Media Capture Pipeline sigue corriendo y
   * FACTURANDO indefinidamente — y encima come el cupo de Chime que compartimos
   * con BSL (misma cuenta AWS). Como una consulta real no pasa de ~20 min, el
   * default es 30 (20 + margen): a los 30 min una sala ya está claramente colgada.
   * Solo borra el pipeline de GRABACIÓN; NO desconecta a nadie ni corta la llamada.
   */
  async sweepOrphanCaptures(olderThanMinutes = 30): Promise<number> {
    if (!ENABLED) return 0;
    try {
      await this.ensureTable();
      const rows = await postgresService.query(
        `SELECT meeting_id FROM chime_recordings
          WHERE status='capturing' AND created_at < NOW() - ($1 || ' minutes')::interval`,
        [String(olderThanMinutes)]
      );
      for (const r of rows || []) {
        console.warn(`[ChimeRecording] Cerrando captura huérfana: meeting ${r.meeting_id}`);
        await this.stopAndConcatenate(r.meeting_id);
      }
      return rows?.length || 0;
    } catch (err: any) {
      console.error(`[ChimeRecording] Error en barrido de huérfanas: ${err.message}`);
      return 0;
    }
  }

  /**
   * Devuelve un presigned URL del MP4 de una sala (o null si aún no está listo).
   * La concatenación tarda un rato tras finalizar la llamada.
   */
  async getRecordingUrl(roomName: string): Promise<{ url: string; key: string; status: string } | null> {
    if (!ENABLED) return null;
    await this.ensureTable();
    const rows = await postgresService.query(
      `SELECT s3_recording_prefix, status FROM chime_recordings
       WHERE room_name = $1 ORDER BY id DESC LIMIT 1`,
      [roomName]
    );
    if (!rows || rows.length === 0) return null;
    const prefix = rows[0].s3_recording_prefix;
    const status = rows[0].status;
    if (!prefix) return null;

    // La concatenación escribe el MP4 bajo <prefix>/... — buscamos cualquier .mp4.
    const listed = await this.s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}/` })
    );
    const mp4 = (listed.Contents || []).find((o) => o.Key?.toLowerCase().endsWith('.mp4'));
    if (!mp4?.Key) return { url: '', key: '', status }; // aún procesando

    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: BUCKET, Key: mp4.Key }), {
      expiresIn: 3600,
    });
    return { url, key: mp4.Key, status: 'ready' };
  }
}

export const chimeRecordingService = new ChimeRecordingService();
