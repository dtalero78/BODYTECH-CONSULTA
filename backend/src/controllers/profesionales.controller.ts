// ============================================================================
// profesionales.controller — HTTP handlers para /api/profesionales/*.
//
// Sigue el envelope { success, data?, error? } del resto del backend (NO el
// envelope { ok, error } que usa Trepsi, porque este es para uso interno).
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import profesionalesService from '../services/profesionales.service';
import disponibilidadService from '../services/disponibilidad.service';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const rolEnum = z.enum(['medico', 'coach']);
const modalidadEnum = z.enum(['presencial', 'virtual']);

const profesionalCreateSchema = z.object({
  rol: rolEnum,
  codigo: z.string().min(1).max(80),
  primerNombre: z.string().min(1).max(100),
  segundoNombre: z.string().max(100).nullable().optional(),
  primerApellido: z.string().min(1).max(100),
  segundoApellido: z.string().max(100).nullable().optional(),
  alias: z.string().max(200).nullable().optional(),
  especialidad: z.string().max(120).nullable().optional(),
  numeroLicencia: z.string().max(80).nullable().optional(),
  tipoLicencia: z.string().max(80).nullable().optional(),
  fechaVencimientoLicencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD.')
    .nullable()
    .optional(),
  tiempoConsulta: z.number().int().min(5).max(240).optional(),
  firma: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  celular: z.string().nullable().optional(),
});

const profesionalUpdateSchema = profesionalCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Debe enviar al menos un campo.'
);

const rangoSchema = z.object({
  horaInicio: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/, 'Formato HH:MM.'),
  horaFin: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/, 'Formato HH:MM.'),
});

const diaRangosSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  rangos: z.array(rangoSchema),
});

const disponibilidadReplaceSchema = z.object({
  modalidad: modalidadEnum,
  dias: z.array(diaRangosSchema),
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

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class ProfesionalesController {
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const rolRaw = req.query.rol;
      const activoRaw = req.query.activo;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      let rol: 'medico' | 'coach' | undefined;
      if (typeof rolRaw === 'string' && (rolRaw === 'medico' || rolRaw === 'coach')) {
        rol = rolRaw;
      }
      let activo: boolean | undefined;
      if (activoRaw === 'true') activo = true;
      else if (activoRaw === 'false') activo = false;

      const result = await profesionalesService.list({
        sedeId,
        rol,
        activo,
        search,
      });
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const result = await profesionalesService.getById(id, sedeId);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const parsed = profesionalCreateSchema.safeParse(req.body);
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
      const result = await profesionalesService.create(parsed.data, sedeId);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(result.status).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const parsed = profesionalUpdateSchema.safeParse(req.body);
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
      const result = await profesionalesService.update(id, sedeId, parsed.data);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const result = await profesionalesService.softDelete(id, sedeId);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  // -------------------------------------------------------------------------
  // Disponibilidad
  // -------------------------------------------------------------------------

  getDisponibilidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';
      const result = await disponibilidadService.getByProfesional(id, sedeId, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  replaceDisponibilidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const parsed = disponibilidadReplaceSchema.safeParse(req.body);
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
      const result = await disponibilidadService.replace(
        id,
        sedeId,
        parsed.data.modalidad,
        parsed.data.dias
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

  deleteDiaDisponibilidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const dia = Number(req.params.dia);
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';
      const result = await disponibilidadService.deleteDia(id, sedeId, dia, modalidad);
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

export default new ProfesionalesController();
