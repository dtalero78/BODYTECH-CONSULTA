// ============================================================================
// trepsi-monitor.middleware — Captura cada request al grupo /api/v1/integrations/trepsi
// y lo persiste en trepsi_integration_log (dirección 'inbound').
//
// Se monta DESPUÉS del requireApiKey, así que solo registramos peticiones que
// pasaron la auth.
//
// Por simplicidad y seguridad, NO registramos el header Authorization ni los
// secretos que vengan en el body (la key ya fue consumida por el middleware
// de auth).
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import integrationLogService from '../services/integration-log.service';

// Mapeo path → tipo (etiqueta legible para el monitor).
function inferTipo(method: string, baseUrl: string): string {
  // Quitar query string
  const cleanPath = baseUrl.split('?')[0];
  const segments = cleanPath.split('/').filter(Boolean);
  // segments del path interno (sin /api/v1/integrations/trepsi):
  // ej. ["appointments", "TRP-123", "schedule"]
  if (segments.length === 0) return `${method} /`;
  const last = segments[segments.length - 1];
  if (last === 'health') return 'health';
  if (last === 'medicos') return 'listMedicos';
  if (last === 'horarios-disponibles') return 'listHorariosDisponibles';
  if (segments[0] === 'appointments') {
    if (segments.length === 1) return 'createAppointment';
    if (last === 'schedule') return 'rescheduleAppointment';
    if (last === 'historia') return 'patchHistoria';
    if (method === 'DELETE') return 'cancelAppointment';
    if (method === 'GET') return 'getAppointment';
  }
  return `${method} ${cleanPath}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCitaId(req: Request, responseBody: any): string | null {
  // 1. De params (URL)
  const p = (req.params as Record<string, string> | undefined)?.citaId;
  if (p) return p;
  // 2. Del body del request
  const reqBody = req.body as Record<string, unknown> | undefined;
  if (reqBody && typeof reqBody.citaId === 'string') return reqBody.citaId;
  // 3. Del body de la respuesta
  if (responseBody && typeof responseBody === 'object' && typeof responseBody.citaId === 'string') {
    return responseBody.citaId;
  }
  return null;
}

export function trepsiMonitorMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Capturar el body de la respuesta interceptando res.json y res.send.
  let capturedBody: unknown = null;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function (body: unknown) {
    capturedBody = body;
    return originalJson(body);
  };
  res.send = function (body: unknown) {
    // res.send normalmente con JSON ya se delega a res.json; pero por si acaso
    if (capturedBody === null) capturedBody = body;
    return originalSend(body);
  };

  res.on('finish', () => {
    const latencyMs = Date.now() - startTime;
    const method = req.method;
    const baseUrl = req.originalUrl;
    const tipo = inferTipo(method, req.path); // req.path es relativo al mount

    // Sanitizar el body del request — eliminamos el campo `historiaClinica`
    // gigante para que no infle el log (sólo dejamos sus keys top-level).
    const reqBody = req.body as Record<string, unknown> | undefined;
    let sanitizedReq: unknown = reqBody;
    if (reqBody && typeof reqBody === 'object' && reqBody.historiaClinica) {
      sanitizedReq = {
        ...reqBody,
        historiaClinica: {
          _truncated: true,
          keys: Object.keys(reqBody.historiaClinica as object),
        },
      };
    }

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

    const citaId = extractCitaId(req, capturedBody);

    integrationLogService
      .log({
        direccion: 'inbound',
        tipo,
        metodo: method,
        path: baseUrl,
        citaId,
        statusCode: status,
        ok,
        latencyMs,
        requestBody: sanitizedReq,
        responseBody: capturedBody,
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
