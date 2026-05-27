import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { z, ZodError } from 'zod';
import twilioService from '../services/twilio.service';
import { sessionTracker } from '../services/session-tracker.service';
import whatsappService from '../services/whatsapp.service';
import medicalHistoryService from '../services/medical-history.service';
import openaiService from '../services/openai.service';
import postgresService from '../services/postgres.service';
import transcriptionService from '../services/transcription.service';
import pdfService from '../services/pdf.service';

// ============================================================================
// Zod schemas (privados al controller).
//
// Validan ÚNICAMENTE la shape del request (campos requeridos, tipos
// primitivos). NO duplican lógica de dominio:
//   - `field` en /field NO se valida contra EDITABLE_FIELDS (vive en service).
//   - `value` no se coerciona aquí (lo hace coerceValue en el service).
//   - `historiaId` se exige como string no vacío; mensajes legacy en español
//     se preservan donde se necesita (ver `updateMedicalHistory`).
// ============================================================================

const generateTokenSchema = z.object({
  identity: z.string().min(1),
  roomName: z.string().min(1),
});

const sessionStartSchema = z.object({
  roomName: z.string().min(1),
  historiaId: z.string().min(1),
});

const trackParticipantConnectedSchema = z.object({
  roomName: z.string().min(1),
  identity: z.string().min(1),
  role: z.enum(['doctor', 'patient']),
  documento: z.string().optional(),
  medicoCode: z.string().optional(),
});

const trackParticipantDisconnectedSchema = z.object({
  roomName: z.string().min(1),
  identity: z.string().min(1),
});

const sendWhatsAppSchema = z.object({
  phone: z.string().min(1),
  roomNameWithParams: z.string().min(1),
  patientName: z.string().min(1),
  appointmentTime: z.string().min(1),
});

const getAtendidosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  buscar: z.string().optional(),
});

const updateMedicalHistorySchema = z.object({
  historiaId: z.string().min(1),
  mdAntecedentes: z.string().optional(),
  mdObsParaMiDocYa: z.string().optional(),
  mdObservacionesCertificado: z.string().optional(),
  mdRecomendacionesMedicasAdicionales: z.string().optional(),
  mdConceptoFinal: z.string().optional(),
  mdDx1: z.string().optional(),
  mdDx2: z.string().optional(),
  talla: z.string().optional(),
  peso: z.string().optional(),
  cargo: z.string().optional(),
  // datosNutricionales: el OpenAI service lo digiere; aceptamos shape libre.
  datosNutricionales: z.unknown().optional(),
});

const updateMedicalHistoryParamsSchema = z.object({
  historiaId: z.string().min(1),
});

