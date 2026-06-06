// ============================================================================
// trepsi-webhook.controller — Endpoint admin para la cola del webhook Trepsi.
//
// Protegido por JWT (montado bajo `requireAuthMiddleware`).
// GET    /api/admin/trepsi-webhook/queue        → últimas N filas
// POST   /api/admin/trepsi-webhook/queue/:id/retry → re-encola fila
// POST   /api/admin/trepsi-webhook/dispatch     → fuerza dispatch ahora
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import trepsiWebhookService from '../services/trepsi-webhook.service';

class TrepsiWebhookController {
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await trepsiWebhookService.listRecent(limit);
      res.status(200).json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  };

  retry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, error: 'INVALID_ID' });
        return;
      }
      const result = await trepsiWebhookService.retry(id);
      if (!result.ok) {
        res.status(404).json({ success: false, error: 'NOT_FOUND' });
        return;
      }
      // Disparar dispatch inmediato sin esperar al setInterval.
      trepsiWebhookService.dispatchPending().catch(() => {});
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  dispatch = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await trepsiWebhookService.dispatchPending();
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };
}

export default new TrepsiWebhookController();
