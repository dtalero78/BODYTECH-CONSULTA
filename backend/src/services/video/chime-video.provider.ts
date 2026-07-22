/**
 * Provider de video basado en Amazon Chime SDK.
 *
 * Credenciales: el SDK toma AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY del entorno
 * (BODYTECH corre en DigitalOcean, sin rol IAM).
 *
 * El mapa roomName → Meeting se persiste en Postgres (`chime_meetings`), NO solo
 * en memoria: el contenedor se reinicia en cada despliegue (DO auto-despliega en
 * cada push) y una sala en curso debe sobrevivir a eso. TODOS los métodos que
 * necesitan el meeting lo resuelven con `resolveMeeting()` (memoria → BD), de modo
 * que endRoom cierra bien la grabación aunque la memoria se haya perdido.
 */
import crypto from 'crypto';
import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  GetMeetingCommand,
  DeleteMeetingCommand,
  ListAttendeesCommand,
  DeleteAttendeeCommand,
  Meeting,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  IVideoProvider,
  JoinInfo,
  RoomInfo,
  ParticipantInfo,
  RoomCompletedError,
} from './types';
import { chimeRecordingService } from './chime-recording.service';
import postgresService from '../postgres.service';

// Región del plano de control de Chime (endpoints regionales limitados).
const CONTROL_REGION = process.env.CHIME_CONTROL_REGION || 'us-east-1';
// Región donde se hospeda el media (puede ser distinta; Chime elige la más cercana).
const MEDIA_REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';
// Cuánto tiempo se bloquea el reingreso a una sala tras finalizarla.
const ENDED_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function sanitizeExternalUserId(identity: string): string {
  // Chime ExternalUserId: 2-64 chars. Recortamos y garantizamos longitud mínima.
  const cleaned = (identity || 'user').trim().slice(0, 64);
  return cleaned.length >= 2 ? cleaned : `u-${cleaned}`;
}

export class ChimeVideoProvider implements IVideoProvider {
  readonly name = 'chime' as const;
  private client = new ChimeSDKMeetingsClient({ region: CONTROL_REGION });
  private meetings = new Map<string, Meeting>(); // roomName -> Meeting (caché)
  private ended = new Map<string, number>(); // roomName -> endedAt (ms)
  private tableReady: Promise<void> | null = null;

  private isEnded(roomName: string): boolean {
    const t = this.ended.get(roomName);
    if (!t) return false;
    if (Date.now() - t > ENDED_TTL_MS) {
      this.ended.delete(roomName);
      return false;
    }
    return true;
  }

  /** Devuelve el meeting si sigue vivo en Chime; null si ya no existe. */
  private async fetchMeeting(meetingId: string): Promise<Meeting | null> {
    try {
      const got = await this.client.send(new GetMeetingCommand({ MeetingId: meetingId }));
      return got.Meeting || null;
    } catch {
      return null;
    }
  }

  /**
   * El mapa sala → meeting se guarda TAMBIÉN en Postgres. Si vive sólo en
   * memoria, cada reinicio de la tarea (un despliegue, un crash) lo borra y el
   * siguiente en entrar crea una reunión NUEVA para la misma sala: el médico
   * queda en una y el paciente en otra, se ven "solos" y hay que volver a
   * entrar. Los fallos de BD no rompen el video: se degrada a sólo memoria.
   */
  private async ensureMeetingsTable(): Promise<void> {
    if (!this.tableReady) {
      this.tableReady = postgresService
        .query(
          `CREATE TABLE IF NOT EXISTS chime_meetings (
             room_name  TEXT PRIMARY KEY,
             meeting_id TEXT NOT NULL,
             created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
           )`
        )
        .then(() => undefined)
        .catch((err: any) => {
          this.tableReady = null;
          throw err;
        });
    }
    return this.tableReady;
  }

  private async recallMeetingId(roomName: string): Promise<string | null> {
    try {
      await this.ensureMeetingsTable();
      const r = await postgresService.query(
        `SELECT meeting_id FROM chime_meetings WHERE room_name = $1 LIMIT 1`,
        [roomName]
      );
      return r?.[0]?.meeting_id || null;
    } catch (err: any) {
      console.warn(`[Chime] no se pudo leer chime_meetings: ${err?.message}`);
      return null;
    }
  }

