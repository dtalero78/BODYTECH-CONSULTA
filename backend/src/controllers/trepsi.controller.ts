// ============================================================================
// trepsi.controller — HTTP wrappers para la integración Trepsi.
//
// Sigue el envelope { ok, error: { code, message, details? } } definido en la
// spec v2.1 (sección 7 — Códigos de respuesta). Es DIFERENTE al envelope
// `{ success, ... }` del resto de la API porque este contrato es público hacia
// un tercero y ya está documentado en el PDF.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import trepsiService from '../services/trepsi.service';

// ---------------------------------------------------------------------------
// Zod schemas (espejo de la spec)
// ---------------------------------------------------------------------------

const medicoSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().optional(),
  especialidad: z.string().optional(),
});

const pacienteSchema = z.object({
  numeroId: z.string().min(1).regex(/^\d+$/, 'numeroId debe contener sólo dígitos.'),
  tipoDocumento: z.enum(['CC', 'CE', 'TI', 'PA', 'RC']),
  primerNombre: z.string().min(1),
  segundoNombre: z.string().optional(),
  primerApellido: z.string().min(1),
  segundoApellido: z.string().optional(),
  fechaNacimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaNacimiento debe ser YYYY-MM-DD.'),
  sexo: z.enum(['M', 'F', 'Otro']).optional(),
  celular: z
    .string()
    .regex(/^\+\d{8,15}$/, 'celular debe estar en formato E.164 (ej. +573001234567).'),
  email: z.string().email().optional(),
  direccion: z.string().optional(),
  ciudad: z.string().optional(),
  eps: z.string().optional(),
});

const historiaClinicaSchema = z
  .object({
    motivoConsulta: z.string().min(1),
    consentimientoInformado: z.literal(true, {
      errorMap: () => ({ message: 'consentimientoInformado debe ser true.' }),
    }),
  })
  .passthrough(); // aceptamos campos adicionales (antecedentes, hábitos, adjuntos, etc.)

const iso8601WithOffsetRegex =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const createSchema = z.object({
  citaId: z.string().min(1).max(120),
  fechaAtencion: z
    .string()
    .regex(iso8601WithOffsetRegex, 'fechaAtencion debe ser ISO 8601 con offset.'),
  duracionMinutos: z.number().int().min(15).max(120).optional(),
  medico: medicoSchema,
  paciente: pacienteSchema,
  historiaClinica: historiaClinicaSchema,
  tipoConsulta: z.string().optional(),
  sede: z.string().optional(),
  observaciones: z.string().max(1000).optional(),
});

const scheduleSchema = z
  .object({
    fechaAtencion: z
      .string()
      .regex(iso8601WithOffsetRegex, 'fechaAtencion debe ser ISO 8601 con offset.')
      .optional(),
    duracionMinutos: z.number().int().min(15).max(120).optional(),
    medico: medicoSchema.optional(),
    motivo: z.string().optional(),
  })
  .refine(
    (v) => v.fechaAtencion || v.duracionMinutos != null || v.medico,
    'Debe enviar al menos uno de: fechaAtencion, duracionMinutos, medico.'
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodToDetails(err: ZodError) {
  return err.errors.map((e) => ({
    field: e.path.join('.') || '(root)',
    issue: e.message,
  }));
}

function respond<T>(
  res: Response,
  result: { ok: boolean; status: number; data?: T; error?: { code: string; message: string } }
): void {
  if (result.ok) {
    res.status(result.status).json({ ok: true, ...(result.data as object) });
    return;
  }
  res.status(result.status).json({
    ok: false,
    error: result.error,
  });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class TrepsiController {
  createAppointment = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodToDetails(parsed.error),
          },
        });
        return;
      }

      const result = await trepsiService.createAppointment(parsed.data);

      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          historiaClinicaId: result.data.historiaClinicaId,
          fechaAtencion: result.data.fechaAtencion,
          estado: result.data.estado,
          createdAt: result.data.createdAt,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  reschedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }

      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodToDetails(parsed.error),
          },
        });
        return;
      }

      const result = await trepsiService.reschedule(citaId, parsed.data);

      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          fechaAtencion: result.data.fechaAtencion,
          estado: result.data.estado,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }
      const result = await trepsiService.cancel(citaId);
      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          status: 'cancelled',
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }
      const result = await trepsiService.get(citaId);
      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          historiaClinicaId: result.data.historiaClinicaId,
          estado: result.data.estado,
          fechaAtencion: result.data.fechaAtencion,
          duracionMinutos: result.data.duracionMinutos,
          medico: result.data.medicoCodigo ? { codigo: result.data.medicoCodigo } : null,
          createdAt: result.data.createdAt,
          updatedAt: result.data.updatedAt,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };
}

export default new TrepsiController();
