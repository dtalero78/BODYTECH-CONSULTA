// ============================================================================
// monitor-integracion.controller — Eventos de la integración Trepsi para el
// dashboard de monitoreo en vivo (/monitor-integracion).
//
// Protegido por un token simple `MONITOR_TOKEN` (env var). El usuario abre el
// dashboard con `?token=...` y el frontend lo pasa en cada request. Es un
// mecanismo muy ligero — pensado para que el usuario lo use durante las
// pruebas con Trepsi sin pelearse con el sistema RBAC nuevo.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import integrationLogService from '../services/integration-log.service';
import postgresService from '../services/postgres.service';

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkToken(req: Request, res: Response): boolean {
  const expected = process.env.MONITOR_TOKEN;
  if (!expected || expected.length === 0) {
    res.status(503).json({
      ok: false,
      error: { code: 'MONITOR_NOT_CONFIGURED', message: 'MONITOR_TOKEN no configurada.' },
    });
    return false;
  }
  const provided =
    (typeof req.query.token === 'string' && req.query.token) ||
    (typeof req.headers['x-monitor-token'] === 'string' && req.headers['x-monitor-token']) ||
    '';
  if (!provided || !constantTimeEquals(provided, expected)) {
    res.status(401).json({ ok: false, error: { code: 'INVALID_TOKEN', message: 'Token inválido.' } });
    return false;
  }
  return true;
}

class MonitorIntegracionController {
  /**
   * GET /events?token=...&since=ISO
   * Devuelve eventos creados después de `since` (incluyendo el lado outbound
   * actual del outbox). Si `since` no se pasa, devuelve los últimos 200.
   */
  events = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const since = typeof req.query.since === 'string' ? req.query.since : null;
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const rows = await integrationLogService.listSince(since, limit);
      res.status(200).json({
        ok: true,
        serverTime: new Date().toISOString(),
        count: rows.length,
        events: rows,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /summary?token=...
   * Resumen agregado: total inbound/outbound, errores, últimos por tipo.
   * Útil para los counters del header del dashboard.
   */
  summary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const sinceHours = Math.min(Number(req.query.hours) || 24, 168);

      const stats = await postgresService.query(
        `SELECT
           direccion,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ok = TRUE)::int AS ok,
           COUNT(*) FILTER (WHERE ok = FALSE)::int AS errores,
           AVG(latency_ms)::int AS latencia_promedio_ms
         FROM trepsi_integration_log
         WHERE created_at > NOW() - ($1 || ' hours')::interval
         GROUP BY direccion`,
        [String(sinceHours)]
      );

      const porTipo = await postgresService.query(
        `SELECT
           tipo, direccion,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ok = FALSE)::int AS errores
         FROM trepsi_integration_log
         WHERE created_at > NOW() - ($1 || ' hours')::interval
         GROUP BY tipo, direccion
         ORDER BY total DESC`,
        [String(sinceHours)]
      );

      const outbox = await postgresService.query(
        `SELECT estado, COUNT(*)::int AS total
           FROM trepsi_webhook_outbox
           GROUP BY estado`,
        []
      );

      res.status(200).json({
        ok: true,
        ventanaHoras: sinceHours,
        porDireccion: stats ?? [],
        porTipo: porTipo ?? [],
        outbox: outbox ?? [],
      });
    } catch (err) {
      next(err);
    }
  };
}

export default new MonitorIntegracionController();
