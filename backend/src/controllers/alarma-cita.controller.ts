// ============================================================================
// alarma-cita.controller — operación de la alarma "cita sin profesional
// conectado" (admin).
//
// El aviso normal lo manda el worker de index.ts. Estos endpoints existen para
// las tres preguntas que aparecen apenas se prende: "¿qué saldría al grupo?"
// (dispatch con dryRun), "¿qué salió hoy?" (estado) y "¿cuál es el id del
// grupo?" (grupos, que se consulta UNA vez para llenar la variable de entorno).
//
// Envelope: { success, data?, error? }.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import alarmaCitaService from '../services/alarma-cita.service';
import whapiService from '../services/whapi.service';
import { nowColombia } from '../helpers/colombia-time.helper';

function fechaDe(req: Request): string {
  const raw = typeof req.query.fecha === 'string' ? req.query.fecha : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : nowColombia().fecha;
}

class AlarmaCitaController {
  /**
   * POST /api/admin/alarma-cita/dispatch?fecha=&dryRun=1&limit=N
   * Fuerza una pasada sin esperar el barrido. `dryRun=1` devuelve el mensaje
   * exacto que habría salido al grupo, sin escribir ni enviar nada.
   */
  dispatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
      const limitRaw = Number(req.query.limit);
      const data = await alarmaCitaService.dispatch(fechaDe(req), {
        dryRun,
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
      });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  /** GET /api/admin/alarma-cita/estado?fecha= — la bitácora del día. */
  estado = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await alarmaCitaService.getEstado(fechaDe(req));
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

  /**
   * GET /api/admin/alarma-cita/grupos — los grupos del canal de WHAPI, con su
   * id. Es la única forma de saber el id del grupo "Soporte de HC virtuales":
   * no se puede escribir a mano ni deducir del nombre.
   */
  grupos = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await whapiService.listarGrupos();
      if (data === null) {
        res.status(500).json({
          success: false,
          error: { code: 'WHAPI_ERROR', message: 'Sin WHAPI_TOKEN o WHAPI no respondió.' },
        });
        return;
      }
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

export default new AlarmaCitaController();