  private async rememberMeetingId(roomName: string, meetingId: string): Promise<void> {
    try {
      await this.ensureMeetingsTable();
      await postgresService.query(
        `INSERT INTO chime_meetings (room_name, meeting_id) VALUES ($1, $2)
         ON CONFLICT (room_name) DO UPDATE SET meeting_id = EXCLUDED.meeting_id, created_at = NOW()`,
        [roomName, meetingId]
      );
    } catch (err: any) {
      console.warn(`[Chime] no se pudo guardar chime_meetings: ${err?.message}`);
    }
  }

  private async forgetMeetingId(roomName: string): Promise<void> {
    try {
      await postgresService.query(`DELETE FROM chime_meetings WHERE room_name = $1`, [roomName]);
    } catch {
      /* no crítico */
    }
  }

  /**
   * Resuelve el meeting VIVO de una sala sin crearlo: memoria → BD. Devuelve null
   * si la sala no tiene meeting o si ya murió en Chime. Es la clave del arreglo
   * §5.1.b: endRoom / startRecording / participantes funcionan aunque el
   * contenedor se haya reiniciado y la memoria esté vacía.
   */
  private async resolveMeeting(roomName: string): Promise<Meeting | null> {
    const cached = this.meetings.get(roomName);
    if (cached?.MeetingId) {
      const live = await this.fetchMeeting(cached.MeetingId);
      if (live) return live;
      this.meetings.delete(roomName);
    }
    const persistedId = await this.recallMeetingId(roomName);
    if (persistedId) {
      const live = await this.fetchMeeting(persistedId);
      if (live) {
        this.meetings.set(roomName, live);
        return live;
      }
      await this.forgetMeetingId(roomName);
    }
    return null;
  }

  /** Reutiliza el meeting vigente para la sala, o crea uno nuevo. */
  private async ensureMeeting(roomName: string): Promise<Meeting> {
    const existing = await this.resolveMeeting(roomName);
    if (existing) return existing;

    const created = await this.client.send(
      new CreateMeetingCommand({
        ClientRequestToken: crypto.randomUUID(),
        MediaRegion: MEDIA_REGION,
        ExternalMeetingId: roomName.slice(0, 64),
      })
    );
    if (!created.Meeting) throw new Error('Chime CreateMeeting no devolvió Meeting');
    this.meetings.set(roomName, created.Meeting);
    await this.rememberMeetingId(roomName, created.Meeting.MeetingId!);
    console.log(`[Chime] Meeting creado para sala ${roomName}: ${created.Meeting.MeetingId}`);

    // NOTA: la grabación NO se arranca aquí. Si el Media Capture Pipeline se une
    // mientras los clientes establecen su video, la señalización se satura
    // (Batch timing timeout) y el video no se renderiza (peor en móvil). Se
    // arranca en startRecording() cuando ambos ya están conectados.

    return created.Meeting;
  }

  async join({
    identity,
    roomName,
    role,
  }: { identity: string; roomName: string; role?: 'doctor' | 'patient' }): Promise<JoinInfo> {
    // El médico SIEMPRE puede reingresar, y al hacerlo REABRE la sala (borra la
    // marca de finalizada) para que su paciente también pueda volver a entrar.
    // Antes, cualquier desconexión del médico —recargar la página, una caída de
    // red, cerrar la pestaña por error— marcaba la sala como finalizada y la
    // dejaba inutilizable durante ENDED_TTL_MS (6h): al volver recibía
    // "Esta videollamada ya finalizó y no se puede volver a ingresar".
    if (role === 'doctor') {
      if (this.ended.delete(roomName)) {
        console.log(`[Chime] Sala ${roomName} reabierta por el médico (${identity})`);
      }
    } else if (this.isEnded(roomName)) {
      console.log(`[Video] Reingreso rechazado: sala ${roomName} finalizada (${identity}, role=${role})`);
      throw new RoomCompletedError();
    }

    const meeting = await this.ensureMeeting(roomName);
    const att = await this.client.send(
      new CreateAttendeeCommand({
        MeetingId: meeting.MeetingId!,
        ExternalUserId: sanitizeExternalUserId(identity),
      })
    );

    return { provider: 'chime', identity, roomName, meeting, attendee: att.Attendee };
  }

