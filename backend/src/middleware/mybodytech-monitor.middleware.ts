// ============================================================================
// mybodytech-monitor.middleware — Captura cada request al grupo
// /api/v1/integrations/mybodytech y lo persiste en trepsi_integration_log con
// integracion='mybodytech', para el dashboard /monitor-mybodytech.
//
// Se monta ANTES del router (no después de una auth), así también quedan
// registrados los intentos de token y los 401 — útil para ver fuerza bruta.
//
// SEGURIDAD: se redactan el `client_secret` del request y el `access_token` de
// la respuesta. Nunca deben quedar en el log.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import integrationLogService from '../services/integration-log.service';

// Mapeo path → tipo (etiqueta legible). `req.path` es relativo al mount.
function inferTipo(method: string, path: string): string {
  const cleanPath = path.split('?')[0];
  const segments = cleanPath.split('/').filter(Boolean);
  if (segments.length === 0) return `${method} /`;
  const last = segments[segments.length - 1];
  if (segments[0] === 'oauth' && last === 'token') return 'oauth.token';
  if (last === 'health') return 'health';
  if (last === 'sedes') return 'listSedes';
  if (last === 'horarios-disponibles') return 'listHorarios';
  if (segments[0] === 'afiliados') {
    if (segments.length === 1) return 'createAfiliado';
    if (method === 'DELETE') return 'cancelAfiliado';
    if (method === 'GET') return 'getAfiliado';
  }
  return `${method} ${cleanPath}`;
}

// Redacta valores sensibles de un objeto plano (no recursivo — nuestros bodies
// son planos). Devuelve una copia; no muta el original.
const SENSITIVE_KEYS = ['client_secret', 'access_token', 'token', 'authorization'];
function redact(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value ?? null;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) && v ? '***redacted***' : v;
  }
  return out;
}

function extractRef(req: Request, responseBody: unknown): string | null {
  const p = (req.params as Record<string, string> | undefined)?.eventoId;
  if (p) return p;
  const reqBody = req.body as Record<string, unknown> | undefined;
  if (reqBody && typeof reqBody.eventoId === 'string') return reqBody.eventoId;
  if (
    responseBody &&
    typeof responseBody === 'object' &&
    typeof (responseBody as Record<string, unknown>).eventoId === 'string'
  ) {
    return (responseBody as Record<string, string>).eventoId;
  }
  return null;
}

export function mybodytechMonitorMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  let capturedBody: unknown = null;
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    capturedBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const latencyMs = Date.now() - startTime;
    const method = req.method;
    const tipo = inferTipo(method, req.path);

    const sanitizedReq = redact(req.body);
    const sanitizedRes = redact(capturedBody);

    const status = res.statusCode;
    const ok = status >= 200 && status < 400;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    if (!ok && capturedBody && typeof capturedBody === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (capturedBody as any).error;
      if (e && typeof e === 'object') {
        errorCode = typeof e.code === 'string' ? e.code : undefined;
        errorMessage = typeof e.message === 'string' ? e.message : undefined;
      }
    }

    integrationLogService
      .log({
        integracion: 'mybodytech',
        direccion: 'inbound',
        tipo,
        metodo: method,
        path: req.originalUrl,
        citaId: extractRef(req, capturedBody),
        statusCode: status,
        ok,
        latencyMs,
        requestBody: sanitizedReq,
        responseBody: sanitizedRes,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        ip:
          (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          req.ip ||
          null,
        userAgent: (req.headers['user-agent'] as string) || null,
      })
      .catch(() => {});
  });

  next();
}
