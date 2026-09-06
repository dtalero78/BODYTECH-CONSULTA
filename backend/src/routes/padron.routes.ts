// ============================================================================
// Router /api/padron/*  — Identidad de afiliados.
//
// Hoy sólo el COTEJO (solo lectura). El padrón único de afiliados va a vivir
// acá cuando exista; se separa desde ahora porque es su propio dominio y no
// pertenece ni al panel médico ni al directorio de la cadena.
//
// El gating por rol va en el mount (`index.ts`), como el resto de los routers
// protegidos: esto devuelve nombres y cédulas de pacientes.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import padronService from '../services/padron.service';
import { effectiveSedes } from '../middleware/rbac.middleware';
import type { EstadoIdentidad } from '../helpers/padron.helper';

const router = Router();

const ESTADOS: ReadonlyArray<EstadoIdentidad> = [
  'conflicto',
  'unificable',
  'administrativo',
  'unico',
];

/**
 * GET /api/padron/cotejo?estado=&q=&limit=
 *
 * `resumen` cuenta SIEMPRE sobre el universo completo del actor, no sobre lo
 * filtrado: si al filtrar por "conflicto" el total cambiara, no se podría saber
 * cuántos conflictos hay sobre cuántas personas.
 */
router.get('/cotejo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { filas, resumen } = await padronService.cotejo(effectiveSedes(req));

    const estado = typeof req.query.estado === 'string' ? req.query.estado : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const limit = Math.min(Number(req.query.limit) || 200, 1000);

    let data = filas;
    if (ESTADOS.includes(estado as EstadoIdentidad)) {
      data = data.filter((f) => f.estado === estado);
    }
    if (q) {
      data = data.filter(
        (f) =>
          f.documento.includes(q) ||
          f.variantes.some((v) => v.toLowerCase().includes(q)),
      );
    }

    res.json({
      success: true,
      data: data.slice(0, limit),
      truncado: data.length > limit,
      coincidencias: data.length,
      resumen,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
