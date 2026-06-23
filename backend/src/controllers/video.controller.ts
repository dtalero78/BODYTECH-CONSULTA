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
import medicalPanelService from '../services/medical-panel.service';
import calendarioService from '../services/calendario.service';
import trepsiWebhookService from '../services/trepsi-webhook.service';

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
  // Id de la cita (HistoriaClinica._id) — variable {{4}} del template, requerida
  // por la plantilla con 2 botones (bodytech_cita_v2) para armar /reprogramar/{{4}}.
  // Obligatorio: sin él Twilio rechaza el envío por variable faltante.
  historiaId: z.string().min(1),
});

const reprogramarSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha inválida (YYYY-MM-DD)'),
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'hora inválida (HH:MM)'),
});

const getAtendidosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  buscar: z.string().optional(),
});

// Los campos opcionales vienen del GET de la historia, que devuelve `null`
// para columnas vacías. El panel reenvía esos valores tal cual al guardar, así
// que `z.string().optional()` (que solo acepta string|undefined) rechazaba
// `null` con 400 "Expected string, received null". Aceptamos string|null|undefined
// y normalizamos null → undefined para no romper el tipo del payload aguas abajo.
const optionalText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? undefined);

const updateMedicalHistorySchema = z.object({
  historiaId: z.string().min(1),
  mdAntecedentes: optionalText,
  mdObsParaMiDocYa: optionalText,
  mdObservacionesCertificado: optionalText,
  mdRecomendacionesMedicasAdicionales: optionalText,
  mdConceptoFinal: optionalText,
  mdDx1: optionalText,
  mdDx2: optionalText,
  talla: optionalText,
  peso: optionalText,
  cargo: optionalText,
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
    const { phone, roomNameWithParams, patientName, appointmentTime, historiaId } = parsed.data;

    try {
      // Usar template aprobado con variables para pacientes
      const result = await whatsappService.sendTemplateMessage(
        phone,
        roomNameWithParams,
        patientName,
        appointmentTime,
        historiaId
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

        // Si la cita es de Trepsi, también les enviamos el link por webhook
        // para que ellos puedan mostrárselo al paciente en su app. Si la HC
        // no corresponde a una cita Trepsi, el service no hace nada.
        if (historiaId) {
          const baseUrl = process.env.BASE_URL || 'https://bodytech.app';
          const videoCallUrl = `${baseUrl}/panel-medico/patient/${roomNameWithParams}`;
          const phoneWithPlus = phone.startsWith('+') ? phone : `+${phone}`;
          trepsiWebhookService
            .enqueueLink(historiaId, videoCallUrl, phoneWithPlus)
            .then((r) => {
              if (r.enqueued) {
                console.log(`📨 [Trepsi-Webhook] Link encolado para historia ${historiaId}`);
              } else if (r.reason && r.reason !== 'NOT_TREPSI') {
                console.log(`ℹ️  [Trepsi-Webhook] Link no encolado: ${r.reason}`);
              }
            })
            .catch((e) => {
              console.error(`⚠️  [Trepsi-Webhook] Error encolando link: ${e?.message ?? e}`);
            });
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
   * GET /reprogramar/:id — datos mínimos de la cita para la página pública de
   * reprogramación (nombre + fecha/hora actuales). Público (sin JWT).
   */
  async getReprogramarInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    try {
      const cita = await medicalPanelService.getCitaBasics(id);
      if (!cita) {
        res.status(404).json({ success: false, error: 'Cita no encontrada' });
        return;
      }
      res.status(200).json({
        success: true,
        primerNombre: cita.primerNombre,
        fechaAtencion: cita.fechaAtencion,
        horaAtencion: cita.horaAtencion,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /reprogramar/:id — reprograma la cita al próximo día hábil con cupo en
   * la franja elegida (mañana/tarde), mismo médico. Público (lo abre el afiliado
   * desde el botón de WhatsApp).
   */
  async reprogramarCita(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const parsed = reprogramarSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { fecha, hora } = parsed.data;

    try {
      const cita = await medicalPanelService.getCitaBasics(id);
      if (!cita) {
        res.status(404).json({ success: false, error: 'Cita no encontrada' });
        return;
      }
      if (!cita.medico) {
        res.status(409).json({ success: false, error: 'La cita no tiene médico asignado.' });
        return;
      }

      // Validar que el slot elegido siga disponible para el MISMO médico de la
      // cita (evita doble reserva si alguien tomó el cupo entre que se listó y
      // que el paciente eligió). Se usa la sede EFECTIVA del coach (no la de la
      // cita, que puede ser genérica) para que coincida con su agenda.
      const sedeEfectiva =
        (await calendarioService.resolveSedeMedico(cita.medico, cita.sedeId)) ?? cita.sedeId;
      const val = await calendarioService.validarSlotDisponible(
        sedeEfectiva,
        cita.medico,
        fecha,
        hora,
        'virtual'
      );
      if (!val.ok) {
        res
          .status(val.status)
          .json({ success: false, error: val.error?.message ?? 'El horario ya no está disponible.' });
        return;
      }

      // Capturamos la fecha/hora previas ANTES del update para incluirlas
      // en el webhook a Trepsi (campo `fechaAtencionAnterior`).
      const fechaAnterior = cita.fechaAtencion;
      const horaAnterior = cita.horaAtencion;

      const ok = await medicalPanelService.updateOrden(id, {
        fechaAtencion: fecha,
        horaAtencion: hora,
        // Marca la cita como reprogramada → el panel coordinador la pinta en naranja.
        // Sigue contando como pendiente de atención (no toca fechaConsulta).
        atendido: 'REPROGRAMADA',
      });
      if (!ok) {
        res.status(500).json({ success: false, error: 'No se pudo reprogramar la cita.' });
        return;
      }

      // Si la cita es de Trepsi, notificamos el reschedule por webhook.
      // Fire-and-forget — no bloquea la respuesta al paciente.
      trepsiWebhookService
        .enqueueReschedule(id, fechaAnterior, horaAnterior, fecha, hora, 'patient')
        .then((r) => {
          if (r.enqueued) {
            console.log(`📨 [Trepsi-Webhook] Reschedule encolado para historia ${id}`);
          } else if (r.reason && r.reason !== 'NOT_TREPSI') {
            console.log(`ℹ️  [Trepsi-Webhook] Reschedule no encolado: ${r.reason}`);
          }
        })
        .catch((e) => {
          console.error(`⚠️  [Trepsi-Webhook] Error encolando reschedule: ${e?.message ?? e}`);
        });

      // Confirmación por WhatsApp (best-effort, dentro de la ventana de 24h),
      // revelando la fecha/hora que el paciente eligió.
      if (cita.celular) {
        const [y, m, d] = fecha.split('-');
        const fechaLegible = `${d}/${m}/${y}`;
        whatsappService
          .sendTextMessage(
            cita.celular,
            `Hola ${cita.primerNombre ?? ''} 👋\n\nTu cita quedó reprogramada para el ${fechaLegible} a las ${hora}.\n\n¡Te esperamos!`
          )
          .catch(() => {});
      }

      res.status(200).json({ success: true, fecha, hora });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /reprogramar/:id/horarios — días hábiles con cupos disponibles del
   * MISMO médico de la cita, para el selector "día → hora" de la página pública.
   */
  async getReprogramarHorarios(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    try {
      const cita = await medicalPanelService.getCitaBasics(id);
      if (!cita) {
        res.status(404).json({ success: false, error: 'Cita no encontrada' });
        return;
      }
      if (!cita.medico) {
        res.status(409).json({ success: false, error: 'La cita no tiene médico asignado.' });
        return;
      }

      const result = await calendarioService.getHorariosReprogramar(cita.sedeId, cita.medico, 'virtual');
      if (!result.ok || !result.data) {
        res
          .status(result.status)
          .json({ success: false, error: result.error?.message ?? 'No se pudieron cargar los horarios.' });
        return;
      }

      res.status(200).json({ success: true, dias: result.data.dias });
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
      const result = await medicalHistoryService.getAtendidos({
        page: page ?? 1,
        limit: limit ?? 20,
        buscar,
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
   * Generar RIPS JSON (Resolución 2275/2023) para una consulta individual
   * GET /api/video/medical-history/:historiaId/rips
   */
  async getRipsJson(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { historiaId } = req.params;

      if (!historiaId) {
        res.status(400).json({ success: false, error: 'historiaId requerido' });
        return;
      }

      const data = await medicalHistoryService.getMedicalHistory(historiaId);

      if (!data) {
        res.status(404).json({ success: false, error: 'Historia clínica no encontrada' });
        return;
      }

      const ahora = new Date();
      const yyyymmdd = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}`;
      const hhmm = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;

      const fmtFecha = (d: Date | string | null | undefined): string | null => {
        if (!d) return null;
        const dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt.getTime())) return null;
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };

      const mapGenero = (g: string | undefined): string => {
        if (!g) return 'M';
        const l = g.toLowerCase();
        if (l.includes('fem') || l === 'f') return 'F';
        if (l.includes('masc') || l === 'm') return 'M';
        return 'I';
      };

      const normalizar = (t: string | undefined | null): string =>
        (t || '')
          .toUpperCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^A-Z0-9\s]/g, '')
          .trim();

      const nitPrestador = process.env.RIPS_NIT_PRESTADOR || '9001234567';
      const nombrePrestador = process.env.RIPS_NOMBRE_PRESTADOR || 'BSL TELEMEDICINA';

      const rips = {
        transaccion: {
          consecutivo: yyyymmdd,
          tipoNota: null,
          numDocumentoIdObligado: nitPrestador,
          numFactura: `RIPS-${yyyymmdd}-${historiaId.slice(-6)}`,
          fechaExpedicion: fmtFecha(ahora),
          horaExpedicion: hhmm,
          entidadObligadaPagoNombre: nombrePrestador,
        },
        usuarios: [
          {
            tipoDocumentoIdentificacion: 'CC',
            numDocumentoIdentificacion: data.numeroId,
            primerApellido: normalizar(data.primerApellido),
            segundoApellido: normalizar(data.segundoApellido),
            primerNombre: normalizar(data.primerNombre),
            segundoNombre: normalizar(data.segundoNombre),
            fechaNacimiento: fmtFecha((data as unknown as Record<string, unknown>).fechaNacimiento as Date | string | null),
            codSexo: mapGenero(data.genero),
            codPaisOrigen: '170',
            codPaisResidencia: '170',
            codMunicipioResidencia: '11001',
            codZonaTerritorialResidencia: 'U',
            incapacidad: 'NO',
            consecutivo: '1',
            tipoUsuario: '01',
          },
        ],
        consultas: [
          {
            numDocumentoIdentificacion: data.numeroId,
            fechaInicioAtencion: fmtFecha(data.fechaAtencion),
            numAutorizacion: null,
            codConsulta: '890201',
            modalidadGrupoServicioTecSal: '06',
            grupoServicios: '01',
            codServicio: '890201',
            finalidadTecnologiaSalud: '13',
            causaMotivoAtencion: '15',
            codDiagnosticoPrincipal: data.mdDx1 || 'Z571',
            codDiagnosticoRelacionado1: data.mdDx2 || null,
            codDiagnosticoRelacionado2: null,
            codDiagnosticoRelacionado3: null,
            tipoDiagnosticoPrincipal: '01',
            tipoDocumentoIdentificacion: 'CC',
            numDocumentoIdentificacionMedico: data.medico || '0',
            vrServicio: 0,
            conceptoRecaudo: null,
            valorPagoModerador: 0,
            numFEVPagoModerador: null,
            consecutivo: '1',
          },
        ],
        procedimientos: [],
        urgencias: [],
        hospitalizacion: [],
        recienNacidos: [],
        medicamentos: [],
        otrosServicios: [],
      };

      const filename = `RIPS_${data.numeroId}_${yyyymmdd}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(rips);
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
      const medicalHistory = await medicalHistoryService.getMedicalHistory(historiaId);

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

      const roomSid = params.RoomSid || params.roomSid || '';

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

          let historiaId: string | undefined = result?.[0]?._id as string | undefined;

          // Fallback: el match por composition_sid falló (0 filas). Esto pasa
          // cuando el guardado asíncrono del composition_sid en endRoom/room-completed
          // se demoró, falló (corte de BD) o perdió la carrera contra este callback
          // (la composición se completa en ~1 min). Resolvemos la historia por el
          // RoomSid del payload → uniqueName → room_historia_map, y hacemos backfill
          // del composition_sid para no volver a depender de esa escritura asíncrona.
          if (!historiaId && roomSid) {
            try {
              const room = await twilioService.getRoom(roomSid);
              const roomName = room?.uniqueName;
              const hid = roomName
                ? await transcriptionService.getHistoriaIdForRoom(roomName)
                : null;
              if (hid) {
                await postgresService.query(
                  `UPDATE "HistoriaClinica"
                     SET "composition_sid" = $1,
                         "composition_status" = $2,
                         "composition_completed_at" = COALESCE($3, "composition_completed_at")
                   WHERE "_id" = $4`,
                  [compositionSid, status, completedAt, hid]
                );
                historiaId = hid;
                console.log(
                  `[Webhook composition-status] Fallback por RoomSid: historia ${hid} backfilled con composition ${compositionSid}`
                );
              }
            } catch (fallbackErr: unknown) {
              const m =
                fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
              console.error(`[Webhook composition-status] Fallback por RoomSid falló:`, m);
            }
          }

          if (!historiaId) {
            console.log(
              `[Webhook composition-status] Composition ${compositionSid} sin HistoriaClinica vinculada (ni por composition_sid ni por RoomSid) — ignorando`
            );
            return;
          }

          console.log(
            `[Webhook composition-status] HistoriaClinica ${historiaId} actualizada → ${status}`
          );

          // Transcripción por composición = FALLBACK. La entrada principal es
          // el audio grabado en el navegador (processClientAudio), que deja el
          // transcript listo a los segundos de terminar la llamada. El service
          // decide si re-transcribir (incluye reconfirmación diferida si el
          // client-side está en vuelo); la composición se conserva igual para
          // revisión de video. Fire-and-forget.
          if (status === 'completed') {
            transcriptionService
              .ensureTranscribedFromComposition(historiaId, compositionSid)
              .catch((err) => {
                console.error(
                  '[Webhook composition-status] ensureTranscribedFromComposition lanzó (no debería):',
                  err
                );
              });
          }
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

  /**
   * POST /api/video/transcribe-consulta/:historiaId
   *
   * Entrada PRINCIPAL de transcripción: el navegador del médico graba el audio
   * de la consulta (mezcla mic médico + audio paciente) y lo sube como binario
   * crudo cuando termina la llamada. El body llega vía express.raw (Buffer).
   *
   * Async: respondemos 202 inmediato y corremos Whisper → GPT-4o-mini → PATCH
   * en background (mismo contrato que los webhooks). El frontend ya pollea
   * `transcription_status` y muestra el badge "Transcripción lista".
   *
   * Protegido por `clinico` (JWT) — maneja PHI; lo usa el panel del médico, no
   * el paciente.
   */
  async transcribeConsulta(req: Request, res: Response): Promise<void> {
    try {
      const { historiaId } = req.params;
      if (!historiaId) {
        res.status(400).json({ error: 'historiaId requerido' });
        return;
      }

      const body = req.body;
      const audioBuf = Buffer.isBuffer(body) ? body : null;
      if (!audioBuf || audioBuf.byteLength === 0) {
        res.status(400).json({ error: 'Audio vacío o ausente' });
        return;
      }

      const contentType = req.header('content-type') || 'audio/webm';
      // El panel nutricional guarda en datosNutricionales (JSONB); el de consulta
      // en columnas. El frontend indica la variante por query param.
      const variant: 'consulta' | 'nutricional' =
        req.query.variant === 'nutricional' ? 'nutricional' : 'consulta';

      console.log(
        `[Transcription] transcribe-consulta historia=${historiaId} variant=${variant} bytes=${audioBuf.byteLength} ct=${contentType}`
      );

      // Respondemos rápido — el procesamiento corre en background.
      res.status(202).json({
        accepted: true,
        historiaId,
        variant,
        bytes: audioBuf.byteLength,
        message: 'Transcripción disparada en background. Polleá transcription_status.',
      });

      transcriptionService
        .processClientAudio(historiaId, audioBuf, contentType, variant)
        .catch((err) => {
          console.error('[Transcription] processClientAudio lanzó (no debería):', err);
        });
    } catch (error) {
      console.error('[Transcription] transcribeConsulta error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error interno' });
      }
    }
  }

  /**
   * POST /api/video/transcribe-historia/:historiaId
   *
   * Endpoint de operación: dispara la transcripción de una historia clínica
   * usando el `composition_sid` que ya tiene cargada en BD. Útil para:
   *   - Backfill cuando el webhook `composition-status` no llegó.
   *   - Retry manual después de un error de transcripción.
   *
   * Responde 202 Accepted inmediato y corre el pipeline en background
   * (mismo contrato que los webhooks). Devuelve 404 si la historia no
   * existe o no tiene composition_sid.
   */
  async retranscribeHistoria(req: Request, res: Response): Promise<void> {
    try {
      const { historiaId } = req.params;
      if (!historiaId) {
        res.status(400).json({ error: 'historiaId requerido' });
        return;
      }

      const rows = await postgresService.query(
        `SELECT "_id", composition_sid FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
        [historiaId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Historia clínica no encontrada' });
        return;
      }
      let compositionSid = rows[0].composition_sid as string | null;

      // Auto-reparación: si falta composition_sid (el guardado asíncrono falló o
      // perdió la carrera), lo resolvemos vía room_historia_map → Twilio y hacemos
      // backfill, en vez de fallar. Así esta historia y cualquier otra atascada
      // se puede re-transcribir sin tocar la BD a mano.
      if (!compositionSid) {
        try {
          const roomRows = await postgresService.query(
            `SELECT room_name FROM room_historia_map
              WHERE historia_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
            [historiaId]
          );
          const roomName: string | undefined = roomRows?.[0]?.room_name;
          if (roomName) {
            const room = await twilioService.getRoom(roomName);
            const sid = room?.sid
              ? await twilioService.getLatestCompositionSid(room.sid)
              : null;
            if (sid) {
              await postgresService.query(
                `UPDATE "HistoriaClinica" SET "composition_sid" = $1 WHERE "_id" = $2`,
                [sid, historiaId]
              );
              compositionSid = sid;
              console.log(
                `[retranscribeHistoria] Backfill composition_sid=${sid} para historia ${historiaId} (room ${roomName})`
              );
            }
          }
        } catch (backfillErr) {
          const m = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
          console.error('[retranscribeHistoria] Backfill composition_sid falló:', m);
        }
      }

      if (!compositionSid) {
        res.status(400).json({
          error:
            'La historia no tiene composition_sid y no se pudo resolver desde Twilio (la sala no se cerró o no se creó composition).',
        });
        return;
      }

      res.status(202).json({
        accepted: true,
        historiaId,
        compositionSid,
        message: 'Transcripción disparada en background. Polleá transcription_status.',
      });

      transcriptionService.processComposition(historiaId, compositionSid).catch((err) => {
        console.error('[retranscribeHistoria] processComposition lanzó:', err);
      });
    } catch (error) {
      console.error('[retranscribeHistoria] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error interno' });
      }
    }
  }
}

export default new VideoController();
