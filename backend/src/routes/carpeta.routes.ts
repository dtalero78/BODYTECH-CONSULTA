// ============================================================================
// Router /api/carpeta/* — LA historia clínica de la persona.
//
// Devuelve todo lo que se le ha hecho a alguien, venga de la aplicación que
// venga, ordenado de lo más reciente a lo más viejo. Es lo que le permite al
// médico de la UMV leer lo que ya escribió el nutricionista de Trepsi.
//
// Las entradas por atención las escribe cada aplicación desde su propio
// backend, al guardar. Lo que sí se escribe por acá son los datos de la
// PERSONA —antecedentes, alergias, condiciones, medicamentos—, que cualquiera
// de los cuatro servicios completa y nadie sobrescribe: corregir deja la fila
// vieja marcada, con quién y por qué.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import carpetaService from '../services/carpeta.service';
import { getSession } from '../middleware/rbac.middleware';

const router = Router();

const problemaSchema = z.object({
  tipo: z.enum(['antecedente', 'alergia', 'condicion', 'medicamento']),
  descripcion: z.string().trim().min(2, 'Escribí qué es.').max(500),
  servicio: z.enum(['trepsi', 'corporativo', 'umv', 'acc', 'prepagadas', 'nativa']),
});

router.get('/:documento', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const carpeta = await carpetaService.leer(String(req.params.documento));
    if (!carpeta) {
      // No es un error: es alguien que se atiende por primera vez.
      res.json({ success: true, data: { documento: req.params.documento, nombre: null, entradas: [] } });
      return;
    }
    res.json({ success: true, data: carpeta });
  } catch (e) {
    next(e);
  }
});

/** Agrega un antecedente, alergia, condición o medicamento a la persona. */
router.post('/:documento/problemas', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = problemaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
    });
    return;
  }
  try {
    const id = await carpetaService.agregarProblema({
      documento: String(req.params.documento),
      ...parsed.data,
      // Quién lo escribió queda en la fila: en una historia clínica hay que
      // poder responder eso.
      registradoPor: getSession(req)?.email ?? null,
    });
    if (id === null) {
      res.status(400).json({ success: false, error: 'DATOS_INSUFICIENTES' });
      return;
    }
    res.status(201).json({ success: true, id });
  } catch (e) {
    next(e);
  }
});

/** Corrige uno. No lo borra: lo marca no vigente y deja la nota. */
router.post('/problemas/:id/corregir', async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return;
  }
  try {
    const ok = await carpetaService.corregirProblema(
      id,
      getSession(req)?.email ?? null,
      typeof req.body?.nota === 'string' ? req.body.nota.slice(0, 500) : null,
    );
    res.json({ success: ok });
  } catch (e) {
    next(e);
  }
});

export default router;