  async getRoom(roomName: string): Promise<RoomInfo | null> {
    const meeting = await this.resolveMeeting(roomName);
    if (meeting?.MeetingId) {
      return { id: meeting.MeetingId, name: roomName, status: 'in-progress', raw: meeting };
    }
    return this.isEnded(roomName)
      ? { id: roomName, name: roomName, status: 'completed' }
      : null;
  }

  async createRoom(roomName: string): Promise<RoomInfo> {
    const m = await this.ensureMeeting(roomName);
    return { id: m.MeetingId!, name: roomName, status: 'in-progress', raw: m };
  }

  /**
   * `completed: false` limpia el meeting y cierra la grabación PERO no marca la
   * sala como finalizada, así que se puede volver a entrar con el mismo link.
   * Es lo que corresponde cuando el médico simplemente se desconecta (recarga,
   * se le cae la red, cierra sin querer): dar por terminada la consulta ahí
   * dejaba al paciente fuera de su propia cita —con el link ya enviado— y
   * obligaba a generar una sala nueva. Sólo colgar a propósito la finaliza.
   */
  async endRoom(roomName: string, opts?: { completed?: boolean }): Promise<{ id: string; status: string }> {
    const markCompleted = opts?.completed !== false;

    // Resolver el meetingId SIN exigir que la reunión siga viva en Chime: si ya
    // expiró, igual hay que concatenar la grabación. (Usar resolveMeeting aquí
    // era un error: verifica liveness y devolvía null para reuniones muertas →
    // la captura quedaba en 'capturing' para siempre y el MP4 nunca salía.)
    // Cadena de respaldo: memoria → tabla persistida → grabación aún capturando.
    let meetingId = this.meetings.get(roomName)?.MeetingId || null;
    if (!meetingId) meetingId = await this.recallMeetingId(roomName);
    if (!meetingId) meetingId = await chimeRecordingService.getCapturingMeetingId(roomName);

    // Idempotente: se limpia el estado ANTES de los await, para que una segunda
    // llamada (colgar + beforeunload) no repita el trabajo. La concatenación
    // además tiene su propio claim atómico en BD.
    this.meetings.delete(roomName);
    await this.forgetMeetingId(roomName);

    if (meetingId) {
      await chimeRecordingService.stopAndConcatenate(meetingId);
      try {
        await this.client.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
      } catch (err: any) {
        console.warn(`[Chime] endRoom: no se pudo borrar el meeting ${meetingId}: ${err?.message}`);
      }
    }

    if (markCompleted) this.ended.set(roomName, Date.now());
    return { id: meetingId || roomName, status: markCompleted ? 'completed' : 'disconnected' };
  }

  async listParticipants(roomName: string): Promise<ParticipantInfo[]> {
    const meeting = await this.resolveMeeting(roomName);
    if (!meeting?.MeetingId) return [];
    const res = await this.client.send(new ListAttendeesCommand({ MeetingId: meeting.MeetingId }));
    return (res.Attendees || []).map((a) => ({
      id: a.AttendeeId!,
      identity: a.ExternalUserId || '',
    }));
  }

  async disconnectParticipant(roomName: string, participantId: string): Promise<{ id: string; status: string }> {
    const meeting = await this.resolveMeeting(roomName);
    if (meeting?.MeetingId) {
      await this.client.send(
        new DeleteAttendeeCommand({ MeetingId: meeting.MeetingId, AttendeeId: participantId })
      );
    }
    return { id: participantId, status: 'disconnected' };
  }

  async enableRecording(_roomName: string): Promise<boolean> {
    // Grabación server-side se maneja vía startRecording (Media Capture Pipeline).
    return false;
  }

  /**
   * Arranca la captura del meeting (Media Capture Pipeline → S3). Se invoca
   * cuando ambos participantes ya están conectados. Idempotente (el servicio
   * verifica en BD que no exista ya una captura para el meeting). Resuelve el
   * meeting desde memoria O BD para sobrevivir a reinicios.
   */
  async startRecording(roomName: string): Promise<void> {
    const meeting = await this.resolveMeeting(roomName);
    if (meeting) {
      await chimeRecordingService.startCapture(roomName, meeting);
    }
  }
}
