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
   * Crear una sala de video en Twilio.
   * Twilio deprecó group-small (error 53126) — usar group siempre.
   * Solo group admite recordParticipantsOnConnect=true.
   *
   * @param roomName - Nombre único de la sala
   * @param type - Tipo de sala ('group' | 'peer-to-peer')
   * @returns Información de la sala creada
   */
  async createRoom(
    roomName: string,
    type: 'group' | 'peer-to-peer' = 'group'
  ) {
    try {
      const maxParticipants = type === 'peer-to-peer' ? 2 : 50;
      const recordParticipantsOnConnect = type === 'group';

      const baseUrl = process.env.BASE_URL || '';
      const statusCallback = baseUrl
        ? `${baseUrl}/api/video/webhooks/room-completed`
        : undefined;

      const room = await this.client.video.v1.rooms.create({
        uniqueName: roomName,
        type,
        maxParticipants,
        recordParticipantsOnConnect,
        ...(statusCallback && { statusCallback, statusCallbackMethod: 'POST' }),
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
   * Finalizar una sala de video (status=completed).
   *
   * NO crea la composición: el ÚNICO creador es el webhook `room-completed`
   * (ver VideoController.roomCompletedWebhook). Antes endRoom también la creaba
   * y competía con el webhook — por la consistencia eventual del listado de
   * Twilio, ambos terminaban creando una composición → se generaban DOS por
   * llamada (doble facturación). Al cerrar el room aquí, Twilio dispara el
   * webhook, que crea una sola.
   *
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
    const baseUrl = process.env.BASE_URL || '';
    const statusCallback = baseUrl
      ? `${baseUrl}/api/video/webhooks/composition-status`
      : undefined;

    const composition = await this.client.video.v1.compositions.create({
      roomSid,
      audioSources: ['*'],
      videoLayout: { grid: { video_sources: ['*'] } },
      format: 'mp4',
      // 480x360: ~50% del peso de 640x480 manteniendo legibilidad para
      // revisión visual posterior (postura, examen, expresiones). Ahorra
      // ~$0.20/llamada en composition-minutes según Twilio Usage Records.
      resolution: '480x360',
      ...(statusCallback && { statusCallback, statusCallbackMethod: 'POST' }),
    });

    return {
      sid: composition.sid,
      status: composition.status,
      roomSid: composition.roomSid ?? roomSid,
    };
  }

  /** Devuelve true si ya existe al menos una composición para el roomSid dado. */
  async roomHasComposition(roomSid: string): Promise<boolean> {
    const list = await this.client.video.v1.compositions.list({ roomSid, limit: 1 });
    return list.length > 0;
  }

  /**
   * Devuelve el SID de la composición más reciente de un room, priorizando una
   * 'completed'. Útil para backfill cuando el composition_sid no quedó guardado
   * en la HistoriaClinica. Retorna null si el room no tiene composiciones.
   */
  async getLatestCompositionSid(roomSid: string): Promise<string | null> {
    const list = await this.client.video.v1.compositions.list({ roomSid, limit: 20 });
    if (list.length === 0) return null;
    const completed = list.find((c) => c.status === 'completed');
    return (completed ?? list[0]).sid;
  }

  /**
   * Resuelve el SID (RMxxx) de una sala a partir de su uniqueName (room_name).
   * La API de Twilio acepta el uniqueName donde espera un roomSid.
   */
  async getRoomSidByName(roomName: string): Promise<string> {
    const room = await this.client.video.v1.rooms(roomName).fetch();
    return room.sid;
  }

  /**
   * Estado actual de una composición ('enqueued' | 'processing' | 'completed'
   * | 'failed' | 'deleted'). Usado por Calidad para saber si el MP4 ya está
   * listo para reproducir/evaluar (composición on-demand).
   */
  async getCompositionStatus(compositionSid: string): Promise<string> {
    const comp = await this.client.video.v1.compositions(compositionSid).fetch();
    return comp.status;
  }
}

export default new TwilioService();
