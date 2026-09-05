// ============================================================================
// transcribe.service — transcripción de la grabación de una consulta con
// Amazon Transcribe, para el módulo de calidad.
//
// El MP4 de la consulta ya vive en S3 (Chime → chime-recording.service). En vez
// de descargarlo, extraer audio con ffmpeg y mandarlo a Whisper (el camino
// Twilio de siempre), Transcribe lee el MP4 directo de S3 y saca el audio él
// mismo, y además separa hablantes (médico/paciente).
//
// BODYTECH es una sola app: el módulo de calidad llama a este servicio como una
// función local, autenticado con las access keys de AWS (no rol IAM). No hay
// token interno ni HTTP entre apps (a diferencia de BSL, que quedó partido).
//
// Amazon Transcribe es asíncrono (job batch). El servicio es idempotente (job
// determinístico por sala) y se consulta por sondeo: la primera llamada arranca
// el job, las siguientes informan el avance, y al terminar devuelve el texto.
// ============================================================================
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { chimeRecordingService } from './chime-recording.service';

const REGION = process.env.CHIME_CONTROL_REGION || process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.RECORDINGS_BUCKET || '';
// Español latinoamericano (no hay es-CO en Transcribe; es-US es el más cercano).
const LANGUAGE = process.env.TRANSCRIBE_LANGUAGE || 'es-US';

export type TranscribeStatus =
  | 'no_recording' // aún no hay MP4 para la sala (grabación en proceso o inexistente)
  | 'in_progress' // job de Transcribe corriendo
  | 'completed' // listo, `transcript` presente
  | 'failed'; // el job falló

export interface TranscribeResult {
  status: TranscribeStatus;
  transcript?: string;
  reason?: string;
}

class TranscribeService {
  private client = new TranscribeClient({ region: REGION });

  /**
   * Nombre de job determinístico por sala: la operación es idempotente (arrancar
   * dos veces reusa el mismo job) sin tabla propia. Transcribe exige
   * [0-9a-zA-Z._-], máx 200.
   */
  private jobName(roomName: string): string {
    return `bodytech-tx-${roomName}`.replace(/[^0-9a-zA-Z._-]/g, '-').slice(0, 200);
  }

