// ============================================================================
// whatsapp-chat.controller — chat de WhatsApp del panel médico.
//
//   POST /api/whatsapp-chat/webhook   (público, Twilio) → mensajes ENTRANTES
//   GET  /api/whatsapp-chat/mensajes  (protegido)       → hilo por ?celular=
//   POST /api/whatsapp-chat/mensajes  (protegido)       → responder al paciente
//
// El inbound llega por el webhook de Twilio del número +5716284820. El saliente
// se envía como texto libre (solo válido dentro de la ventana de 24h) y se
// guarda para que el hilo muestre ambos lados. Real-time vía Socket.io.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import postgresService from '../services/postgres.service';
import whatsappService from '../services/whatsapp.service';
import whatsappChatService from '../services/whatsapp-chat.service';

/**
 * Normaliza un teléfono a E.164 canónico (`+<indicativo><numero>`) para que el
 * inbound (Twilio `whatsapp:+57...`) y el saliente/registro usen la MISMA clave
 * de conversación. Un celular colombiano local (10 dígitos, empieza con 3) → +57.
 */
function normalizarCelular(raw: string): string {
  let s = (raw || '').replace(/^whatsapp:/i, '').replace(/[\s()-]/g, '');
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return `+57${digits}`;
  return `+${digits}`;
}

class WhatsappChatController {
  /**
   * Webhook de Twilio para mensajes entrantes de WhatsApp (form-urlencoded).
   * Responde 200 vacío de inmediato y procesa/emite en background.
   */
  webhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN || '';
      const signature = (req.headers['x-twilio-signature'] as string) || '';
      const baseUrl =
        process.env.PUBLIC_BASE_URL ||
        `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}`;
      const url = `${baseUrl.replace(/\/+$/, '')}${req.originalUrl}`;
      const body = (req.body ?? {}) as Record<string, string>;

      if (authToken && signature) {
        const valid = twilio.validateRequest(authToken, signature, url, body);
        if (!valid) {
          console.warn('[WA-Chat webhook] Firma Twilio inválida');
          res.status(403).send('Invalid signature');
          return;
        }
      }

      // Responder ya (Twilio espera 200 rápido; TwiML vacío = sin auto-respuesta).
      res.type('text/xml').send('<Response></Response>');

      const from = body.From || '';
      const texto = body.Body || '';
      const sid = body.MessageSid || '';
      const profileName = body.ProfileName || '';
      const numMedia = parseInt(body.NumMedia || '0', 10) || 0;

      if (!from) return;

      const celular = normalizarCelular(from);
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let tipoMensaje = 'text';
      if (numMedia > 0) {
        mediaUrl = body['MediaUrl0'] || null;
        mediaType = body['MediaContentType0'] || null;
        tipoMensaje = (mediaType || '').split('/')[0] || 'media'; // image|video|audio|...
      }

      // Ignorar mensajes vacíos sin media (ej. eventos de sistema).
      if (!texto && !mediaUrl) return;

      const stored = await postgresService.registrarMensajeEntrante(celular, texto, sid, {
        tipoMensaje,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaType || undefined,
        nombrePaciente: profileName || undefined,
      });

      if (stored) {
        whatsappChatService.emitNuevoMensaje({
          celular,
          id: stored.mensajeId,
          direccion: 'entrante',
          contenido: texto,
          tipoMensaje,
          mediaUrl,
          createdAt: stored.createdAt,
        });
        console.log(`💬 [WA-Chat] Entrante de ${celular}: "${texto.slice(0, 60)}"`);
      }
    } catch (error) {
      console.error('[WA-Chat webhook] Error:', error);
      if (!res.headersSent) res.status(200).send('<Response></Response>');
    }
  };

  /** GET /mensajes?celular=... → hilo de la conversación. */
  getMensajes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const celularRaw = typeof req.query.celular === 'string' ? req.query.celular : '';
      if (!celularRaw) {
        res.status(400).json({ success: false, error: 'celular requerido' });
        return;
      }
      const celular = normalizarCelular(celularRaw);
      const mensajes = await postgresService.getMensajesPorCelular(celular);
      res.status(200).json({ success: true, celular, mensajes });
    } catch (error) {
      next(error);
    }
  };

  /** POST /mensajes { celular, texto } → responde al paciente y guarda el saliente. */
  sendReply = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { celular: celularRaw, texto } = (req.body ?? {}) as { celular?: string; texto?: string };
      if (!celularRaw || !texto || !texto.trim()) {
        res.status(400).json({ success: false, error: 'celular y texto requeridos' });
        return;
      }
      const celular = normalizarCelular(celularRaw);

      const result = await whatsappService.sendTextMessage(celular, texto.trim());
      if (!result.success) {
        // 63016 = fuera de la ventana de 24h (WhatsApp no permite texto libre).
        res.status(422).json({
          success: false,
          error: result.error || 'No se pudo enviar el mensaje.',
          hint: 'WhatsApp solo permite responder texto libre dentro de las 24h desde el último mensaje del paciente.',
        });
        return;
      }

      const saved = await postgresService.registrarMensajeSaliente(
        celular,
        texto.trim(),
        result.messageSid || ''
      );
      const id = saved?.mensajeId ?? 0;
      const createdAt = saved?.createdAt ?? new Date().toISOString();
      whatsappChatService.emitNuevoMensaje({
        celular,
        id,
        direccion: 'saliente',
        contenido: texto.trim(),
        tipoMensaje: 'text',
        mediaUrl: null,
        createdAt,
      });

      res.status(200).json({
        success: true,
        mensaje: { id, direccion: 'saliente', contenido: texto.trim(), tipoMensaje: 'text', mediaUrl: null, createdAt },
      });
    } catch (error) {
      next(error);
    }
  };
}

export default new WhatsappChatController();
