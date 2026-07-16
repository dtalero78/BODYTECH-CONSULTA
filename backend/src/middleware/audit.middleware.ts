// ============================================================================
// auditMiddleware — Registra en `audit_log` CADA mutación /api relevante con
// quién (actor del token/sesión), qué (acción/entidad), cuándo y el resultado
// (status HTTP). Global, no bloqueante (fire-and-forget vía res.on('finish')).
//
// Solo audita métodos de escritura (POST/PUT/PATCH/DELETE) y excluye rutas de
// telemetría / alta frecuencia / webhooks que tienen su propio registro
// (video events, torniquete heartbeat, monitor Trepsi, público, etc.).
//
// La clasificación (accion/entidad/entidad_id) se deriva del método + path sin
// depender de `req.route`/`req.params` (no disponibles en el hook global de
// finish). El actor se toma de la sesión RBAC (email+contraseña) o, en su
// defecto, del token legacy (código de médico/coach) que dejó optionalAuth.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { getSession } from './rbac.middleware';
import auditService from '../services/audit.service';

const AUDIT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Prefijos que NO se auditan: telemetría, webhooks entrantes, alta frecuencia o
// con su propia bitácora.
const EXCLUDE_PREFIXES = [
  '/api/video/events',
  '/api/video/webhooks',
  '/api/telemedicine',
  '/api/torniquete', // tiene su propia tabla (torniquete_jornadas)
  '/api/monitor-integracion',
  '/api/public',
  '/api/whatsapp-leads',
  '/api/whatsapp-chat/webhook',
  '/api/v1/integrations/trepsi', // se registra en trepsi_integration_log
  '/api/bot-trepsi',
];

interface Clasificacion {
  accion: string;
  entidad?: string;
  entidadId?: string;
}

/** Deriva (accion, entidad, entidadId) desde método + path. */
function classify(method: string, path: string): Clasificacion {
  const p = path.split('?')[0];
  const g = (re: RegExp): string | undefined => p.match(re)?.[1];

  let id = g(/^\/api\/medical-panel\/patients\/([^/]+)\/no-answer/);
  if (id) return { accion: 'no_contesta', entidad: 'historia', entidadId: id };

  id = g(/^\/api\/medical-panel\/ordenes\/([^/]+)/);
  if (id) {
    return {
      accion: method === 'DELETE' ? 'eliminar_cita' : 'editar_cita',
      entidad: 'cita',
      entidadId: id,
    };
  }
  if (/^\/api\/medical-panel\/ordenes\/?$/.test(p) && method === 'POST') {
    return { accion: 'crear_cita', entidad: 'cita' };
  }
  if (/^\/api\/medical-panel\/mi-disponibilidad/.test(p)) {
    return { accion: 'editar_mi_horario', entidad: 'disponibilidad' };
  }

  id = g(/^\/api\/profesionales\/([^/]+)/);
  if (id) return { accion: 'gestion_profesional', entidad: 'profesional', entidadId: id };
  if (/^\/api\/profesionales\/?$/.test(p) && method === 'POST') {
    return { accion: 'crear_profesional', entidad: 'profesional' };
  }

  if (/^\/api\/calendario\/reasignar/.test(p)) return { accion: 'reasignar_cita', entidad: 'cita' };

  id = g(/^\/api\/video\/medical-history\/([^/]+)/);
  if (id) return { accion: 'editar_historia', entidad: 'historia', entidadId: id };

  id = g(/^\/api\/usuarios\/([^/]+)/);
  if (id) return { accion: 'gestion_usuario', entidad: 'usuario', entidadId: id };
  if (/^\/api\/usuarios\/?$/.test(p) && method === 'POST') {
    return { accion: 'crear_usuario', entidad: 'usuario' };
  }

  if (/^\/api\/auth\/login/.test(p)) return { accion: 'login' };

  return { accion: `${method.toLowerCase()}_${p.replace(/^\/api\//, '').split('/')[0] || 'api'}` };
}

function clientIp(req: Request): string | null {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim().slice(0, 64);
  return (req.ip ?? null)?.slice(0, 64) ?? null;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.originalUrl || req.url;
  const method = req.method.toUpperCase();

  const skip =
    !AUDIT_METHODS.has(method) ||
    !path.startsWith('/api/') ||
    EXCLUDE_PREFIXES.some((pre) => path.startsWith(pre));

  if (skip) return next();

  // Al terminar la respuesta (ya con status), registra sin bloquear.
  res.on('finish', () => {
    try {
      const session = getSession(req);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyReq = req as any;
      const legacyCodigo: string | undefined = anyReq.medicoCode;
      const sedeId: string | undefined = anyReq.sedeId;
      const c = classify(method, path);

      void auditService.record({
        actorUserId: session?.userId ?? null,
        actorEmail: session?.email ?? null,
        actorNombre: session?.nombre ?? null,
        actorCodigo: session?.codigo ?? legacyCodigo ?? null,
        actorRol: session?.role ?? null,
        actorSede: (session?.sedes && session.sedes[0]) ?? sedeId ?? null,
        metodo: method,
        ruta: path,
        accion: c.accion,
        entidad: c.entidad ?? null,
        entidadId: c.entidadId ?? null,
        statusCode: res.statusCode,
        ip: clientIp(req),
      });
    } catch {
      // Silencioso a propósito: la auditoría nunca rompe el request.
    }
  });

  next();
}
