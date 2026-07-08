// ============================================================================
// gestion-report.controller — disparo manual del Informe de Gestión (admin).
//
// El envío normal es un worker diario (index.ts). Este endpoint permite forzar
// el envío del día para probar/reenviar sin esperar la hora objetivo. NO toca la
// marca `gestion_report_log`, así que el cron del día sigue corriendo aparte.
//
// Envelope: { success, data?, error? }.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import gestionReportService from '../services/gestion-report.service';

/** Fecha de hoy en Colombia (UTC-5) como YYYY-MM-DD. */
function todayColombia(): string {
  const c = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, '0');
  const d = String(c.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

class GestionReportController {
  /**
   * POST /api/admin/gestion-report/dispatch?fecha=YYYY-MM-DD
   * Fuerza el envío del informe (por defecto, hoy) a los admins con celular.
   */
  dispatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayColombia();

      if (!process.env.TWILIO_WHATSAPP_GESTION_TEMPLATE_SID) {
        res.status(503).json({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_CONFIGURED',
            message: 'TWILIO_WHATSAPP_GESTION_TEMPLATE_SID no está configurado.',
          },
        });
        return;
      }

      const resumen = await gestionReportService.enviarInformeDiario(fecha);
      res.status(200).json({ success: true, data: resumen });
    } catch (err) {
      next(err);
    }
  };
}

export default new GestionReportController();
