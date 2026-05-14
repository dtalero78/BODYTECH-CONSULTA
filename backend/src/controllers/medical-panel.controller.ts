import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import medicalPanelService, {
  OrdenCreateInput,
  OrdenUpdateInput,
} from '../services/medical-panel.service';

// ============================================================================
// Zod schemas (privados al controller).
// Validan request shape. Mensajes de dominio en español que devolvían
// previamente los handlers (ej. "Campos requeridos: ...") se reemplazan por
// el shape uniforme `{ success: false, error: 'VALIDATION_ERROR', details }`
// — decisión acordada en spec (consistencia > preservar texto literal).
//
// NOTA: el spec menciona un endpoint `login`. En este controller NO existe;
// no se infiere ni se inventa. Si en el futuro se agrega, debe usar el mismo
// patrón Zod aquí.
// ============================================================================

const medicoCodeParamsSchema = z.object({
  medicoCode: z.string().min(1),
});

const pendingPatientsQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const documentoParamsSchema = z.object({
  documento: z.string().min(1),
});

const patientIdParamsSchema = z.object({
  patientId: z.string().min(1),
});

const ordenIdParamsSchema = z.object({
  id: z.string().min(1),
});

const fechaAtencionRegex = /^\d{4}-\d{2}-\d{2}$/;
const horaAtencionRegex = /^\d{2}:\d{2}$/;

const createOrdenSchema = z.object({
  primerNombre: z.string().min(1),
  primerApellido: z.string().min(1),
  numeroId: z.string().min(1),
  celular: z.string().min(1),
  medico: z.string().min(1),
  fechaAtencion: z.string().regex(fechaAtencionRegex, 'fechaAtencion debe tener formato YYYY-MM-DD'),
  horaAtencion: z.string().regex(horaAtencionRegex, 'horaAtencion debe tener formato HH:MM'),
  segundoNombre: z.string().optional(),
  segundoApellido: z.string().optional(),
  empresa: z.string().optional(),
  codEmpresa: z.string().optional(),
  tipoExamen: z.string().optional(),
  examenes: z.string().optional(),
  ciudad: z.string().optional(),
});

const updateOrdenBodySchema = z.object({
  primerNombre: z.string().optional(),
  segundoNombre: z.string().optional(),
  primerApellido: z.string().optional(),
  segundoApellido: z.string().optional(),
  numeroId: z.string().optional(),
  celular: z.string().optional(),
  empresa: z.string().optional(),
  codEmpresa: z.string().optional(),
  tipoExamen: z.string().optional(),
  examenes: z.string().optional(),
  medico: z.string().optional(),
  fechaAtencion: z
    .string()
    .regex(fechaAtencionRegex, 'fechaAtencion debe tener formato YYYY-MM-DD')
    .optional(),
  horaAtencion: z
    .string()
    .regex(horaAtencionRegex, 'horaAtencion debe tener formato HH:MM')
    .optional(),
  ciudad: z.string().optional(),
  atendido: z.string().optional(),
});

const listOrdenesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional(),
  medico: z.string().optional(),
  q: z.string().optional(),
});

function validationResponse(res: Response, err: ZodError): void {
  res.status(400).json({
    success: false,
    error: 'VALIDATION_ERROR',
    details: err.errors,
  });
}

class MedicalPanelController {
  /**
   * Obtiene estadísticas del día para un médico
   */
  async getDailyStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = medicoCodeParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { medicoCode } = parsed.data;

    try {
      const stats = await medicalPanelService.getDailyStats(medicoCode);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtiene lista paginada de pacientes pendientes del día
   */
  async getPendingPatients(req: Request, res: Response, next: NextFunction): Promise<void> {
    const paramsParsed = medicoCodeParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return validationResponse(res, paramsParsed.error);
    }
    const queryParsed = pendingPatientsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      return validationResponse(res, queryParsed.error);
    }

    const { medicoCode } = paramsParsed.data;
    const page = queryParsed.data.page ?? 0;
    const pageSize = queryParsed.data.pageSize ?? 10;

    try {
      const result = await medicalPanelService.getPendingPatients(medicoCode, page, pageSize);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Busca un paciente por documento de identidad
   */
  async searchPatientByDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = documentoParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { documento } = parsed.data;

    try {
      const patient = await medicalPanelService.searchPatientByDocument(documento);

      if (!patient) {
        res.status(404).json({ error: 'Paciente no encontrado' });
        return;
      }

      res.json(patient);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Marca un paciente como "No Contesta"
   */
  async markAsNoAnswer(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = patientIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { patientId } = parsed.data;

    try {
      const updated = await medicalPanelService.markPatientAsNoAnswer(patientId);

      if (!updated) {
        res.status(404).json({ error: 'Paciente no encontrado' });
        return;
      }

      res.json({ success: true, message: 'Paciente marcado como "No Contesta"' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtiene detalles completos de un paciente
   */
  async getPatientDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = documentoParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { documento } = parsed.data;

    try {
      const patientDetails = await medicalPanelService.getPatientDetails(documento);

      if (!patientDetails) {
        res.status(404).json({ error: 'Paciente no encontrado' });
        return;
      }

      res.json(patientDetails);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD de Órdenes
  // ---------------------------------------------------------------------------

  /**
   * GET /ordenes — lista órdenes con filtros opcionales
   */
  async listOrdenes(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = listOrdenesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { page, limit, from, to, status, medico, q } = parsed.data;

    try {
      const result = await medicalPanelService.listOrdenes({
        page: page ?? 0,
        limit: limit ?? 20,
        from,
        to,
        status,
        medico,
        q,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ordenes — crea una nueva orden
   */
  async createOrden(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = createOrdenSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const data = parsed.data;

    try {
      const orden = await medicalPanelService.createOrden(data as OrdenCreateInput);
      res.status(201).json({ success: true, orden });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /ordenes/:id — actualiza campos de una orden existente
   */
  async updateOrden(req: Request, res: Response, next: NextFunction): Promise<void> {
    const paramsParsed = ordenIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return validationResponse(res, paramsParsed.error);
    }
    const bodyParsed = updateOrdenBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      return validationResponse(res, bodyParsed.error);
    }
    const { id } = paramsParsed.data;
    const fields = bodyParsed.data as OrdenUpdateInput;

    try {
      const updated = await medicalPanelService.updateOrden(id, fields);

      if (!updated) {
        res.status(404).json({ error: 'Orden no encontrada' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /ordenes/:id — elimina una orden
   */
  async deleteOrden(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = ordenIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationResponse(res, parsed.error);
    }
    const { id } = parsed.data;

    try {
      const deleted = await medicalPanelService.deleteOrden(id);

      if (!deleted) {
        res.status(404).json({ error: 'Orden no encontrada' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

export default new MedicalPanelController();
