// ============================================================================
// Router /api/paneles/* — la página de paneles del creador de la plataforma.
//
// Montado con requireRole('admin') en index.ts, y además solo para los correos
// de SUPERUSUARIOS: ver paneles-acceso.ts.
//
// Los tokens de ACC y Prepagadas se piden al iniciar sesión (auth.controller),
// con la contraseña que la persona acaba de escribir. `/entrar` existe para
// cuando ya vencieron: las hermanas firman por 12 h y la sesión de Consulta con
// "recordarme" dura 30 días. Pide la contraseña otra vez y se la pasa SOLO a
// la app elegida, que la valida contra su propio acceso. Consulta no firma
// nada en nombre de otra app: no hay llave maestra que robar.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import authService from '../services/auth.service';
import { getSession } from '../middleware/rbac.middleware';
import { esSuperusuario } from '../services/paneles-acceso';

const router = Router();

const entrarSchema = z.object({
  programa: z.enum(['acc', 'prepagadas']),
  password: z.string().min(1),
});

/**
 * ¿Dibujo la página? Va ANTES del candado: a otro admin le contesta "no" en
 * vez de un 403, que es lo que el panel pregunta para mostrar la entrada.
 */
router.get('/acceso', (req: Request, res: Response) => {
  res.json({ success: true, data: { puede: esSuperusuario(getSession(req)?.email) } });
});

/** Candado de todo lo demás: sesión Y correo en SUPERUSUARIOS. */
router.use((req: Request, res: Response, next: NextFunction) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: 'NO_SESSION' });
    return;
  }
  if (!esSuperusuario(session.email)) {
    res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Los paneles no están habilitados para tu cuenta.' });
    return;
  }
  next();
});

router.post('/entrar', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = entrarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Pedido inválido.' });
    return;
  }
  try {
    // El correo sale de la SESIÓN, nunca del cuerpo: si no, esto sería una
    // forma de probar contraseñas ajenas contra ACC y Prepagadas.
    const email = getSession(req)!.email;
    const [panel] = await authService.tokensHermanas(email, parsed.data.password, [parsed.data.programa]);
    if (!panel) {
      // 422 y no 401: un 401 se lee como "se cayó la sesión de Consulta", y esa
      // sesión está bien. Lo que no pasó es la contraseña, o la app no contestó
      // (desde acá las dos cosas se ven iguales).
      res.status(422).json({
        success: false,
        error: 'NO_ENTRO',
        message: 'No se pudo entrar. Revisa la contraseña; si está bien, esa app no respondió.',
      });
      return;
    }
    res.json({ success: true, data: panel });
  } catch (e) {
    next(e);
  }
});

export default router;
