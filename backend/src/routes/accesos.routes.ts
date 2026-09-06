// ============================================================================
// Router /api/accesos/* — Quién tiene acceso a qué aplicación.
//
// Fase 1 de la unificación del login: NO autentica ni cambia el inicio de
// sesión. Sólo deja ver, en un lugar, lo que hoy exige mirar en tres bases.
//
// Sólo admin: muestra el mapa de accesos de toda la organización.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import accesosSyncService from '../services/accesos-sync.service';

const router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [personas, resumen] = await Promise.all([
      accesosSyncService.listar(),
      accesosSyncService.resumen(),
    ]);
    res.json({ success: true, data: personas, resumen });
  } catch (e) {
    next(e);
  }
});

/** Fuerza el reflejo ahora, sin esperar al barrido periódico. */
router.post('/sincronizar', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await accesosSyncService.sincronizar() });
  } catch (e) {
    next(e);
  }
});

export default router;
