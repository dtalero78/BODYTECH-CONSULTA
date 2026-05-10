import { Request, Response } from 'express';
import twilio from 'twilio';
import twilioService from '../services/twilio.service';
import { sessionTracker } from '../services/session-tracker.service';
import whatsappService from '../services/whatsapp.service';
import medicalHistoryService from '../services/medical-history.service';
import openaiService from '../services/openai.service';
import postgresService from '../services/postgres.service';
import transcriptionService from '../services/transcription.service';

class VideoController {
  /**
   * Generar token de acceso para una sala de video
   * POST /api/video/token
   * Body: { identity: string, roomName: string }
   */
  async generateToken(req: Request, res: Response): Promise<void> {
    try {
      const { identity, roomName } = req.body;

      if (!identity || !roomName) {
        res.status(400).json({
          error: 'Identity and roomName are required',
        });
        return;
      }

      // Phase 3 — usar el default 'group-small' del service para habilitar
      // grabación por participante (recordParticipantsOnConnect). 'go' no
      // soporta recording rules en Twilio.
      try {
        await twilioService.createRoom(roomName);
        console.log(`Room created (group-small with recording): ${roomName}`);
      } catch (error: any) {
        // Si la sala ya existe, continuar (error code 53113)
        if (error.code === 53113) {
          console.log(`Room already exists: ${roomName}`);
        } else {
          // Otro error, pero no bloqueamos la generación del token
          console.warn(`Could not create room, will use existing: ${error.message}`);
        }
      }

      const tokenData = twilioService.generateVideoToken({
        identity,
        roomName,
      });

      res.status(200).json({
        success: true,
        data: tokenData,
      });
    } catch (error) {
      console.error('Error generating token:', error);
      res.status(500).json({
        error: 'Failed to generate token',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Crear una nueva sala de video
   * POST /api/video/rooms
   * Body: { roomName: string, type?: 'group' | 'peer-to-peer' | 'group-small' }
   */
  async createRoom(req: Request, res: Response): Promise<void> {
    try {
      const { roomName, type } = req.body;

      if (!roomName) {
        res.status(400).json({
          error: 'roomName is required',
        });
        return;
      }

      const room = await twilioService.createRoom(roomName, type);

      res.status(201).json({
        success: true,
        data: room,
      });
    } catch (error) {
      console.error('Error creating room:', error);
      res.status(500).json({
        error: 'Failed to create room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Obtener información de una sala
   * GET /api/video/rooms/:roomName
   */
  async getRoom(req: Request, res: Response): Promise<void> {
    try {
      const { roomName } = req.params;

      const room = await twilioService.getRoom(roomName);

      res.status(200).json({
        success: true,
        data: room,
      });
    } catch (error) {
      console.error('Error fetching room:', error);
      res.status(500).json({
        error: 'Failed to fetch room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Finalizar una sala de video
   * POST /api/video/rooms/:roomName/end
   */
  async endRoom(req: Request, res: Response): Promise<void> {
    try {
      const { roomName } = req.params;

      const room = await twilioService.endRoom(roomName);

      res.status(200).json({
        success: true,
        data: room,
      });
    } catch (error) {
      console.error('Error ending room:', error);
      res.status(500).json({
        error: 'Failed to end room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Listar participantes de una sala
   * GET /api/video/rooms/:roomName/participants
   */
  async listParticipants(req: Request, res: Response): Promise<void> {
    try {
      const { roomName } = req.params;

      const participants = await twilioService.listParticipants(roomName);

      res.status(200).json({
        success: true,
        data: participants,
      });
    } catch (error) {
      console.error('Error listing participants:', error);
      res.status(500).json({
        error: 'Failed to list participants',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Desconectar un participante
   * POST /api/video/rooms/:roomName/participants/:participantSid/disconnect
   */
  async disconnectParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { roomName, participantSid } = req.params;

      const result = await twilioService.disconnectParticipant(
        roomName,
        participantSid
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error disconnecting participant:', error);
      res.status(500).json({
        error: 'Failed to disconnect participant',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Registrar que un participante se conectó
   * POST /api/video/events/participant-connected
   * Body: { roomName: string, identity: string, role: 'doctor' | 'patient', documento?: string, medicoCode?: string }
   */
  async trackParticipantConnected(req: Request, res: Response): Promise<void> {
    try {
      const { roomName, identity, role, documento, medicoCode } = req.body;

      if (!roomName || !identity || !role) {
        res.status(400).json({
          error: 'roomName, identity, and role are required',
        });
        return;
      }

      if (role !== 'doctor' && role !== 'patient') {
        res.status(400).json({
          error: 'role must be either "doctor" or "patient"',
        });
        return;
      }

      sessionTracker.trackParticipantConnected(roomName, identity, role, documento, medicoCode);

      res.status(200).json({
        success: true,
        message: 'Participant connection tracked',
      });
    } catch (error) {
      console.error('Error tracking participant connection:', error);
      res.status(500).json({
        error: 'Failed to track participant connection',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Registrar que un participante se desconectó
   * POST /api/video/events/participant-disconnected
   * Body: { roomName: string, identity: string }
   */
  async trackParticipantDisconnected(req: Request, res: Response): Promise<void> {
    try {
      const { roomName, identity } = req.body;

      if (!roomName || !identity) {
        res.status(400).json({
          error: 'roomName and identity are required',
        });
        return;
      }

      sessionTracker.trackParticipantDisconnected(roomName, identity);

      res.status(200).json({
        success: true,
        message: 'Participant disconnection tracked',
      });
    } catch (error) {
      console.error('Error tracking participant disconnection:', error);
      res.status(500).json({
        error: 'Failed to track participant disconnection',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Enviar mensaje de WhatsApp usando template aprobado
   * POST /api/video/whatsapp/send
   * Body: { phone: string, roomNameWithParams: string, patientName: string, appointmentTime: string }
   *
   * Usa el template aprobado de Twilio con variables:
   * Template VIP: "Hola {{1}}, Te saludamos de VIP Salud Ocupacional. Tienes una consulta médica a las {{2}}..."
   * Button URL: {PUBLIC_APP_URL}/panel-medico/patient/{{3}}
   */
  async sendWhatsApp(req: Request, res: Response): Promise<void> {
    try {
      const { phone, roomNameWithParams, patientName, appointmentTime } = req.body;

      if (!phone || !roomNameWithParams || !patientName || !appointmentTime) {
        res.status(400).json({
          error: 'phone, roomNameWithParams, patientName, and appointmentTime are required',
        });
        return;
      }

      // Usar template aprobado con variables para pacientes
      const result = await whatsappService.sendTemplateMessage(
        phone,
        roomNameWithParams,
        patientName,
        appointmentTime
      );

      if (result.success) {
        // Registrar el mensaje directamente en PostgreSQL para que aparezca en el chat
        try {
          const baseUrl = process.env.BASE_URL || 'https://bodytech.app';
          const videoCallUrl = `${baseUrl}/panel-medico/patient/${roomNameWithParams}`;
          const messageBody = `Hola ${patientName},\n\nTe saludamos de VIP Salud Ocupacional.\n\nTienes una consulta médica a las ${appointmentTime}.\n\nPara ingresar haz clic en el siguiente enlace:\n${videoCallUrl}`;

          // Formatear número de teléfono con prefijo +
          const phoneWithPlus = phone.startsWith('+') ? phone : `+${phone}`;

          await postgresService.registrarMensajeSaliente(
            phoneWithPlus,
            messageBody,
            result.messageSid || '',
            patientName
          );

          console.log(`✅ Mensaje registrado en PostgreSQL para ${phoneWithPlus}`);
        } catch (registerError) {
          // No fallar si el registro en PostgreSQL falla
          console.error('⚠️ Error registrando mensaje en PostgreSQL:', registerError);
        }

        res.status(200).json({
          success: true,
          message: 'WhatsApp template sent successfully',
          messageSid: result.messageSid,
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error || 'Failed to send WhatsApp template',
        });
      }
    } catch (error) {
      console.error('Error sending WhatsApp:', error);
      res.status(500).json({
        error: 'Failed to send WhatsApp',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Listar historias clínicas de personas atendidas con paginación y búsqueda
   * GET /api/video/medical-history/atendidos?page=1&limit=20&buscar=texto
   */
  async getAtendidos(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const buscar = req.query.buscar as string | undefined;

      const result = await medicalHistoryService.getAtendidos({ page, limit, buscar });

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('Error fetching atendidos:', error);
      res.status(500).json({
        error: 'Failed to fetch atendidos',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Generar preview HTML de la historia clínica completa para impresión
   * GET /api/video/medical-history/:historiaId/preview
   */
  async getPreviewHTML(req: Request, res: Response): Promise<void> {
    try {
      const { historiaId } = req.params;

      const html = await medicalHistoryService.getPreviewHTML(historiaId);

      if (!html) {
        res.status(404).send('<h1>Historia clínica no encontrada</h1>');
        return;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      console.error('Error generating preview HTML:', error);
      res.status(500).send('<h1>Error generando historia clínica</h1>');
    }
  }

  /**
   * Obtener historia clínica de un paciente por _id
   * GET /api/video/medical-history/:historiaId
   */
  async getMedicalHistory(req: Request, res: Response): Promise<void> {
    try {
      const { historiaId } = req.params;

      if (!historiaId) {
        res.status(400).json({ error: 'historiaId is required' });
        return;
      }

      const medicalHistory = await medicalHistoryService.getMedicalHistory(historiaId);

      if (!medicalHistory) {
        res.status(404).json({
          success: false,
          error: 'Medical history not found for this patient',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: medicalHistory,
      });
    } catch (error) {
      console.error('Error fetching medical history:', error);
      res.status(500).json({
        error: 'Failed to fetch medical history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Obtener historial de consultas anteriores de un paciente por numeroId (documento de identidad)
   * GET /api/video/medical-history/patient/:numeroId
   */
  async getPatientHistory(req: Request, res: Response): Promise<void> {
    try {
      const { numeroId } = req.params;

      if (!numeroId) {
        res.status(400).json({ error: 'numeroId is required' });
        return;
      }

      const history = await medicalHistoryService.getPatientHistory(numeroId);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      console.error('Error fetching patient history:', error);
      res.status(500).json({
        error: 'Failed to fetch patient history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Actualizar historia clínica de un paciente por _id
   * POST /api/video/medical-history
   */
  async updateMedicalHistory(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body;
      console.log('📥 [updateMedicalHistory] Payload recibido:', JSON.stringify(payload, null, 2));

      if (!payload.historiaId) {
        console.error('❌ [updateMedicalHistory] historiaId no encontrado en payload');
        res.status(400).json({ error: 'historiaId is required' });
        return;
      }

      const result = await medicalHistoryService.updateMedicalHistory(payload);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Medical history updated successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error || 'Failed to update medical history',
        });
      }
    } catch (error) {
      console.error('Error updating medical history:', error);
      res.status(500).json({
        error: 'Failed to update medical history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Actualizar UN solo campo de la historia clínica (auto-save por field).
   * PATCH /api/video/medical-history/:historiaId/field
   * Body: { field: string, value: string | number | boolean | null }
   *
   * - 200 + { success: true, field, value, updatedAt } si se guardó
   * - 400 INVALID_FIELD si `field` no está en la whitelist
   * - 404 NOT_FOUND si el _id no existe
   * - 500 DB_ERROR para errores internos
   */
  async updateMedicalHistoryField(req: Request, res: Response): Promise<void> {
    try {
      const { historiaId } = req.params;
      const { field, value } = req.body ?? {};

      if (!historiaId) {
        res.status(400).json({ success: false, error: 'MISSING_ID', code: 'MISSING_ID' });
        return;
      }

      const result = await medicalHistoryService.updateField(historiaId, field, value);

      if (result.success) {
        res.status(200).json(result);
        return;
      }

      const httpCode = result.code ?? 400;
      res.status(httpCode).json({
        success: false,
        error: result.error || 'UPDATE_FAILED',
        code: result.error || 'UPDATE_FAILED',
      });
    } catch (error) {
      console.error('Error in updateMedicalHistoryField:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Generar sugerencias médicas con IA
   * POST /api/video/ai-suggestions
   * Body: { patientData: PatientData }
   */
  async generateAISuggestions(req: Request, res: Response): Promise<void> {
    try {
      const { patientData } = req.body;

      if (!patientData) {
        res.status(400).json({ error: 'patientData is required' });
        return;
      }

      const suggestions = await openaiService.generateMedicalRecommendations(patientData);

      res.status(200).json({
        success: true,
        data: {
          suggestions,
        },
      });
    } catch (error) {
      console.error('Error generating AI suggestions:', error);
      res.status(500).json({
        error: 'Failed to generate AI suggestions',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Obtener lista de pacientes actualmente conectados
   * GET /api/video/events/connected-patients?medicoCode=XXX
   */
  async getConnectedPatients(req: Request, res: Response): Promise<void> {
    try {
      const { medicoCode } = req.query;
      const connectedPatients = sessionTracker.getConnectedPatients(medicoCode as string | undefined);

      res.status(200).json({
        success: true,
        data: connectedPatients,
      });
    } catch (error) {
      console.error('Error fetching connected patients:', error);
      res.status(500).json({
        error: 'Failed to fetch connected patients',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Phase 3 — Vincular un roomName con la historia clínica activa al iniciar
   * la sesión de video. El doctor llama esto en cuanto Video.connect() resuelve.
   *
   * POST /api/video/events/session-start
   * Body: { roomName: string, historiaId: string }
   */
  async sessionStart(req: Request, res: Response): Promise<void> {
    try {
      const { roomName, historiaId } = req.body ?? {};

      if (!roomName || !historiaId || typeof roomName !== 'string' || typeof historiaId !== 'string') {
        res.status(400).json({
          success: false,
          error: 'roomName and historiaId are required',
        });
        return;
      }

      await transcriptionService.linkRoomToHistoria(roomName.trim(), historiaId.trim());

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[SessionStart] Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to register session start',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Phase 4 — Webhook de Twilio cuando una sala de video se completa (status=completed).
   * Crea una Composition mp4 (audio + video de todos los participantes) y guarda
   * el composition_sid en la HistoriaClinica vinculada.
   *
   * POST /api/video/webhooks/room-completed
   * Content-Type: application/x-www-form-urlencoded (Twilio)
   *
   * Twilio envía: RoomSid, RoomName, RoomStatus, etc.
   * Respondemos 200 inmediato; la composition se crea en background.
   */
  async roomCompletedWebhook(req: Request, res: Response): Promise<void> {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN || '';
      const signature = (req.headers['x-twilio-signature'] as string) || '';

      const baseUrl =
        process.env.PUBLIC_BASE_URL ||
        `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}`;
      const url = `${baseUrl.replace(/\/+$/, '')}${req.originalUrl}`;

      if (authToken && signature) {
        const valid = twilio.validateRequest(
          authToken,
          signature,
          url,
          (req.body ?? {}) as Record<string, string>
        );
        if (!valid) {
          console.warn(`[Webhook room-completed] Firma Twilio inválida. url=${url}`);
          res.status(403).json({ error: 'Invalid Twilio signature' });
          return;
        }
      }

      const { RoomSid, RoomName, RoomStatus } = (req.body ?? {}) as Record<string, string>;

      // Responder inmediatamente — Twilio exige 200 rápido
      res.sendStatus(200);

      if (RoomStatus !== 'completed') return;

      console.log(`[Webhook room-completed] ${RoomName} (${RoomSid})`);

      // Procesar en background — errores solo se loguean para no afectar al webhook
      (async () => {
        try {
          // Buscar la historia clínica vinculada al room
          const rows = await postgresService.query(
            `SELECT historia_id FROM room_historia_map WHERE room_name = $1 LIMIT 1`,
            [RoomName]
          );
          const historiaId: string | undefined = rows?.[0]?.historia_id;

          if (!historiaId) {
            console.log(
              `[Webhook room-completed] Sin historia vinculada para ${RoomName} — ignorando`
            );
            return;
          }

          // Verificar si ya tiene composition para evitar duplicados
          const existing = await postgresService.query(
            `SELECT "composition_sid" FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
            [historiaId]
          );
          if (existing?.[0]?.composition_sid) {
            console.log(
              `[Webhook room-completed] Historia ${historiaId} ya tiene composition — ignorando`
            );
            return;
          }

          const comp = await twilioService.createComposition(RoomSid);

          await postgresService.query(
            `UPDATE "HistoriaClinica" SET "composition_sid" = $1 WHERE "_id" = $2`,
            [comp.sid, historiaId]
          );

          console.log(
            `[Webhook room-completed] Composition ${comp.sid} (status: ${comp.status}) creada para historia ${historiaId}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Webhook room-completed] Error en background:`, msg);
        }
      })();
    } catch (error) {
      console.error('[Webhook room-completed] Error inesperado:', error);
      if (!res.headersSent) {
        res.status(500).send();
      }
    }
  }

  /**
   * Phase 3 — Webhook de Twilio cuando un recording termina (status=completed).
   * Validamos firma con TWILIO_AUTH_TOKEN y disparamos el pipeline en background.
   *
   * POST /api/video/webhooks/recording-ready
   * Content-Type: application/x-www-form-urlencoded (Twilio)
   *
   * Twilio envía campos como RoomName, RecordingSid, MediaUrl, RecordingUrl, etc.
   * Respondemos 200 SIEMPRE que la firma sea válida — los retries de Twilio
   * cuestan caro y el pipeline corre asíncrono.
   */
  async recordingReadyWebhook(req: Request, res: Response): Promise<void> {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const signature = req.header('x-twilio-signature') || '';

      // Construir la URL pública con la que Twilio firmó. PUBLIC_BASE_URL
      // permite override cuando estamos detrás de un proxy (DigitalOcean App
      // Platform, Cloudflare, etc.). Si no está, derivar del request.
      const baseUrl =
        process.env.PUBLIC_BASE_URL ||
        `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}`;
      const url = `${baseUrl.replace(/\/+$/, '')}${req.originalUrl}`;

      if (!authToken) {
        console.error('[Transcription] TWILIO_AUTH_TOKEN no configurado, no puedo validar firma');
        res.status(500).send();
        return;
      }

      // Body se asume application/x-www-form-urlencoded (express.urlencoded ya
      // está montado en index.ts).
      const params = (req.body ?? {}) as Record<string, string>;

      const valid = twilio.validateRequest(authToken, signature, url, params);
      if (!valid) {
        console.warn(
          `[Transcription] Firma Twilio inválida. url=${url} signature=${signature.slice(0, 12)}…`
        );
        res.status(403).send();
        return;
      }

      const roomName = params.RoomName || params.roomName || '';
      const recordingSid = params.RecordingSid || params.recordingSid || '';
      // Twilio puede mandar `MediaUrl` (recording API) o `RecordingUrl`
      // (status-callback estándar). Aceptamos ambos.
      const mediaUrl =
        params.MediaUrl ||
        params.RecordingUrl ||
        params.mediaUrl ||
        params.recordingUrl ||
        '';

      // Responder 200 inmediato — el pipeline corre en background sin await.
      // Si faltan campos, igual respondemos 200 para no romper retries de Twilio.
      res.status(200).send();

      if (!roomName || !mediaUrl) {
        console.warn(
          `[Transcription] Webhook sin RoomName o MediaUrl. roomName=${roomName} mediaUrl=${mediaUrl}`
        );
        return;
      }

      console.log(
        `[Transcription] Webhook recibido room=${roomName} sid=${recordingSid}`
      );

      // Fire-and-forget. Errores se loguean dentro del service.
      transcriptionService
        .processRecording(roomName, recordingSid, mediaUrl)
        .catch((err) => {
          console.error('[Transcription] processRecording lanzó (no debería):', err);
        });
    } catch (error) {
      console.error('[Transcription] recordingReadyWebhook error:', error);
      // Si ya respondimos no podemos volver a responder; solo loguear.
      if (!res.headersSent) {
        res.status(500).send();
      }
    }
  }
}

export default new VideoController();
