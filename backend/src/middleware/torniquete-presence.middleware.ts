// ============================================================================
// torniquetePresenceMiddleware — Estampa presencia de jornada en CUALQUIER
// acción autenticada de un profesional (médico/coach).
//
// Por qué: el heartbeat del frontend (timer de 90s) no cubre dos casos:
//   1) el coach tiene una pestaña vieja (bundle anterior al deploy, sin el hook);
//   2) el coach hace una acción real (enviar WhatsApp con "Contactar", guardar
//      historia, etc.) pero el timer aún no ha latido.
// Como toda acción del panel llega al backend CON el token del coach, este
// middleware la convierte en un latido → la jornada refleja trabajo real, no
// sólo "pestaña abierta". La identidad se deriva del token en el server.
//
// Global, no bloqueante (fire-and-forget) y con throttle en memoria para no
// escribir en BD en cada request: como mucho un latido por profesional cada
// STAMP_THROTTLE_MS. El throttle es una optimización por-instancia; aunque haya
// varias instancias, la corrección la garantiza la BD (idempotente por jornada).
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { resolveProfesionalIdentity } from '../helpers/profesional-identity';
import torniqueteService from '../services/torniquete.service';

const STAMP_THROTTLE_MS = 60_000;
const lastStamp = new Map<string, number>();

export function torniquetePresenceMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const ident = resolveProfesionalIdentity(req);
    if (ident) {
      const key = `${ident.codigo}|${ident.sedeId}`;
      const now = Date.now();
      if (now - (lastStamp.get(key) ?? 0) >= STAMP_THROTTLE_MS) {
        lastStamp.set(key, now);
        // Fire-and-forget: el torniquete jamás debe demorar ni romper un request.
        torniqueteService.heartbeat(ident.codigo, ident.sedeId, ident.rol).catch(() => {});
      }
    }
  } catch {
    // Silencioso a propósito.
  }
  next();
}
