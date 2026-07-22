/**
 * Provider de video basado en Twilio Video.
 *
 * Envuelve el `twilioService` existente SIN duplicar ni cambiar su lógica: con
 * VIDEO_PROVIDER en twilio (default) el comportamiento queda idéntico al de hoy.
 * A diferencia de Chime, aquí la grabación se activa al crear la sala
 * (recordParticipantsOnConnect) y la composición la crea el webhook; por eso
 * enableRecording/startRecording no tienen trabajo real que hacer.
 */
import twilioService from '../twilio.service';
import {
  IVideoProvider,
  JoinInfo,
  RoomInfo,
  ParticipantInfo,
} from './types';

export class TwilioVideoProvider implements IVideoProvider {
  readonly name = 'twilio' as const;

  async join({
    identity,
    roomName,
  }: { identity: string; roomName: string; role?: 'doctor' | 'patient' }): Promise<JoinInfo> {
    // Misma secuencia que tenía el controlador: pre-crear la sala (group con
    // recordParticipantsOnConnect) ignorando 53113 "ya existe", y generar token.
    try {
      await twilioService.createRoom(roomName);
      console.log(`Room created (group with recording): ${roomName}`);
    } catch (error: any) {
      if (error?.code === 53113) {
        console.log(`Room already exists: ${roomName}`);
      } else {
        console.warn(`Could not create room, will use existing: ${error?.message}`);
      }
    }

    const tokenData = twilioService.generateVideoToken({ identity, roomName });
    return { provider: 'twilio', identity, roomName, token: tokenData.token };
  }

  async getRoom(roomName: string): Promise<RoomInfo | null> {
    try {
      const r = await twilioService.getRoom(roomName);
      return { id: r.sid, name: r.uniqueName, status: r.status, raw: r };
    } catch {
      return null;
    }
  }

  async createRoom(roomName: string): Promise<RoomInfo> {
    const r = await twilioService.createRoom(roomName);
    return { id: r.sid, name: r.uniqueName, status: r.status, raw: r };
  }

  async endRoom(roomName: string, opts?: { completed?: boolean }): Promise<{ id: string; status: string }> {
    // `completed: false` = desconexión cualquiera (no colgar): NO se cierra la
    // sala en Twilio, para que el paciente pueda volver con el mismo link.
    // Coincide con el comportamiento de hoy, donde solo el botón de colgar
    // (POST /rooms/:roomName/end, sin opts) finaliza la sala.
    if (opts?.completed === false) {
      return { id: roomName, status: 'disconnected' };
    }
    const r = await twilioService.endRoom(roomName);
    return { id: r.sid, status: r.status };
  }

  async listParticipants(roomName: string): Promise<ParticipantInfo[]> {
    const ps = await twilioService.listParticipants(roomName);
    return ps.map((p) => ({
      id: p.sid,
      identity: p.identity,
      status: p.status,
      startTime: p.startTime,
      duration: p.duration,
    }));
  }

  async disconnectParticipant(roomName: string, participantId: string): Promise<{ id: string; status: string }> {
    const r = await twilioService.disconnectParticipant(roomName, participantId);
    return { id: r.sid, status: r.status };
  }

  // La grabación de Twilio ya queda activa al crear la sala
  // (recordParticipantsOnConnect=true en createRoom). No hay que activarla aparte.
  async enableRecording(_roomName: string): Promise<boolean> {
    return true;
  }

  // Twilio no usa este disparador (graba desde que el participante conecta). No-op.
  async startRecording(_roomName: string): Promise<void> {
    /* no-op para Twilio */
  }
}
