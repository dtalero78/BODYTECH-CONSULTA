// ============================================================================
// vistas-guardadas.controller — "Mi vista" de cualquier tabla.
//
// Abierto a cualquier sesión válida: guardar cómo quiere ver una tabla no es un
// privilegio, es lo mínimo. Cada persona ve y toca solo las suyas.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import vistasGuardadasService from '../services/vistas-guardadas.service';
import { getSession } from '../middleware/rbac.middleware';

class VistasGuardadasController {
  /** GET /api/vistas?tabla=historias */
  async listar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      const tabla = typeof req.query.tabla === 'string' ? req.query.tabla : '';
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      if (!tabla) {
        res.status(400).json({ ok: false, mensaje: 'Falta la tabla.' });
        return;
      }
      res.json(await vistasGuardadasService.listar(sesion.userId, tabla));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/vistas */
  async guardar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const { tabla, nombre, config } = req.body ?? {};
      if (typeof tabla !== 'string' || !tabla || typeof nombre !== 'string') {
        res.status(400).json({ ok: false, mensaje: 'Faltan la tabla o el nombre.' });
        return;
      }
      const r = await vistasGuardadasService.guardar(
        sesion.userId,
        tabla,
        nombre,
        typeof config === 'object' && config ? config : {}
      );
      res.status(r.ok ? 200 : 400).json(r);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/vistas/:id */
  async eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const ok = await vistasGuardadasService.eliminar(sesion.userId, Number(req.params.id));
      res.status(ok ? 204 : 404).end();
    } catch (error) {
      next(error);
    }
  }
}

export default new VistasGuardadasController();
