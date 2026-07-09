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
import postgresService from '../services/postgres.service';
import { getSession, canActOnSede, effectiveSedes } from '../middleware/rbac.middleware';

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

// Sede para operaciones de UNA sede (disponibilidad-dia). RBAC: `?sede` en
// alcance manda; si no, la (primera) sede del usuario. Sin sesión, legacy.
function getSedeId(req: Request): string {
  const session = getSession(req);
  if (session) {
    const q = typeof req.query.sede === 'string' ? req.query.sede : '';
    if (q && canActOnSede(req, q)) return q;
    return session.sedes[0] ?? 'bsl';
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedeId = (req as any).sedeId;
  return typeof sedeId === 'string' && sedeId.length > 0 ? sedeId : 'bsl';
}

function parseSedesQuery(req: Request): string[] | undefined {
  const raw = req.query.sedes;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length > 0) return list;
  }
  return undefined;
}

/**
 * Sedes efectivas a consultar para vistas multi-sede del calendario, CONSTREÑIDAS
 * al alcance del usuario (RBAC). Un coordinador no ve sedes ajenas aunque las
 * pida. Admin/global sin filtro → todas las sedes activas.
 */
async function resolveSedes(req: Request): Promise<string[]> {
  const eff = effectiveSedes(req, parseSedesQuery(req));
  if (eff) return eff;
  // admin/global sin filtro explícito → todas las sedes activas.
  const rows = await postgresService.query(`SELECT sede_id FROM sedes WHERE activa = true`);
  return rows ? rows.map((r: { sede_id: string }) => r.sede_id) : [];
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
      const sedes = await resolveSedes(req);
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

      const result = await calendarioService.getMes(year, month, sedes, medico);
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
      const sedes = await resolveSedes(req);
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      const medico = typeof req.query.medico === 'string' && req.query.medico ? req.query.medico : undefined;

      if (!fecha) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'fecha es requerida (YYYY-MM-DD).' },
        });
        return;
      }

      const result = await calendarioService.getDia(fecha, sedes, medico);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  getIndicadores = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedes = await resolveSedes(req);
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const medico =
        typeof req.query.medico === 'string' && req.query.medico ? req.query.medico : undefined;

      if (!from || !to) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'from y to son requeridos (YYYY-MM-DD).' },
        });
        return;
      }

      const result = await calendarioService.getIndicadores(from, to, sedes, medico);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  getNoContacto = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedes = await resolveSedes(req);
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const medico = typeof req.query.medico === 'string' ? req.query.medico : '';

      if (!from || !to || !medico) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'from, to y medico son requeridos.' },
        });
        return;
      }

      const result = await calendarioService.getNoContactoDetalle(from, to, sedes, medico);
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
      // `sede` opcional permite ver la disponibilidad de otra sede desde el modal
      // del día. RBAC: getSedeId valida que el `?sede` esté en el alcance del
      // usuario (canActOnSede); si no lo está, cae a la sede propia.
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
      const sedes = await resolveSedes(req);
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

      const result = await calendarioService.getDisponibilidadMes(year, month, sedes, modalidad);
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
