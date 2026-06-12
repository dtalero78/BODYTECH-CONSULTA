// ============================================================================
// rbac.middleware — Autorización por rol + alcance por sede (nueva auth).
//
// Trabaja con el JWT de sesión (email+contraseña) emitido por
// authService.loginWithPassword. Tres piezas:
//
//  1) sessionContextMiddleware — global, NO bloquea: si hay un token de sesión
//     válido, adjunta `req.session` (SessionPayload) y `req.sedeScope`.
//  2) requireRole(...roles) — exige sesión válida Y que el rol esté permitido.
//  3) effectiveSedes / canActOnSede — helpers para que los controllers
//     constriñan las sedes solicitadas al alcance real del usuario (un
//     coordinador NO puede pedir sedes fuera de su lista vía ?sedes=).
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import authService, { SessionPayload } from '../services/auth.service';
import { Rol } from '../services/usuarios.service';

const BEARER_PREFIX = 'Bearer ';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  return header.slice(BEARER_PREFIX.length).trim() || null;
}

/** Alcance por sede del usuario: todas (admin/global) o una lista acotada. */
export type SedeScope = { all: true } | { all: false; sedes: string[] };

/**
 * Adjunta `req.session` y `req.sedeScope` si hay token de sesión válido.
 * Nunca corta el request — solo enriquece (igual que optionalAuthMiddleware
 * para el token legacy). Se monta global en index.ts.
 */
export function sessionContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const session = authService.verifySessionToken(token);
    if (session) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).session = session;
      const scope: SedeScope = session.esGlobal
        ? { all: true }
        : { all: false, sedes: session.sedes ?? [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).sedeScope = scope;
      // Puente backward-compat: los controllers que aún leen `req.sedeId`
      // (historia clínica, órdenes single-sede) quedan correctamente acotados
      // para usuarios de UNA sola sede. Para multi-sede/global NO lo seteamos
      // (esos flujos usan sedeScope explícito; el scoping multi-sede de historia
      // clínica se afina aparte).
      if (!session.esGlobal && Array.isArray(session.sedes) && session.sedes.length === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).sedeId = session.sedes[0];
      }
    }
  }
  next();
}

/** Devuelve la sesión adjunta por sessionContextMiddleware (o undefined). */
export function getSession(req: Request): SessionPayload | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req as any).session as SessionPayload | undefined;
}

/**
 * Exige sesión válida y que el rol esté en `roles`. 401 si no hay sesión,
 * 403 si el rol no está permitido.
 */
export function requireRole(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ success: false, error: 'NO_SESSION' });
      return;
    }
    if (!roles.includes(session.role)) {
      res.status(403).json({ success: false, error: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

/**
 * Lista efectiva de sedes que el usuario PUEDE consultar, dada una lista
 * solicitada (ej. ?sedes=csv). La constriñe a su alcance:
 *   - admin/global: `requested` tal cual; undefined (= todas) si no pidió nada.
 *   - acotado: intersección requested ∩ permitidas; si no pidió, todas las suyas.
 * `undefined` significa "sin filtro de sede" y SOLO ocurre para admin/global.
 */
export function effectiveSedes(req: Request, requested?: string[]): string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (req as any).sedeScope as SedeScope | undefined;
  if (!scope) return requested;
  if (scope.all) {
    return requested && requested.length > 0 ? requested : undefined;
  }
  const allowed = scope.sedes;
  if (requested && requested.length > 0) {
    const inter = requested.filter((s) => allowed.includes(s));
    return inter.length > 0 ? inter : allowed;
  }
  return allowed;
}

/** ¿El usuario puede operar sobre UNA sede puntual? (admin/global, o está en su lista) */
export function canActOnSede(req: Request, sedeId: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (req as any).sedeScope as SedeScope | undefined;
  if (!scope) return false;
  if (scope.all) return true;
  return scope.sedes.includes(sedeId);
}
