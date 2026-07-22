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
          console.warn(`[ChimeRecording] No se pudo detener la captura: ${e.message}`);
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
   * Detiene la captura de meetings huérfanos: filas que quedaron en 'capturing'
   * más de `olderThanMinutes` (p. ej. porque el contenedor se reinició a mitad de
   * una consulta y endRoom nunca corrió). Sin esto, el Media Capture Pipeline
   * sigue corriendo y FACTURANDO indefinidamente. Pensado para un barrido
   * periódico (fase 2, cuando la grabación esté encendida).
   */
  async sweepOrphanCaptures(olderThanMinutes = 180): Promise<number> {
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