const updateMedicalHistoryFieldBodySchema = z.object({
  field: z.string().min(1),
  // El value puede ser string, number, boolean o null. La coerción al tipo
  // declarado de la columna la hace `coerceValue` en el service.
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

const generateAISuggestionsSchema = z.object({
  patientData: z.unknown().refine((v) => v !== undefined && v !== null, {
    message: 'patientData is required',
  }),
});

function validationResponse(res: Response, err: ZodError): void {
  res.status(400).json({
    success: false,
    error: 'VALIDATION_ERROR',
    details: err.errors,
  });
}

class VideoController {
  /**
   * Generar token de acceso para una sala de video
   * POST /api/video/token
   * Body: { identity: string, roomName: string }
   */
  async generateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = generateTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { identity, roomName } = parsed.data;

    try {
      // Pre-crear el room como 'group' con recordParticipantsOnConnect=true.
      // group-small fue deprecado por Twilio (error 53126).
      try {
        await twilioService.createRoom(roomName);
        console.log(`Room created (group with recording): ${roomName}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      next(error);
    }
  }

  /**
   * Crear una nueva sala de video
   * POST /api/video/rooms
   * Body: { roomName: string, type?: 'group' | 'peer-to-peer' }
   */
  async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      next(error);
    }
  }

  /**
   * Obtener información de una sala
   * GET /api/video/rooms/:roomName
   */
  async getRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomName } = req.params;

      const room = await twilioService.getRoom(roomName);

      res.status(200).json({
        success: true,
        data: room,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Finalizar una sala de video
   * POST /api/video/rooms/:roomName/end
   */
  async endRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomName } = req.params;

      const result = await twilioService.endRoom(roomName, true);

      // Guardar composition_sid en HistoriaClinica si hay historia vinculada
      if (result.compositionSid) {
        (async () => {
          try {
            const rows = await postgresService.query(
              `SELECT historia_id FROM room_historia_map WHERE room_name = $1 LIMIT 1`,
              [roomName]
            );
            const historiaId: string | undefined = rows?.[0]?.historia_id;
            if (historiaId) {
              await postgresService.query(
                `UPDATE "HistoriaClinica" SET "composition_sid" = $1 WHERE "_id" = $2`,
                [result.compositionSid, historiaId]
              );
              console.log(
                `[EndRoom] Composition ${result.compositionSid} guardada para historia ${historiaId}`
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            console.error(`[EndRoom] Error guardando composition_sid:`, err.message);
          }
        })();
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Listar participantes de una sala
   * GET /api/video/rooms/:roomName/participants
   */
  async listParticipants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomName } = req.params;

      const participants = await twilioService.listParticipants(roomName);

      res.status(200).json({
        success: true,
        data: participants,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Desconectar un participante
   * POST /api/video/rooms/:roomName/participants/:participantSid/disconnect
   */
  async disconnectParticipant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomName, participantSid } = req.params;

      const result = await twilioService.disconnectParticipant(roomName, participantSid);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Registrar que un participante se conectó
   * POST /api/video/events/participant-connected
   * Body: { roomName: string, identity: string, role: 'doctor' | 'patient', documento?: string, medicoCode?: string }
   */
  async trackParticipantConnected(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const parsed = trackParticipantConnectedSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { roomName, identity, role, documento, medicoCode } = parsed.data;

    try {
      sessionTracker.trackParticipantConnected(roomName, identity, role, documento, medicoCode);

      res.status(200).json({
        success: true,
        message: 'Participant connection tracked',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Registrar que un participante se desconectó
   * POST /api/video/events/participant-disconnected
   * Body: { roomName: string, identity: string }
   */
  async trackParticipantDisconnected(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const parsed = trackParticipantDisconnectedSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { roomName, identity } = parsed.data;

    try {
      sessionTracker.trackParticipantDisconnected(roomName, identity);

      res.status(200).json({
        success: true,
        message: 'Participant disconnection tracked',
      });
    } catch (error) {
      next(error);
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
  async sendWhatsApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = sendWhatsAppSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { phone, roomNameWithParams, patientName, appointmentTime } = parsed.data;

    try {
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
      next(error);
    }
  }

  /**
   * Listar historias clínicas de personas atendidas con paginación y búsqueda
   * GET /api/video/medical-history/atendidos?page=1&limit=20&buscar=texto
   */
  async getAtendidos(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = getAtendidosQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { page, limit, buscar } = parsed.data;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sedeId = (req as any).sedeId as string | undefined;
      const result = await medicalHistoryService.getAtendidos({
        page: page ?? 1,
        limit: limit ?? 20,
        buscar,
        sedeId,
      });

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Run 6 — Descarga la historia clínica como PDF (A4) generado con Puppeteer.
   * GET /api/video/medical-history/:id/pdf
   *
   * Reusa exactamente el mismo HTML que `/preview` (mismo `getPreviewHTML`),
   * lo convierte a PDF con `pdfService.htmlToPdf` y lo envía como descarga.
   * Si la historia no existe, responde 404 con el mismo shape JSON que el
   * resto del controller.
   *
   * Auth: el route mount aplica `requireAuthMiddleware` (JWT obligatorio).
   * Errores de Puppeteer caen en `error.middleware.ts` vía `next(err)`.
   */
  async getHistoriaPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ success: false, error: 'historiaId requerido' });
        return;
      }

      const html = await medicalHistoryService.getPreviewHTML(id);

      if (html === null) {
        res.status(404).json({ success: false, error: 'NOT_FOUND' });
        return;
      }

      const pdfBuffer = await pdfService.htmlToPdf(html);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=historia-${id}.pdf`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.end(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generar preview HTML de la historia clínica completa para impresión
   * GET /api/video/medical-history/:historiaId/preview
   */
  async getPreviewHTML(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      next(error);
    }
  }

  /**
   * Obtener historia clínica de un paciente por _id
   * GET /api/video/medical-history/:historiaId
   */
  async getMedicalHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { historiaId } = req.params;

      if (!historiaId) {
        res.status(400).json({ success: false, error: 'historiaId requerido' });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sedeId = (req as any).sedeId as string | undefined;
      const medicalHistory = await medicalHistoryService.getMedicalHistory(historiaId, sedeId);

      if (!medicalHistory) {
        res.status(404).json({
          success: false,
          error: 'No se encontró historia clínica para este paciente',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: medicalHistory,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtener historial de consultas anteriores de un paciente por numeroId (documento de identidad)
   * GET /api/video/medical-history/patient/:numeroId
   */
  async getPatientHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      next(error);
    }
  }

  /**
   * Actualizar historia clínica de un paciente por _id
   * POST /api/video/medical-history
   */
  async updateMedicalHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = updateMedicalHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const payload = parsed.data;

    try {
      console.log('📥 [updateMedicalHistory] Payload recibido:', JSON.stringify(payload, null, 2));

      const result = await medicalHistoryService.updateMedicalHistory(payload);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Medical history updated successfully',
        });
        return;
      }

      // Mapeo de códigos del service → HTTP status + mensaje genérico (no
      // exponer detalles internos de DB / upstream). Textos en español
      // preservados para no cambiar la UX existente.
      const code = result.code ?? 500;
      const errKey = result.error || 'UPDATE_FAILED';
      let publicError = 'Error al actualizar historia clínica';
      if (errKey === 'CONCEPTO_FINAL_REQUIRED') {
        publicError = 'El campo Concepto Final es obligatorio';
      } else if (errKey === 'NOT_FOUND') {
        publicError = 'No se encontró historia clínica';
      }
      res.status(code).json({
        success: false,
        error: publicError,
      });
    } catch (error) {
      next(error);
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
  async updateMedicalHistoryField(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const paramsParsed = updateMedicalHistoryParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return validationResponse(res, paramsParsed.error);
    }
    const bodyParsed = updateMedicalHistoryFieldBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      return validationResponse(res, bodyParsed.error);
    }
    const { historiaId } = paramsParsed.data;
    const { field, value } = bodyParsed.data;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sedeId = (req as any).sedeId as string | undefined;
      const result = await medicalHistoryService.updateField(historiaId, field, value, sedeId);

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
      next(error);
    }
  }

  /**
   * Generar sugerencias médicas con IA
   * POST /api/video/ai-suggestions
   * Body: { patientData: PatientData }
   */
  async generateAISuggestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = generateAISuggestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { patientData } = parsed.data;

    try {
      const suggestions = await openaiService.generateMedicalRecommendations(patientData);

      res.status(200).json({
        success: true,
        data: {
          suggestions,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtener lista de pacientes actualmente conectados
   * GET /api/video/events/connected-patients?medicoCode=XXX
   */
  async getConnectedPatients(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { medicoCode } = req.query;
      const connectedPatients = sessionTracker.getConnectedPatients(
        medicoCode as string | undefined
      );

      res.status(200).json({
        success: true,
        data: connectedPatients,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Phase 3 — Vincular un roomName con la historia clínica activa al iniciar
   * la sesión de video. El doctor llama esto en cuanto Video.connect() resuelve.
   *
   * POST /api/video/events/session-start
   * Body: { roomName: string, historiaId: string }
   */
  async sessionStart(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = sessionStartSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { roomName, historiaId } = parsed.data;

    try {
      await transcriptionService.linkRoomToHistoria(roomName.trim(), historiaId.trim());
      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
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
   *
   * NOTA: este webhook NO usa Zod ni `next(error)`. La firma Twilio + body
   * urlencoded son contratos externos que no admiten validación tipada y el
   * handler responde 200 antes de procesar; el global error handler detecta
   * `res.headersSent` y delega.
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

          // Si endRoom ya creó la composición directamente, no duplicar
          const alreadyHasComposition = await twilioService.roomHasComposition(RoomSid);
          if (alreadyHasComposition) {
            console.log(
              `[Webhook room-completed] Room ${RoomName} ya tiene composition — ignorando`
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
      // Nota: NO llamamos next(error) — el handler global respondería 500 con
      // `{ success: false, error: 'Error interno' }`, lo que ya hicimos arriba
      // explícitamente, o `res.headersSent` ya es true (status 200 enviado).
    }
  }

  /**
   * Phase 4 — Webhook de Twilio cuando una Composition cambia de estado
   * (enqueued → processing → completed | failed | deleted).
   *
   * POST /api/video/webhooks/composition-status
   * Content-Type: application/x-www-form-urlencoded (Twilio)
   *
   * Twilio envía: CompositionSid, RoomSid, StatusCallbackEvent, Timestamp y
   * en completed/failed adicionalmente: MediaUri, Duration, Size.
   *
   * Mismo contrato que los otros webhooks: validamos firma, respondemos 200
   * inmediato y procesamos en background.
   */
  async compositionStatusWebhook(req: Request, res: Response): Promise<void> {
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
          console.warn(`[Webhook composition-status] Firma Twilio inválida. url=${url}`);
          res.status(403).json({ error: 'Invalid Twilio signature' });
          return;
        }
      }

      const params = (req.body ?? {}) as Record<string, string>;
      const compositionSid = params.CompositionSid || params.compositionSid || '';
      const event = params.StatusCallbackEvent || '';

      // Twilio manda el estado en distintos lugares según el evento. Lo derivamos.
      // composition-enqueued | composition-progress | composition-completed |
      // composition-failed   | composition-deleted
      const status = event.replace(/^composition-/, '') || 'unknown';

      res.sendStatus(200);

      if (!compositionSid) {
        console.warn(`[Webhook composition-status] Sin CompositionSid. event=${event}`);
        return;
      }

      console.log(
        `[Webhook composition-status] ${compositionSid} event=${event} status=${status}`
      );

      (async () => {
        try {
          const completedAt =
            status === 'completed' || status === 'failed' ? new Date() : null;

          const result = await postgresService.query(
            `UPDATE "HistoriaClinica"
               SET "composition_status" = $1,
                   "composition_completed_at" = COALESCE($2, "composition_completed_at")
             WHERE "composition_sid" = $3
             RETURNING "_id"`,
            [status, completedAt, compositionSid]
          );

          if (!result || result.length === 0) {
            console.log(
              `[Webhook composition-status] Composition ${compositionSid} sin HistoriaClinica vinculada — ignorando`
            );
            return;
          }

          console.log(
            `[Webhook composition-status] HistoriaClinica ${result[0]._id} actualizada → ${status}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Webhook composition-status] Error en background:`, msg);
        }
      })();
    } catch (error) {
      console.error('[Webhook composition-status] Error inesperado:', error);
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
   *
   * NOTA: igual que `roomCompletedWebhook`, este handler NO usa Zod ni
   * `next(error)` — la firma se valida manualmente y la respuesta se envía
   * antes del procesamiento background.
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
      transcriptionService.processRecording(roomName, recordingSid, mediaUrl).catch((err) => {
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
