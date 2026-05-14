// ============================================================================
// auth.middleware — Run 5 (multi-sede login).
//
// Dos middlewares:
//
// 1) `optionalAuthMiddleware`: lee el header `Authorization: Bearer ...`, y
//    si está presente y válido, enriquece `req.medicoCode` y `req.sedeId`.
//    NUNCA corta el request — sólo agrega contexto. Se monta globalmente en
//    `index.ts` antes de `sedeMiddleware` para que el JWT (cuando exista) se
//    imponga sobre el header `X-Sede-Id`.
//
// 2) `requireAuthMiddleware`: exige `Authorization: Bearer ...` válido. Se
//    monta sólo sobre `/api/medical-panel` — los endpoints de video y
//    telemedicina siguen siendo públicos porque los pacientes acceden por
//    link de WhatsApp sin cuenta.
//
// Convención: usamos `(req as any).medicoCode` / `(req as any).sedeId` para
// quedarnos consistentes con `sede.middleware.ts`. No introducimos una
// declaración global de tipos en este run.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import authService from '../services/auth.service';

const BEARER_PREFIX = 'Bearer ';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  return header.slice(BEARER_PREFIX.length).trim() || null;
}

/**
 * Enriquece el request con `medicoCode` / `sedeId` si hay JWT válido.
 * Si no hay token o el token es inválido, simplemente sigue sin enriquecer.
 */
export function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);
  if (token) {
    const payload = authService.verifyToken(token);
    if (payload) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).medicoCode = payload.medicoCode;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).sedeId = payload.sedeId;
    }
  }
  next();
}

/**
 * Exige un JWT válido. Responde 401 con shape uniforme si falta o es inválido.
 */
export function requireAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ success: false, error: 'NO_TOKEN' });
    return;
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'INVALID_TOKEN' });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).medicoCode = payload.medicoCode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).sedeId = payload.sedeId;
  next();
}
