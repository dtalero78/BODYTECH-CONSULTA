// ============================================================================
// diarizacion.service — el diálogo de la consulta, con quién dijo qué.
//
// El navegador del médico graba la consulta mezclando su micrófono con el audio
// del paciente, así que las DOS voces están en el archivo. Pero Whisper devuelve
// un bloque corrido sin atribución: se lee como un monólogo del coach aunque el
// paciente esté ahí. Varios ítems de la rúbrica de calidad dependen justamente
// de distinguir quién habló (escucha activa, si preguntó y dejó responder), y
// sobre un bloque sin atribución el evaluador tiene que adivinar.
//
// Amazon Transcribe sí separa hablantes, pero solo lee de S3 y solo se estaba
// usando sobre el MP4 de las consultas grabadas — la muestra (~14%). Acá se le
// da el MISMO audio del navegador, que existe en todas:
//
//   audio en memoria → S3 → job de Transcribe (2 hablantes) → texto con turnos
//   → `transcription_hablantes` → Calidad lo prefiere sobre el bloque corrido
//   → se borra el audio de S3 (es PHI y ya no hace falta)
//
// Whisper NO se reemplaza: sigue siendo el que corre primero, en segundos,
// porque de él depende el autollenado de los 11 campos clínicos que el médico
// revisa apenas termina la consulta. Transcribe es asíncrono (minutos) y a
// Calidad no le urge — se audita días después. Los dos conviven a propósito.
//
// Todo es best-effort: si S3 o Transcribe fallan, la consulta conserva su
// transcripción de Whisper y no se rompe nada.
// ============================================================================

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import postgresService from '../postgres.service';
import { transcribeService } from './transcribe.service';

const REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.RECORDINGS_BUCKET || '';
/** Apagable sin redeploy si el gasto de Transcribe molesta. */
const ENABLED =
  (process.env.DIARIZACION_ENABLED || 'true').toLowerCase() !== 'false' && !!BUCKET;
/** Prefijo propio: no se mezcla con las grabaciones de video de Chime. */
const PREFIX = 'audio-consulta';

/** Formatos que acepta Transcribe, mapeados desde el mime del MediaRecorder. */
function formatoDe(mime: string): 'webm' | 'mp4' | 'ogg' | 'mp3' | 'wav' | null {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return null;
}

class DiarizacionService {
  private s3 = new S3Client({ region: REGION });

  get enabled(): boolean {
    return ENABLED;
  }

  private key(historiaId: string, ext: string): string {
    return `${PREFIX}/${historiaId.replace(/[^0-9a-zA-Z._-]/g, '-')}.${ext}`;
  }

  private jobName(historiaId: string): string {
    return `bodytech-dz-${historiaId}`;
  }

  /**
   * Sube el audio y arranca el job. Se llama en paralelo a Whisper (el buffer
   * ya está en memoria), sin bloquearlo: el autollenado clínico no puede
   * esperar a Transcribe.
   */
  async iniciar(historiaId: string, audioBuf: Buffer, mime: string): Promise<void> {
    if (!ENABLED || !historiaId || !audioBuf?.byteLength) return;
    const formato = formatoDe(mime);
    if (!formato) {
      console.warn(`[Diarizacion] mime no soportado por Transcribe: ${mime}`);
      return;
    }
    const key = this.key(historiaId, formato);
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: audioBuf,
          ContentType: mime,
          // El audio se borra al terminar la transcripción; la etiqueta permite
          // además una regla de ciclo de vida en el bucket como red de seguridad.
          Tagging: 'app=bodytech-consulta&tipo=audio-consulta',
        })
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // El caso más probable es que la credencial de producción no tenga
      // PutObject sobre el bucket. Se registra y se sigue: Whisper ya corrió.
      console.error(`[Diarizacion] No se pudo subir el audio de ${historiaId}: ${msg}`);
      await this.marcar(historiaId, 'error', { error: `S3: ${msg}`.slice(0, 500) });
      return;
    }

    const r = await transcribeService.getOrStartFromS3(
      this.jobName(historiaId),
      `s3://${BUCKET}/${key}`,
      formato
    );
    if (r.status === 'failed') {
      console.error(`[Diarizacion] Transcribe rechazó ${historiaId}: ${r.reason}`);
      await this.marcar(historiaId, 'error', { error: (r.reason || '').slice(0, 500) });
      await this.borrarAudio(key);
      return;
    }
    await this.marcar(historiaId, 'processing', { key });
    console.log(`[Diarizacion] Job iniciado para ${historiaId} (${formato})`);
  }

  /**
   * Sondea los jobs en curso y guarda los que terminaron. Lo llama el worker:
   * Transcribe es asíncrono y nadie está esperando en una request.
   */
  async procesarPendientes(limite = 15): Promise<number> {
    if (!ENABLED) return 0;
    const filas = await postgresService.query(
      `SELECT "_id", "transcription_hablantes_key" AS key
         FROM "HistoriaClinica"
        WHERE "transcription_hablantes_status" = 'processing'
        ORDER BY "fechaConsulta" DESC NULLS LAST
        LIMIT $1`,
      [limite]
    );
    let listos = 0;
    for (const f of filas ?? []) {
      const historiaId = String(f._id);
      const key = f.key ? String(f.key) : null;
      try {
        const r = await transcribeService.getOrStartFromS3(
          this.jobName(historiaId),
          key ? `s3://${BUCKET}/${key}` : '',
          'webm'
        );
        if (r.status === 'in_progress') continue;
        if (r.status === 'completed' && (r.transcript || '').trim()) {
          await this.marcar(historiaId, 'done', { texto: r.transcript!.trim() });
          if (key) await this.borrarAudio(key);
          listos++;
          console.log(
            `[Diarizacion] ${historiaId} listo con hablantes (${r.transcript!.length} caracteres)`
          );
        } else {
          await this.marcar(historiaId, 'error', {
            error: (r.reason || 'Transcribe no devolvió texto').slice(0, 500),
          });
          if (key) await this.borrarAudio(key);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Diarizacion] Sondeo de ${historiaId} falló: ${msg}`);
      }
    }
    return listos;
  }

  /** El audio ya cumplió su función: es dato de paciente y no debe quedarse. */
  private async borrarAudio(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Diarizacion] No se pudo borrar ${key}: ${msg}`);
    }
  }

  private async marcar(
    historiaId: string,
    estado: 'processing' | 'done' | 'error',
    p: { texto?: string; error?: string; key?: string } = {}
  ): Promise<void> {
    await postgresService
      .query(
        `UPDATE "HistoriaClinica"
            SET "transcription_hablantes_status" = $2,
                "transcription_hablantes" = COALESCE($3, "transcription_hablantes"),
                "transcription_hablantes_error" = $4,
                "transcription_hablantes_key" = COALESCE($5, "transcription_hablantes_key"),
                "transcription_hablantes_at" = CASE WHEN $2 = 'done' THEN NOW()
                                                    ELSE "transcription_hablantes_at" END
          WHERE "_id" = $1`,
        [historiaId, estado, p.texto ?? null, p.error ?? null, p.key ?? null]
      )
      .catch((e) => console.error('[Diarizacion] No se pudo marcar estado:', e?.message ?? e));
  }
}

export const diarizacionService = new DiarizacionService();
export default diarizacionService;
