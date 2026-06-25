// Controller del webhook de WHAPI para capturar la "entidad" del lead.
import { Request, Response } from 'express';
import whatsappLeadsService from '../services/whatsapp-leads.service';

class WhatsappLeadsController {
  /**
   * Webhook que WHAPI llama en cada mensaje. Responde 200 de inmediato (WHAPI
   * reintenta si no recibe 2xx rápido) y procesa en background.
   *
   * Seguridad opcional: si WHAPI_WEBHOOK_SECRET está configurado, se exige que
   * el request lo traiga en `?secret=` o en el header `x-webhook-secret`.
   */
  webhook = (req: Request, res: Response): void => {
    const expected = process.env.WHAPI_WEBHOOK_SECRET;
    if (expected) {
      const got = (req.query.secret as string) || (req.headers['x-webhook-secret'] as string) || '';
      if (got !== expected) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }
    }

    // Responder ya; procesar después (no bloquear a WHAPI).
    res.status(200).json({ ok: true });

    const body = req.body;
    whatsappLeadsService.handleWhapiWebhook(body).catch((e) => {
      console.error('[whatsapp-leads] error en handleWhapiWebhook:', e?.message ?? e);
    });
  };

  /** Salud simple del módulo (útil para verificar el deploy). */
  health = (_req: Request, res: Response): void => {
    res.status(200).json({
      ok: true,
      module: 'whatsapp-leads',
      sheetConfigured: Boolean(process.env.GSHEET_WEBAPP_URL),
    });
  };
}

export default new WhatsappLeadsController();
