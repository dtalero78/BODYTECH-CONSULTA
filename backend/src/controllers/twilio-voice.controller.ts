import { Request, Response } from 'express';
import twilioVoiceService from '../services/twilio-voice.service';

export class TwilioVoiceController {
  /**
   * GET /api/twilio/voice-twiml
   * Webhook TwiML: reproduce el audio de bienvenida de Bodytech
   */
  voiceTwiml(_req: Request, res: Response): void {
    const audioUrl = 'https://bodytech.app/pbxBody.mp3';
    res.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Play>${audioUrl}</Play></Response>`
    );
  }

  /**
   * POST /api/twilio/voice-call
   * Realiza una llamada de voz usando Twilio
   */
  async makeVoiceCall(req: Request, res: Response): Promise<void> {
    try {
      const { phoneNumber, patientName } = req.body;

      if (!phoneNumber) {
        res.status(400).json({
          success: false,
          error: 'Phone number is required'
        });
        return;
      }

      const result = await twilioVoiceService.makeVoiceCall(phoneNumber, patientName || 'paciente');

      if (result.success) {
        res.status(200).json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error: any) {
      // No exponer error.message ni stack al cliente (puede contener detalles
      // de Twilio / credenciales). Loguear internamente para diagnóstico.
      console.error('Error in makeVoiceCall controller:', error);
      res.status(500).json({
        success: false,
        error: 'Error making voice call'
      });
    }
  }
}

export default new TwilioVoiceController();