  /**
   * Igual que `getOrStartTranscription`, pero sobre CUALQUIER audio ya subido a
   * S3 — no solo el MP4 de una sala Chime. Lo usa la diarización del audio del
   * navegador, que existe en TODAS las consultas y no solo en la muestra que se
   * graba. Misma idempotencia: el nombre del job es la llave.
   */
  async getOrStartFromS3(
    jobName: string,
    s3Uri: string,
    mediaFormat: 'mp4' | 'webm' | 'ogg' | 'mp3' | 'wav' | 'flac' | 'm4a',
    opts: { canales?: { ch0: string; ch1: string } } = {}
  ): Promise<TranscribeResult> {
    const safeName = jobName.replace(/[^0-9a-zA-Z._-]/g, '-').slice(0, 200);
    let job;
    try {
      const got = await this.client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: safeName })
      );
      job = got.TranscriptionJob;
    } catch {
      job = undefined; // BadRequest/NotFound → no existe todavía
    }
    if (!job) {
      try {
        await this.client.send(
          new StartTranscriptionJobCommand({
            TranscriptionJobName: safeName,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            LanguageCode: LANGUAGE as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            MediaFormat: mediaFormat as any,
            Media: { MediaFileUri: s3Uri },
            // Dos modos, y la diferencia importa:
            //  · ChannelIdentification — el audio YA trae una persona por canal
            //    (grabación telefónica dual). Exacto: no se infiere nada, y
            //    quien llama sabe qué canal es quién.
            //  · ShowSpeakerLabels — un solo canal mezclado (el navegador).
            //    Transcribe separa las voces, pero no sabe cuál es cuál.
            Settings: opts.canales
              ? { ChannelIdentification: true }
              : { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
          })
        );
      } catch (err: any) {
        if (err?.name !== 'ConflictException') {
          return { status: 'failed', reason: err?.message || 'StartTranscriptionJob falló' };
        }
      }
      return { status: 'in_progress' };
    }
    return this.leerJob(job, opts.canales);
  }

  async getOrStartTranscription(roomName: string): Promise<TranscribeResult> {
    if (!BUCKET) return { status: 'failed', reason: 'RECORDINGS_BUCKET no configurado' };
    const jobName = this.jobName(roomName);

    // ¿Ya existe un job para esta sala?
    let job;
    try {
      const got = await this.client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
      );
      job = got.TranscriptionJob;
    } catch {
      job = undefined; // BadRequest/NotFound → no existe todavía
    }

    if (!job) {
      // No hay job: arrancarlo si el MP4 ya está en S3.
      const rec = await chimeRecordingService.getRecordingS3Uri(roomName);
      if (!rec || !rec.s3Uri) {
        // Sin registro, o la concatenación aún no escribió el MP4.
        return { status: 'no_recording' };
      }
      try {
        await this.client.send(
          new StartTranscriptionJobCommand({
            TranscriptionJobName: jobName,
            LanguageCode: LANGUAGE as any,
            MediaFormat: 'mp4',
            Media: { MediaFileUri: rec.s3Uri },
            // Separación de hablantes: en una consulta son 2 (médico y paciente).
            // Le da al evaluador quién dijo qué, algo que Whisper no hace.
            Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
            // SIN OutputBucketName: Transcribe guarda el resultado en su bucket y
            // devuelve una URL prefirmada → no hacen falta permisos S3 de salida.
          })
        );
      } catch (err: any) {
        // Si otro request lo arrancó primero (carrera), no es error.
        if (err?.name !== 'ConflictException') {
          return { status: 'failed', reason: err?.message || 'StartTranscriptionJob falló' };
        }
      }
      return { status: 'in_progress' };
    }

    return this.leerJob(job);
  }

  /** Estado de un job existente → resultado uniforme para los dos caminos. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async leerJob(
    job: any,
    canales?: { ch0: string; ch1: string }
  ): Promise<TranscribeResult> {
    const s = job.TranscriptionJobStatus;
    if (s === 'QUEUED' || s === 'IN_PROGRESS') return { status: 'in_progress' };
    if (s === 'FAILED') return { status: 'failed', reason: job.FailureReason || 'Transcribe FAILED' };

    if (s === 'COMPLETED') {
      const uri = job.Transcript?.TranscriptFileUri;
      if (!uri) return { status: 'failed', reason: 'Job completado sin TranscriptFileUri' };
      try {
        const transcript = await this.fetchTranscript(uri, canales);
        return { status: 'completed', transcript };
      } catch (err: any) {
        return { status: 'failed', reason: `No se pudo leer el transcript: ${err?.message}` };
      }
    }

    return { status: 'in_progress' };
  }

  /**
   * Descarga el JSON de Transcribe (URL prefirmada) y lo convierte en texto
   * legible con turnos por hablante si hay diarización.
   */
  private async fetchTranscript(
    uri: string,
    canales?: { ch0: string; ch1: string }
  ): Promise<string> {
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar el transcript`);
    const data: any = await resp.json();

    const items: any[] = data?.results?.items || [];
    const speakerSegments: any[] = data?.results?.speaker_labels?.segments || [];

    // Por CANAL: cada persona en su propio canal, así que la atribución es
    // exacta y con nombre real (Coach / Paciente), no "Hablante 1 / 2".
    const channels: any[] = data?.results?.channel_labels?.channels || [];
    if (canales && channels.length) {
      const nombreDe = (label: string) =>
        label === 'ch_0' ? canales.ch0 : label === 'ch_1' ? canales.ch1 : label;
      // Cada canal trae sus palabras con tiempo; se intercalan por tiempo para
      // reconstruir la conversación en el orden en que ocurrió.
      const palabras: Array<{ t: number; quien: string; texto: string; punt: boolean }> = [];
      for (const ch of channels) {
        const quien = nombreDe(ch.channel_label);
        let ultimoT = 0;
        for (const it of ch.items || []) {
          const content = it.alternatives?.[0]?.content;
          if (!content) continue;
          const esPunt = it.type === 'punctuation';
          const t = esPunt ? ultimoT : parseFloat(it.start_time);
          if (!esPunt) ultimoT = t;
          palabras.push({ t, quien, texto: content, punt: esPunt });
        }
      }
      palabras.sort((a, b) => a.t - b.t);
      return this.agrupar(palabras);
    }

    // Sin diarización ni canales: devolver el transcript plano.
    if (!speakerSegments.length) {
      return data?.results?.transcripts?.[0]?.transcript || '';
    }

    // Con diarización: agrupar palabras por turno de hablante en orden temporal.
    const labelForTime = (t: number): string => {
      for (const seg of speakerSegments) {
        if (t >= parseFloat(seg.start_time) && t <= parseFloat(seg.end_time)) return seg.speaker_label;
      }
      return 'spk';
    };

    const lines: string[] = [];
    let current: string | null = null;
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length) lines.push(`${current}: ${buffer.join(' ').replace(/\s+([.,?!])/g, '$1')}`);
      buffer = [];
    };

    for (const it of items) {
      const content = it.alternatives?.[0]?.content;
      if (!content) continue;
      if (it.type === 'punctuation') {
        if (buffer.length) buffer[buffer.length - 1] += content;
        continue;
      }
      const spk = labelForTime(parseFloat(it.start_time));
      if (spk !== current) {
        flush();
        current = spk;
      }
      buffer.push(content);
    }
    flush();

    // Renombrar spk_0/spk_1 a algo legible (no sabemos quién es quién con certeza).
    return lines
      .map((l) => l.replace(/^spk_0:/, 'Hablante 1:').replace(/^spk_1:/, 'Hablante 2:'))
      .join('\n');
  }

  /** Palabras ya ordenadas por tiempo → turnos "Quien: texto". */
  private agrupar(palabras: Array<{ quien: string; texto: string; punt: boolean }>): string {
    const lines: string[] = [];
    let actual: string | null = null;
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length) lines.push(`${actual}: ${buffer.join(' ').replace(/\s+([.,?!])/g, '$1')}`);
      buffer = [];
    };
    for (const p of palabras) {
      if (p.punt) {
        if (buffer.length) buffer[buffer.length - 1] += p.texto;
        continue;
      }
      if (p.quien !== actual) {
        flush();
        actual = p.quien;
      }
      buffer.push(p.texto);
    }
    flush();
    return lines.join('\n');
  }
}

export const transcribeService = new TranscribeService();
