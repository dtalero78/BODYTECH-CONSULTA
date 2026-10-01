// ============================================================================
// requireDispositivo — Candado de las rutas que usa el asistente de escritorio.
//
// La placa manda `Authorization: Bearer dsp_…`. El token se cambia por la
// sesión del médico que la vinculó (dispositivo.service.autenticar) y se deja
// en `req.session`, igual que la del panel: así `getSession`, el alcance por
// sede y la auditoría funcionan sin saber que del otro lado hay una placa.
//
// Solo profesionales con código (médico): la placa abre consultas a SU nombre.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import dispositivoService from '../services/dispositivo.service';
import { PREFIJO_TOKEN } from '../helpers/dispositivo.helper';

const BEARER = 'Bearer ';

export function getDispositivoId(req: Request): number | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req as any).dispositivoId;
}

export async function requireDispositivo(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith(BEARER) ? header.slice(BEARER.length).trim() : '';
  if (!token.startsWith(PREFIJO_TOKEN)) {
    res.status(401).json({ success: false, error: 'DISPOSITIVO_INVALIDO', message: 'Vincule el dispositivo de nuevo.' });
    return;
  }
  try {
    const auth = await dispositivoService.autenticar(token);
    if (!auth) {
      res.status(401).json({ success: false, error: 'DISPOSITIVO_INVALIDO', message: 'Vincule el dispositivo de nuevo.' });
      return;
    }
    if (auth.sesion.role !== 'medico' || !auth.sesion.codigo) {
      res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'La cuenta vinculada no es de un profesional.' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = req as any;
    r.session = auth.sesion;
    r.sedeScope = auth.sesion.esGlobal ? { all: true } : { all: false, sedes: auth.sesion.sedes ?? [] };
    r.dispositivoId = auth.dispositivoId;
    next();
  } catch (e) {
    next(e);
  }
}
