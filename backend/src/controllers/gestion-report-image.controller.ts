// ============================================================================
// gestion-report-image.controller — sirve el PNG del tablero de gestión por
// token (URL pública, SIN auth) para que Twilio lo tome como header de media.
// El token es aleatorio (18 bytes) y la imagen expira a las 24 h.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import gestionReportImageService from '../services/gestion-report-image.service';

class GestionReportImageController {
  serve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Acepta ".../:token" o ".../:token.png".
      const raw = String(req.params.token || '');
      const token = raw.replace(/\.png$/i, '');
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        res.status(404).end();
        return;
      }
      const png = await gestionReportImageService.fetch(token);
      if (!png) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', png.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).end(png);
    } catch (err) {
      next(err);
    }
  };
}

export default new GestionReportImageController();
