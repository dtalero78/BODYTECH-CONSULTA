// ============================================================================
// calendario.controller — HTTP wrappers para /api/calendario/*.
//
// Envelope: { success, data?, error? } (mismo que el resto del backend
// interno, NO el envelope `{ ok }` que usa la integración Trepsi).
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import calendarioService from '../services/calendario.service';
import disponibilidadFechaService from '../services/disponibilidad-fecha.service';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const modalidadEnum = z.enum(['presencial', 'virtual']);

const reasignarSchema = z.object({
  citaIds: z.array(z.string().min(1)).min(1).max(200),
  nuevoMedicoCodigo: z.string().min(1),
  nuevaFechaAtencion: z.string().optional(),
  nuevaHoraAtencion: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'horaAtencion debe ser HH:MM.')
    .optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodErrorToDetails(err: ZodError) {
  return err.errors.map((e) => ({
    field: e.path.join('.') || '(root)',
    issue: e.message,
  }));
}

function getSedeId(req: Request): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedeId = (req as any).sedeId;
  return typeof sedeId === 'string' && sedeId.length > 0 ? sedeId : 'bsl';
}

function parseIntOrNull(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class CalendarioController {
  getMes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const year = parseIntOrNull(req.query.year);
      const month = parseIntOrNull(req.query.month);
      const medico = typeof req.query.medico === 'string' && req.query.medico ? req.query.medico : undefined;

      if (year === null || month === null) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'year y month son requeridos (números).' },
        });
        return;
      }

      const result = await calendarioService.getMes(year, month, sedeId, medico);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  getDia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      const medico = typeof req.query.medico === 'string' && req.query.medico ? req.query.medico : undefined;

      if (!fecha) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'fecha es requerida (YYYY-MM-DD).' },
        });
        return;
      }

      const result = await calendarioService.getDia(fecha, sedeId, medico);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  getHorariosDisponibles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      const profesionalId = parseIntOrNull(req.query.profesionalId);
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';

      if (!fecha || profesionalId === null) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'fecha (YYYY-MM-DD) y profesionalId son requeridos.',
          },
        });
        return;
      }

      // Validar modalidad
      const parsedMod = modalidadEnum.safeParse(modalidad);
      if (!parsedMod.success) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_MODALIDAD', message: 'modalidad debe ser presencial o virtual.' },
        });
        return;
      }

      const result = await calendarioService.getHorariosDisponibles(
        fecha,
        profesionalId,
        sedeId,
        parsedMod.data
      );
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  getDisponibilidadDia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';

      if (!fecha) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'fecha es requerida (YYYY-MM-DD).' },
        });
        return;
      }

      const result = await disponibilidadFechaService.getDiaResumen(sedeId, fecha, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  getDisponibilidadMes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const year = parseIntOrNull(req.query.year);
      const month = parseIntOrNull(req.query.month);
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';

      if (year === null || month === null) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'year y month son requeridos (números).' },
        });
        return;
      }

      const result = await calendarioService.getDisponibilidadMes(year, month, sedeId, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  reasignarBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const parsed = reasignarSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodErrorToDetails(parsed.error),
          },
        });
        return;
      }
      const result = await calendarioService.reasignarBulk(
        parsed.data.citaIds,
        sedeId,
        parsed.data.nuevoMedicoCodigo,
        parsed.data.nuevaFechaAtencion,
        parsed.data.nuevaHoraAtencion
      );
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };
}

export default new CalendarioController();
