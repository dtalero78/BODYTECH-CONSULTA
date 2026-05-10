import twilio from 'twilio';
import twilioConfig from '../config/twilio.config';

const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

interface TokenOptions {
  identity: string;
  roomName: string;
}

interface TokenResponse {
  token: string;
  identity: string;
  roomName: string;
}

class TwilioService {
  private client: twilio.Twilio;

  constructor() {
    this.client = twilio(
      twilioConfig.accountSid,
      twilioConfig.authToken
    );
  }

  /**
   * Genera un Access Token para Twilio Video
   * @param identity - Identificador único del usuario
   * @param roomName - Nombre de la sala de video
   * @returns Token de acceso para conectarse a la sala
   */
  generateVideoToken({ identity, roomName }: TokenOptions): TokenResponse {
    // Crear Access Token
    const token = new AccessToken(
      twilioConfig.accountSid,
      twilioConfig.apiKeySid,
      twilioConfig.apiKeySecret,
      {
        identity,
        ttl: 3600, // Token válido por 1 hora
      }
    );

    // Crear Video Grant
    const videoGrant = new VideoGrant({
      room: roomName,
    });

    // Agregar el grant al token
    token.addGrant(videoGrant);

    return {
      token: token.toJwt(),
      identity,
      roomName,
    };
  }

  /**
   * Crear una sala de video en Twilio
   *
   * Phase 3 — Transcripción post-llamada:
   * - Default cambia de 'go' a 'group-small' para soportar grabación.
   *   Twilio sólo permite `recordParticipantsOnConnect` en rooms type
   *   `group` / `group-small`. `peer-to-peer` y `go` NO graban.
   * - `maxParticipants` se ajusta al límite de cada tipo.
   *
   * @param roomName - Nombre único de la sala
   * @param type - Tipo de sala (group, peer-to-peer, group-small, go)
   * @returns Información de la sala creada
   */
  async createRoom(
    roomName: string,
    type: 'group' | 'peer-to-peer' | 'group-small' | 'go' = 'group-small'
  ) {
    try {
      // maxParticipants: peer-to-peer = 2, group-small = 4, group/go = 50.
      const maxParticipants =
        type === 'peer-to-peer' ? 2 : type === 'group-small' ? 4 : 50;

      // Sólo activar recording en rooms tipo group / group-small (Twilio rechaza
      // recordParticipantsOnConnect=true en go / peer-to-peer).
      const recordParticipantsOnConnect =
        type === 'group' || type === 'group-small';

      const room = await this.client.video.v1.rooms.create({
        uniqueName: roomName,
        type,
        maxParticipants,
        recordParticipantsOnConnect,
      });

      return {
        sid: room.sid,
        uniqueName: room.uniqueName,
        status: room.status,
        type: room.type,
        maxParticipants: room.maxParticipants,
        dateCreated: room.dateCreated,
      };
    } catch (error) {
      console.error('Error creating room:', error);
      throw error;
    }
  }

  /**
   * Obtener información de una sala existente
   * @param roomSidOrUniqueName - SID o nombre único de la sala
   */
  async getRoom(roomSidOrUniqueName: string) {
    try {
      const room = await this.client.video.v1.rooms(roomSidOrUniqueName).fetch();

      return {
        sid: room.sid,
        uniqueName: room.uniqueName,
        status: room.status,
        type: room.type,
        maxParticipants: room.maxParticipants,
        duration: room.duration,
        dateCreated: room.dateCreated,
      };
    } catch (error) {
      console.error('Error fetching room:', error);
      throw error;
    }
  }

  /**
   * Finalizar una sala de video
   * @param roomSidOrUniqueName - SID o nombre único de la sala
   */
  async endRoom(roomSidOrUniqueName: string) {
    try {
      const room = await this.client.video.v1
        .rooms(roomSidOrUniqueName)
        .update({ status: 'completed' });

      return {
        sid: room.sid,
        status: room.status,
      };
    } catch (error) {
      console.error('Error ending room:', error);
      throw error;
    }
  }

  /**
   * Listar participantes de una sala
   * @param roomSidOrUniqueName - SID o nombre único de la sala
   */
  async listParticipants(roomSidOrUniqueName: string) {
    try {
      const participants = await this.client.video.v1
        .rooms(roomSidOrUniqueName)
        .participants.list();

      return participants.map((participant) => ({
        sid: participant.sid,
        identity: participant.identity,
        status: participant.status,
        startTime: participant.startTime,
        duration: participant.duration,
      }));
    } catch (error) {
      console.error('Error listing participants:', error);
      throw error;
    }
  }

  /**
   * Desconectar un participante de una sala
   * @param roomSidOrUniqueName - SID o nombre único de la sala
   * @param participantSid - SID del participante
   */
  async disconnectParticipant(
    roomSidOrUniqueName: string,
    participantSid: string
  ) {
    try {
      const participant = await this.client.video.v1
        .rooms(roomSidOrUniqueName)
        .participants(participantSid)
        .update({ status: 'disconnected' });

      return {
        sid: participant.sid,
        status: participant.status,
      };
    } catch (error) {
      console.error('Error disconnecting participant:', error);
      throw error;
    }
  }

  /**
   * Crear una Composition de Twilio Video para una sala completada.
   * Combina todos los tracks de audio y video en un único archivo mp4.
   *
   * @param roomSid - SID de la sala (RMxxx), no el uniqueName
   * @returns sid, status y roomSid de la composition creada
   */
  async createComposition(
    roomSid: string
  ): Promise<{ sid: string; status: string; roomSid: string }> {
    const composition = await this.client.video.v1.compositions.create({
      roomSid,
      audioSources: ['*'],
      videoLayout: { grid: { video_sources: ['*'] } },
      format: 'mp4',
      resolution: '640x480',
    });

    return {
      sid: composition.sid,
      status: composition.status,
      roomSid: composition.roomSid ?? roomSid,
    };
  }
}

export default new TwilioService();
