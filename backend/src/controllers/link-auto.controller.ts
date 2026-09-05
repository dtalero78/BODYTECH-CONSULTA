// ============================================================================
// link-auto.controller — operación del envío automático del link (admin).
//
// El envío normal lo hace el worker de index.ts. Estos endpoints existen para
// las dos preguntas que aparecen apenas se prende: "¿a quién le va a llegar?"
// (dispatch con dryRun) y "¿a quién le llegó y qué falló?" (estado).
//
// El dry-run corre EXACTAMENTE el mismo camino de decisión que el envío real
// —la misma query, la misma preparación— pero no escribe nada. Es lo que
// permite validar los filtros contra datos reales sin mandarle nada a nadie.
//
// Envelope: { success, data?, error? }.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import linkAutoService from '../services/link-auto.service';
import { nowColombia } from '../helpers/colombia-time.helper';

function fechaDe(req: Request): string {
  const raw = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : nowColombia().fecha;
}

class LinkAutoController {
  /**
   * POST /api/admin/link-auto/dispatch?tipo=link|recordatorio&fecha=&dryRun=1&limit=N&historiaId=
   *
   * Fuerza una pasada sin esperar la hora ni el flag. `dryRun=1` no escribe
   * nada; `historiaId` acota a una sola cita (la prueba end-to-end de un envío
   * real contra un número conocido).
   */
  dispatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
      const limitRaw = Number(req.query.limit);
      const historiaId =
        typeof req.query.historiaId === 'string' && req.query.historiaId
          ? req.query.historiaId
          : undefined;

      // Qué mensaje: 'recordatorio' (07:00, sin link) o 'link' (minutos antes).
      const tipo = req.query.tipo === 'recordatorio' ? 'recordatorio' : 'link';

      const resumen = await linkAutoService.dispatch(fechaDe(req), {
        tipo,
        dryRun,
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
        historiaId,
      });

      res.status(200).json({ success: true, data: resumen });
    } catch (err) {
      next(err);
    }
  };

  /** GET /api/admin/link-auto/estado?fecha= — la bitácora del día. */
  estado = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await linkAutoService.getEstado(fechaDe(req));
      if (data === null) {
        res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: 'Error consultando la bitácora.' },
        });
        return;
      }
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

export default new LinkAutoController();
