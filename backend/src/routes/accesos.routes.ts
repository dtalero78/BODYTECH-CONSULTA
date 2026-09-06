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
import bajasService from '../services/bajas.service';
import { getSession } from '../middleware/rbac.middleware';
import { z } from 'zod';

const router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [personas, resumen, bajas] = await Promise.all([
      accesosSyncService.listar(),
      accesosSyncService.resumen(),
      bajasService.listar(),
    ]);
    const deBaja = new Map(bajas.map((b) => [b.email, b]));
    res.json({
      success: true,
      data: personas.map((p) => ({ ...p, baja: deBaja.get(p.email.toLowerCase()) ?? null })),
      resumen: { ...resumen, bajas: bajas.length },
    });
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

const bajaSchema = z.object({
  email: z.string().email(),
  motivo: z.string().trim().max(300).nullable().optional(),
});

/**
 * Da de baja a una persona de la ORGANIZACIÓN: deja de poder entrar a todas las
 * aplicaciones, no sólo a ésta. Es lo que hasta ahora había que hacer una vez
 * por aplicación —y que ya se falló al menos una vez.
 */
router.post('/baja', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = bajaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'VALIDACION', message: 'Correo inválido.' });
    return;
  }
  try {
    await bajasService.darDeBaja(
      parsed.data.email,
      parsed.data.motivo ?? null,
      getSession(req)?.email ?? null,
    );
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/** Reingreso: vuelve a poder entrar donde tenga cuenta activa. */
router.delete('/baja/:email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await bajasService.reactivar(String(req.params.email));
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
