// ============================================================================
// torniquete.controller — HTTP wrappers para /api/torniquete/*.
//
// Envelope interno: { success, data?, error? }.
//
// Identidad del profesional para heartbeat/logout: se DERIVA del token en el
// server (no se confía en el body) para no permitir spoofing de otro coach.
//   - Sesión RBAC (email+contraseña): codigo = session.codigo, sede = 1ª sede.
//     Solo médico/coach con `codigo` cuentan; coordinador/admin/etc. son no-op.
//   - Token legacy (code+sede): codigo = req.medicoCode, sede = req.sedeId
//     (los inyecta optionalAuthMiddleware global).
//
// El tablero (getBoard) es solo para coordinador/admin/auxiliar (gating en el
// router) y usa las sedes efectivas del alcance del usuario.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import torniqueteService, { TorniqueteRol } from '../services/torniquete.service';
import postgresService from '../services/postgres.service';
import { getSession, effectiveSedes } from '../middleware/rbac.middleware';

interface Identidad {
  codigo: string;
  sedeId: string;
  rol: TorniqueteRol | null;
}

/**
 * Resuelve la identidad del profesional logueado desde el token.
 * - `null`         → no hay auth válida (responder 401).
 * - `{ skip: true}`→ hay sesión pero NO es un profesional rastreable (no-op 204).
 */
function resolveIdentidad(req: Request): Identidad | null | { skip: true } {
  const session = getSession(req);
  if (session) {
    // Solo médico/coach con código vinculado tienen jornada. El resto (admin,
    // coordinador, auxiliar, torre) usa la plataforma pero no ficha torniquete.
    if ((session.role === 'medico' || session.role === 'coach') && session.codigo) {
      const sedeId = Array.isArray(session.sedes) && session.sedes.length > 0 ? session.sedes[0] : 'bsl';
      return { codigo: session.codigo, sedeId, rol: session.role };
    }
    return { skip: true };
  }
  // Legacy token (code+sede) inyectado por optionalAuthMiddleware.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medicoCode = (req as any).medicoCode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedeId = (req as any).sedeId;
  if (typeof medicoCode === 'string' && medicoCode.length > 0) {
    return {
      codigo: medicoCode,
      sedeId: typeof sedeId === 'string' && sedeId.length > 0 ? sedeId : 'bsl',
      rol: null,
    };
  }
  return null;
}

function parseSedesQuery(req: Request): string[] | undefined {
  const raw = req.query.sedes;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length > 0) return list;
  }
  return undefined;
}

/** Sedes efectivas para el tablero, constreñidas al alcance del usuario. */
async function resolveSedes(req: Request): Promise<string[]> {
  const eff = effectiveSedes(req, parseSedesQuery(req));
  if (eff) return eff;
  const rows = await postgresService.query(`SELECT sede_id FROM sedes WHERE activa = true`);
  return rows ? rows.map((r: { sede_id: string }) => r.sede_id) : [];
}

class TorniqueteController {
  heartbeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ident = resolveIdentidad(req);
      if (ident === null) {
        res.status(401).json({ success: false, error: { code: 'NO_AUTH', message: 'Sin sesión.' } });
        return;
      }
      if ('skip' in ident) {
        res.status(204).end();
        return;
      }
      const ok = await torniqueteService.heartbeat(ident.codigo, ident.sedeId, ident.rol);
      if (!ok) {
        res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'No se registró el latido.' } });
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ident = resolveIdentidad(req);
      if (ident === null) {
        // El logout puede llegar tras limpiar el token → no es un error para el cliente.
        res.status(204).end();
        return;
      }
      if ('skip' in ident) {
        res.status(204).end();
        return;
      }
      await torniqueteService.logout(ident.codigo, ident.sedeId);
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  getBoard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedes = await resolveSedes(req);
      // `fecha` (YYYY-MM-DD, día Colombia) opcional: consulta un día pasado.
      // Sin ella → hoy. Se valida el formato en el servicio.
      const fecha = typeof req.query.fecha === 'string' && req.query.fecha ? req.query.fecha : null;
      const board = await torniqueteService.getBoard(sedes, fecha);
      if (board === null) {
        res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Error consultando el tablero.' } });
        return;
      }
      res.status(200).json({ success: true, data: board });
    } catch (err) {
      next(err);
    }
  };
}

export default new TorniqueteController();
