// ============================================================================
// Router /api/empresas/* — Catálogo de empresas cliente.
//
// El listado lo consume el panel del médico corporativo (campo "Empresa" del
// examen ocupacional); el alta y la baja, el panel de coordinador.
//
// El gating NO es uniforme y por eso va por ruta, no en el mount: el médico
// corporativo tiene que poder LEER el catálogo para llenar su formulario, pero
// dar de alta una empresa es del coordinador. Montarlo todo con el rol más
// estricto dejaría al médico sin poder escoger empresa.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import empresasService from '../services/empresas.service';
import { getSession, requireRole } from '../middleware/rbac.middleware';

const router = Router();

const crearSchema = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(200),
  // Opcional, pero es la llave con la que algún día se cruzarán estas empresas
  // con las de ACC: dos nombres escritos distinto son el mismo NIT.
  nit: z
    .string()
    .trim()
    .regex(/^[0-9-]{5,20}$/, 'El NIT debe ser dígitos, con guion opcional.')
    .nullable()
    .optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const incluirInactivas = req.query.todas === '1';
    res.json({ success: true, data: await empresasService.listar(incluirInactivas) });
  } catch (e) {
    next(e);
  }
});

router.post('/', requireRole('admin', 'coordinador'), async (req: Request, res: Response, next: NextFunction) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
    });
    return;
  }
  try {
    const empresa = await empresasService.crear({
      nombre: parsed.data.nombre,
      nit: parsed.data.nit ?? null,
      creadaPor: getSession(req)?.email,
    });
    res.status(201).json({ success: true, data: empresa });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin', 'coordinador'), async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return;
  }
  try {
    const ok = await empresasService.desactivar(id);
    if (!ok) {
      res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
