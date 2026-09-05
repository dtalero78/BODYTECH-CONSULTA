// ============================================================================
// Router /api/directorio/*  — Base Profesionales (privado).
//
// Lectura del directorio compartido `bodytech_profesionales`: sedes, planta y
// quién atiende dónde. Es la misma base que lee BODYTECH-ACC.
//
//   GET /resumen        → conteos, cobertura por rol, sedes por regional
//   GET /sedes          → las 94 sedes con cuánta gente tiene cada una
//   GET /profesionales  → la planta (?rol= &sede= &q=)
//
// ── Por qué el acceso va por email y no por rol ─────────────────────────────
// Esta pantalla muestra la planta COMPLETA de la cadena — 141 nombres con su
// cédula, incluidas regionales donde el usuario no opera. `requireRole('admin')`
// abriría eso a todos los administradores, que no es lo que se pidió. Se usa
// una lista explícita, igual que el Mapa de Rutas (mapa-stats.service).
//
// La lista vive acá y también en el frontend, para no mostrar un botón que
// lleva a un 403. La del backend es la que manda: la del frontend solo decide
// si se dibuja el ítem del menú.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import directorioService from '../services/directorio.service';
import { getSession } from '../middleware/rbac.middleware';

const router = Router();

/** Quién puede ver la planta completa. Misma lista que el Mapa de Rutas. */
const DIRECTORIO_ALLOWED = new Set<string>([
  'danieltalero78@gmail.com',
]);

/** Exige sesión válida Y que el email esté en la lista. */
function requireDirectorioAccess(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: 'NO_SESSION' });
    return;
  }
  if (!DIRECTORIO_ALLOWED.has((session.email || '').toLowerCase())) {
    res.status(403).json({ success: false, error: 'FORBIDDEN' });
    return;
  }
  next();
}

router.use(requireDirectorioAccess);

router.get('/resumen', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await directorioService.resumen() });
  } catch (e) {
    // El directorio es otra base: puede estar caída sin que consulta lo esté.
    // Se dice cuál de las dos falló en vez de un 500 mudo.
    console.error('[directorio] resumen:', e);
    res.status(503).json({
      success: false,
      error: 'DIRECTORIO_NO_DISPONIBLE',
      detalle: e instanceof Error ? e.message : String(e),
    });
  }
});

router.get('/sedes', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await directorioService.sedes() });
  } catch (e) {
    console.error('[directorio] sedes:', e);
    res.status(503).json({ success: false, error: 'DIRECTORIO_NO_DISPONIBLE' });
  }
});

router.get('/profesionales', async (req: Request, res: Response) => {
  try {
    const data = await directorioService.profesionales({
      rol: typeof req.query.rol === 'string' ? req.query.rol : undefined,
      sede: typeof req.query.sede === 'string' ? req.query.sede : undefined,
      q: typeof req.query.q === 'string' ? req.query.q.trim() || undefined : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    console.error('[directorio] profesionales:', e);
    res.status(503).json({ success: false, error: 'DIRECTORIO_NO_DISPONIBLE' });
  }
});

export default router;
