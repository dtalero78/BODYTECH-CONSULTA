/**
 * Utilidades compartidas para acceder al MP4 de una Twilio Composition.
 *
 * Originalmente vivían dentro de `calidad.service.ts`; las muevo acá para
 * que `transcription.service.ts` pueda reusarlas cuando dispare la
 * transcripción desde el webhook de composition-status.
 *
 * Nada de esto modifica la base de datos — son operaciones de I/O contra
 * Twilio + ffmpeg.
 */

import axios from 'axios';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { readFile, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Resuelve la URL pre-firmada del MP4 desde Twilio Compositions.
 * Twilio responde con 302 → Location = URL de S3 con TTL.
 *
 * @param compositionSid Sid de la composition (CJ…)
 * @param ttlSeconds     TTL para la URL pre-firmada (default 3600 = 1h)
 */
export async function obtenerUrlMediaTwilio(
  compositionSid: string,
  ttlSeconds = 3600,
): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN no configurados');
  }

  const url = `https://video.twilio.com/v1/Compositions/${encodeURIComponent(
    compositionSid,
  )}/Media?Ttl=${ttlSeconds}`;

  let response;
  try {
    response = await axios.get(url, {
      auth: { username: accountSid, password: authToken },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
    });
  } catch (err: unknown) {
    // axios lanza cuando maxRedirects=0 y recibe un 3xx
    if (
      axios.isAxiosError(err) &&
      err.response &&
      (err.response.status === 302 ||
        err.response.status === 301 ||
        err.response.status === 307)
    ) {
      const location = err.response.headers['location'];
      if (location) return location as string;
    }
    throw err;
  }

  if (
    response.status === 302 ||
    response.status === 301 ||
    response.status === 307
  ) {
    const location = response.headers['location'];
    if (location) return location as string;
    throw new Error('Twilio no devolvió header Location en la respuesta de Media');
  }

  if (response.status === 200 && response.data) {
    const body = response.data as Record<string, string>;
    if (body.redirect_to || body.url) return body.redirect_to || body.url;
  }

  throw new Error(
    `Twilio devolvió status ${response.status} al solicitar el Media de la composición.`,
  );
}

/**
 * Descarga el MP4 desde la URL pre-firmada y devuelve un Buffer en RAM.
 * Para consultas médicas (≤ ~200 MB) esto es viable; para audio extraído
 * con `extraerAudio` se transforma a MP3 mono 16 kHz (~2-5 MB).
 */
export async function descargarMp4ComoBuffer(url: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    maxRedirects: 5,
    timeout: 300_000, // 5 minutos
  });
  return Buffer.from(response.data);
}

/**
 * Extrae la pista de audio de un buffer MP4 usando ffmpeg (archivos temporales).
 * El MP4 requiere seeking para leer el átomo moov, así que no funciona con pipe stdin.
 * Salida: MP3 mono 16 kHz 64 kbps (~2-5 MB para una consulta de 30-40 min).
 *
 * Indispensable para Whisper, que tiene límite de 25 MB por archivo y el MP4
 * crudo de una consulta de 10 min ya pesa ~80 MB.
 */
export async function extraerAudio(mp4Buffer: Buffer): Promise<Buffer> {
  const id = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `twilio-media-${id}.mp4`);
  const outputPath = join(tmpdir(), `twilio-media-${id}.mp3`);

  try {
    await writeFile(inputPath, mp4Buffer);

    await new Promise<void>((resolve, reject) => {
      const stderrChunks: Buffer[] = [];
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-map', '0:a',
        '-acodec', 'libmp3lame',
        '-ar', '16000',
        '-ac', '1',
        '-b:a', '64k',
        '-y',
        outputPath,
      ]);

      ffmpeg.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      ffmpeg.on('error', (err: Error) =>
        reject(new Error(`Error al iniciar ffmpeg: ${err.message}`)),
      );
      ffmpeg.on('close', (code: number | null) => {
        if (code !== 0) {
          const errMsg = Buffer.concat(stderrChunks).toString('utf8').slice(-2000);
          reject(new Error(`ffmpeg salió con código ${code}: ${errMsg}`));
        } else {
          resolve();
        }
      });
    });

    const audioBuffer = await readFile(outputPath);
    if (audioBuffer.length === 0) {
      throw new Error('ffmpeg produjo archivo de audio vacío');
    }
    return audioBuffer;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
